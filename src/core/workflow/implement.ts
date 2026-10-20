import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { GateError, HandrailError } from '../errors.js';
import { readTextIfExists } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import {
  assertDependenciesMet,
  baseRef,
  evidenceMarkdown,
  fetchBase,
  loadTicketContext,
  runChecks,
} from './common.js';
import { reviewTicket } from './review.js';
import type { Context } from '../context.js';
import type { ReviewResult } from '../../types.js';

export interface ImplementOptions {
  skipReview?: boolean;
  skipChecks?: boolean;
  allowNoChecks?: boolean;
}

export interface ImplementResult {
  branch: string;
  commits: number;
  checksPassed: boolean;
  review?: ReviewResult;
}

export async function implementTicket(
  context: Context,
  ticketNumber: number,
  options: ImplementOptions = {},
): Promise<ImplementResult> {
  const { ticket, spec, requirement, specNumber, blockedBy } = await loadTicketContext(
    context,
    ticketNumber,
  );
  await assertDependenciesMet(context, blockedBy);

  await context.git.assertRepo();
  await context.git.assertClean(
    'Handrail will not mix your uncommitted changes with an agent run. Commit or stash them first.',
  );
  await fetchBase(context);

  const base = await baseRef(context);
  const branch = `${context.config.workflow.branchPrefix}${ticketNumber}`;
  const branchExists = await context.git.branchExists(branch);

  if (branchExists) {
    context.logger.warn(`Branch ${branch} already exists; continuing on it.`);
    await context.git.checkout(branch);
  } else {
    await context.git.checkoutNew(branch, base);
  }

  const docs = await loadAgentDocs(context);
  const diff = (await context.git.commitsAhead(base)) > 0 ? await context.git.diff(base) : '(no changes yet)';
  const system = await renderPrompt('implement.system', {});
  const prompt = await renderPrompt('implement.user', {
    ticketNumber: String(ticketNumber),
    projectName: context.config.project.name,
    branch,
    baseBranch: context.config.github.baseBranch,
    ticketBody: ticket.body,
    specNumber: String(specNumber),
    specBody: spec.body,
    requirementNumber: String(requirement.number),
    requirementBody: requirement.body,
    agents: docs.agents,
    glossary: docs.glossary,
    adrs: docs.adrs,
    diff,
  });

  context.logger.info(`Implementing #${ticketNumber} on ${branch} with ${context.agent.name}...`);
  const result = await context.agent.run({
    kind: 'implement',
    system,
    prompt,
    toolMode: 'write',
    ticket: ticketNumber,
    spec: specNumber,
  });

  if (result.truncated) {
    throw new GateError(
      `The agent hit its turn or token limit before finishing #${ticketNumber}.`,
      `Inspect branch ${branch}, then re-run "handrail implement ${ticketNumber}" after raising agent.maxTurns if needed.`,
    );
  }

  await context.git.addAll();
  const committed = await context.git.commit(`feat: ${ticket.title} (#${ticketNumber})`);
  if (committed) context.logger.ok(`Committed changes for #${ticketNumber}.`);
  const commits = await context.git.commitsAhead(base);
  if (commits === 0) {
    throw new HandrailError(
      'NO_CHANGES',
      `The agent produced no committed changes for #${ticketNumber}.`,
      'Check the agent transcript. Implementation cannot proceed without a diff.',
    );
  }

  let checksPassed = false;
  if (options.skipChecks) {
    context.logger.warn('Checks skipped by --skip-checks. The PR will not have check evidence.');
    checksPassed = false;
  } else {
    const checks = await runChecks(context, {
      ticket: ticketNumber,
      spec: specNumber,
      commands: context.config.checks.commands,
      allowNoChecks: options.allowNoChecks,
    });
    checksPassed = checks.ok;
    if (!checks.ok) {
      throw new GateError(
        `Checks failed for #${ticketNumber}: ${checks.failed.join(', ')}`,
        `Fix the branch, then re-run "handrail implement ${ticketNumber}". The commit was kept for inspection.`,
      );
    }
  }

  let review: ReviewResult | undefined;
  if (context.config.workflow.requireReview && !options.skipReview) {
    review = await reviewTicket(context, ticketNumber);
    if (review.verdict !== 'approve') {
      throw new GateError(
        `Review blocked #${ticketNumber}: ${review.summary}`,
        'Address the blocker findings and run "handrail review" again.',
      );
    }
  }

  await context.state.updateTicket(ticketNumber, {
    status: review ? 'reviewed' : 'implemented',
    branch,
  });
  const report = await context.evidence.writeTicketReport(ticketNumber);
  await context.evidence.record({
    kind: 'acceptance',
    ticket: ticketNumber,
    spec: specNumber,
    command: 'handrail implement',
    cwd: context.root,
    exitCode: 0,
    meta: { branch, commits, checksPassed, review: review?.verdict },
  });

  context.logger.ok(`Implementation ready on ${branch}.`);
  context.logger.info(`Evidence: ${report}`);
  context.logger.info(`Next: handrail pr ${ticketNumber} --create`);

  return { branch, commits, checksPassed, review };
}

async function loadAgentDocs(context: Context): Promise<{
  agents: string;
  glossary: string;
  adrs: string;
}> {
  const agents = (await readTextIfExists(path.join(context.root, 'AGENTS.md'))) ?? '(missing)';
  const glossary =
    (await readTextIfExists(path.join(context.root, context.config.project.glossary))) ?? '(missing)';
  const adrDir = path.join(context.root, context.config.project.adrDir);
  let adrFiles: string[] = [];
  try {
    adrFiles = (await readdir(adrDir))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .slice(0, 12);
  } catch {
    adrFiles = [];
  }
  const adrContents: string[] = [];
  for (const file of adrFiles) {
    const content = await readTextIfExists(path.join(adrDir, file));
    if (content) adrContents.push(`### ${file}\n\n${content.slice(0, 5000)}`);
  }
  return {
    agents: agents.slice(0, 12_000),
    glossary: glossary.slice(0, 8000),
    adrs: adrContents.join('\n\n') || '(no ADRs yet)',
  };
}

export async function implementationEvidence(context: Context, ticket: number): Promise<string> {
  return evidenceMarkdown(context, ticket);
}
