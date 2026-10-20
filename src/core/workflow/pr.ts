import path from 'node:path';
import { GateError, HandrailError } from '../errors.js';
import { extractJson } from '../json.js';
import { readTextIfExists } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import { baseRef, evidenceMarkdown, loadTicketContext, writeDraft } from './common.js';
import type { Context } from '../context.js';
import type { Issue, PullRequest, ReviewResult } from '../../types.js';

interface PrNarrative {
  summary: string;
  behavior_changes: string[];
  risks: {
    reversibility: string;
    blast_radius: string;
    data_compatibility: string;
    rollback: string;
  };
}

export interface PrOptions {
  create?: boolean;
  draft?: boolean;
  skipReview?: boolean;
}

export async function createPullRequest(
  context: Context,
  ticketNumber: number,
  options: PrOptions = {},
): Promise<{ body: string; file: string; pr: PullRequest | null }> {
  const { ticket, spec, requirement, specNumber } = await loadTicketContext(context, ticketNumber);
  const base = await baseRef(context);
  const branch = `${context.config.workflow.branchPrefix}${ticketNumber}`;
  const currentBranch = await context.git.currentBranch();

  if (currentBranch !== branch) {
    if (await context.git.branchExists(branch)) {
      await context.git.checkout(branch);
    } else {
      throw new HandrailError(
        'BRANCH_MISSING',
        `Expected branch ${branch}, current branch is ${currentBranch}.`,
        `Run "handrail implement ${ticketNumber}" first.`,
      );
    }
  }

  if ((await context.git.commitsAhead(base)) === 0) {
    throw new HandrailError('NO_COMMITS', `No commits on ${branch} compared to ${base}.`);
  }
  await context.git.assertClean('Commit or stash changes before preparing the pull request.');
  const headSha = await context.git.revParse('HEAD');
  const baseSha = await context.git.revParse(base);

  if (context.config.workflow.requireReview && !options.skipReview) {
    const review = await loadReview(context, ticketNumber);
    if (!review) {
      throw new GateError(
        `No review record found for #${ticketNumber}.`,
        `Run "handrail review ${ticketNumber}" first, or pass --skip-review explicitly.`,
      );
    }
    if (review.verdict !== 'approve') {
      throw new GateError(
        `Review for #${ticketNumber} is "${review.verdict}", not "approve".`,
        'Resolve the blocker findings and review again.',
      );
    }
    if (review.headSha !== headSha || review.baseSha !== baseSha) {
      throw new GateError(
        `Review for #${ticketNumber} does not cover the current commit and base.`,
        `Run "handrail review ${ticketNumber}" again.`,
      );
    }
  }

  if (context.config.workflow.requireChecks) {
    const gate = await context.evidence.assertChecksPassed(
      ticketNumber,
      true,
      headSha ?? undefined,
      context.config.checks.commands,
    );
    if (!gate.ok) {
      throw new GateError(gate.reason ?? 'Check evidence is missing.', 'Run the configured checks first.');
    }
  }

  const diffStat = await context.git.diffStat(base);
  const diff = await context.git.diff(base);
  const system = await renderPrompt('pr.system', {});
  const prompt = await renderPrompt('pr.user', {
    ticketNumber: String(ticketNumber),
    projectName: context.config.project.name,
    branch,
    baseBranch: context.config.github.baseBranch,
    ticketBody: ticket.body,
    specNumber: String(specNumber),
    specBody: spec.body,
    diffStat,
    diff,
  });

  context.logger.info(`Preparing pull request description for #${ticketNumber}...`);
  const result = await context.agent.run({
    kind: 'pr',
    system,
    prompt,
    toolMode: 'read',
    ticket: ticketNumber,
    spec: specNumber,
  });
  const narrative = parseNarrative(result.text);
  const evidence = await evidenceMarkdown(context, ticketNumber, headSha ?? undefined);
  const body = renderPrBody({
    ticket,
    spec,
    requirement,
    narrative,
    evidence,
    diffStat,
  });
  const file = await writeDraft(context, `pr-${ticketNumber}.md`, body);

  if (!options.create) {
    context.logger.ok(`PR description written to ${file}.`);
    context.logger.info(`Review it, then run "handrail pr ${ticketNumber} --create".`);
    return { body, file, pr: null };
  }

  await context.git.push(branch);
  const existing = await context.github.prForBranch(branch);
  let pr: PullRequest;
  if (existing) {
    context.logger.warn(`Pull request #${existing.number} already exists for ${branch}; updating it.`);
    await context.github.prEdit(existing.number, {
      title: `feat: ${ticket.title} (#${ticketNumber})`,
      body,
    });
    pr = await context.github.prView(existing.number);
  } else {
    pr = await context.github.prCreate({
      base: context.config.github.baseBranch,
      head: branch,
      title: `feat: ${ticket.title} (#${ticketNumber})`,
      body,
      draft: options.draft ?? true,
    });
  }

  await context.state.updateTicket(ticketNumber, {
    status: 'pr-open',
    branch,
    pr: pr.number,
  });
  await context.evidence.record({
    kind: 'github',
    ticket: ticketNumber,
    spec: specNumber,
    command: `gh pr create (${branch})`,
    cwd: context.root,
    exitCode: 0,
    meta: { pr: pr.number, url: pr.url, draft: options.draft ?? true },
  });

  context.logger.ok(`Pull request #${pr.number}: ${pr.url}`);
  context.logger.info(
    'A human must approve and merge after CI passes. Handrail does not merge or bypass branch protection.',
  );
  return { body, file, pr };
}

async function loadReview(context: Context, ticketNumber: number): Promise<(ReviewResult & { headSha?: string | null; baseSha?: string | null }) | null> {
  const file = path.join(context.root, '.handrail', 'evidence', `review-${ticketNumber}.json`);
  const raw = await readTextIfExists(file);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReviewResult & { headSha?: string | null; baseSha?: string | null };
  } catch {
    return null;
  }
}

function parseNarrative(text: string): PrNarrative {
  const parsed = extractJson<Partial<PrNarrative>>(text);
  const risks = (parsed.risks ?? {}) as Partial<PrNarrative['risks']>;
  return {
    summary: String(parsed.summary ?? ''),
    behavior_changes: Array.isArray(parsed.behavior_changes)
      ? parsed.behavior_changes.filter((item): item is string => typeof item === 'string')
      : [],
    risks: {
      reversibility: String(risks.reversibility ?? 'Unknown'),
      blast_radius: String(risks.blast_radius ?? 'Unknown'),
      data_compatibility: String(risks.data_compatibility ?? 'Unknown'),
      rollback: String(risks.rollback ?? 'Unknown'),
    },
  };
}

function renderPrBody(input: {
  ticket: Issue;
  spec: Issue;
  requirement: Issue;
  narrative: PrNarrative;
  evidence: string;
  diffStat: string;
}): string {
  return [
    '## Spec / Tasks',
    `- Request: #${input.requirement.number}`,
    `- Spec: #${input.spec.number}`,
    `- Task: #${input.ticket.number}`,
    '',
    '## Summary',
    input.narrative.summary || input.ticket.title,
    '',
    '## Behavior changes',
    ...(input.narrative.behavior_changes.length > 0
      ? input.narrative.behavior_changes.map((change) => `- ${change}`)
      : ['- See the diff.']),
    '',
    '## Evidence',
    input.evidence,
    '',
    '### Diff stat',
    '```text',
    input.diffStat.trim() || '(no diff stat)',
    '```',
    '',
    '## Merge Danger',
    `- Reversibility: ${input.narrative.risks.reversibility}`,
    `- Blast radius: ${input.narrative.risks.blast_radius}`,
    `- Data compatibility: ${input.narrative.risks.data_compatibility}`,
    `- Rollback plan: ${input.narrative.risks.rollback}`,
    '',
    '## Reviewer Checklist',
    '- [ ] Matches the approved Spec',
    '- [ ] Acceptance criteria have been verified',
    '- [ ] Blocking review comments are resolved',
    '',
    `Closes #${input.ticket.number}`,
    '',
  ].join('\n');
}
