import path from 'node:path';
import { GateError, HandrailError } from '../errors.js';
import { extractJson } from '../json.js';
import { writeTextAtomic } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import { baseRef, fetchBase, loadSpecContext } from './common.js';
import type { Context } from '../context.js';
import type { CheckRun, Issue, PullRequest } from '../../types.js';

export interface AcceptanceResult {
  verdict: 'pass' | 'fail';
  summary: string;
  checks: Array<{ item: string; status: string; evidence?: string }>;
  gaps: string[];
}

export interface AcceptOptions {
  close?: boolean;
  allowNoCI?: boolean;
}

export async function acceptSpec(
  context: Context,
  specNumber: number,
  options: AcceptOptions = {},
): Promise<{ result: AcceptanceResult; file: string }> {
  const { spec, requirement, requirementNumber } = await loadSpecContext(context, specNumber);
  await fetchBase(context);
  const base = await baseRef(context);

  const allIssues = await context.github.issueList({ state: 'all', limit: 200 });
  const tickets = allIssues.filter(
    (issue) =>
      issue.labels.includes(context.config.github.labels.task) &&
      Number((issue.body.match(/Spec\s*:\s*#(\d+)/i) ?? [])[1]) === specNumber,
  );
  if (tickets.length === 0) {
    throw new GateError(
      `Spec #${specNumber} has no published tickets.`,
      `Run "handrail publish tickets ${specNumber}" first.`,
    );
  }

  const openTickets = tickets.filter((ticket) => ticket.state !== 'CLOSED');
  if (openTickets.length > 0) {
    throw new GateError(
      `Cannot accept spec #${specNumber}; ${openTickets.length} ticket(s) are still open: ${openTickets
        .map((ticket) => `#${ticket.number}`)
        .join(', ')}.`,
      'Merge the remaining work first.',
    );
  }

  const pulls: Array<{ ticket: Issue; pr: PullRequest; checks: CheckRun[] }> = [];
  for (const ticket of tickets) {
    const branch = `${context.config.workflow.branchPrefix}${ticket.number}`;
    const pr = await context.github.prForBranch(branch);
    if (!pr) {
      throw new GateError(
        `Ticket #${ticket.number} is closed but has no pull request on ${branch}.`,
        'The workflow requires every closed ticket to have a merged pull request. Reopen the ticket or create the missing PR.',
      );
    }
    if (pr.state !== 'MERGED') {
      throw new GateError(
        `Ticket #${ticket.number} is closed, but PR #${pr.number} is ${pr.state}, not MERGED.`,
        'Reopen the ticket or complete the pull request before final acceptance.',
      );
    }
    const checks = await context.github.prChecks(pr.number);
    if (context.config.workflow.requireCleanCI && !options.allowNoCI) {
      if (checks.length === 0) {
        throw new GateError(
          `PR #${pr.number} has no recorded CI checks.`,
          'Configure required checks, or pass --allow-no-ci for an explicitly manual acceptance.',
        );
      }
      const bad = checks.filter((check) => !isGreen(check.bucket));
      if (bad.length > 0) {
        throw new GateError(
          `PR #${pr.number} has non-green checks: ${bad.map((check) => `${check.name}=${check.bucket}`).join(', ')}.`,
        );
      }
    }
    pulls.push({ ticket, pr, checks });
  }

  const log = await context.git.log(base, 50);
  const evidence = (await context.evidence.list({ spec: specNumber }))
    .map((record) => `- ${record.kind} ${record.command ?? ''} exit=${record.exitCode ?? '-'}`)
    .join('\n');

  const system = await renderPrompt('accept.system', {});
  const prompt = await renderPrompt('accept.user', {
    specNumber: String(specNumber),
    projectName: context.config.project.name,
    baseBranch: context.config.github.baseBranch,
    requirementNumber: String(requirementNumber),
    requirementBody: requirement.body,
    specBody: spec.body,
    tickets: tickets
      .map(
        (ticket) =>
          `### #${ticket.number} ${ticket.title}\n${ticket.body}\n`,
      )
      .join('\n'),
    pulls: pulls
      .map(
        (item) =>
          `- #${item.ticket.number} -> PR #${item.pr.number} (${item.pr.state}); checks: ${
            item.checks.map((check) => `${check.name}=${check.bucket}`).join(', ') || 'none'
          }`,
      )
      .join('\n'),
    log,
    evidence: evidence || '(no evidence records)',
  });

  context.logger.info(`Running final acceptance for spec #${specNumber}...`);
  const agentResult = await context.agent.run({
    kind: 'accept',
    system,
    prompt,
    toolMode: 'read',
    spec: specNumber,
  });
  const result = parseAcceptance(agentResult.text);

  const dir = path.join(context.root, '.handrail', 'evidence');
  await writeTextAtomic(
    path.join(dir, `acceptance-${specNumber}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const markdown = renderAcceptance(specNumber, result, pulls);
  await writeTextAtomic(path.join(dir, `acceptance-${specNumber}.md`), markdown);
  await context.evidence.record({
    kind: 'acceptance',
    spec: specNumber,
    command: 'handrail accept',
    cwd: context.root,
    exitCode: result.verdict === 'pass' ? 0 : 1,
    meta: { verdict: result.verdict, gaps: result.gaps.length },
  });

  if (result.verdict === 'fail') {
    context.logger.error(`Acceptance failed for spec #${specNumber}.`);
    for (const gap of result.gaps) context.logger.info(`- ${gap}`);
    return { result, file: path.join(dir, `acceptance-${specNumber}.md`) };
  }

  context.logger.ok(`Acceptance passed for spec #${specNumber}.`);
  if (options.close) {
    await context.github.issueComment(
      specNumber,
      [
        `Final acceptance passed by Handrail at ${new Date().toISOString()}.`,
        '',
        result.summary,
        '',
        `Report: \`.handrail/evidence/acceptance-${specNumber}.md\``,
      ].join('\n'),
    );
    await context.github.issueClose(specNumber);
    await context.github.issueComment(
      requirementNumber,
      `Requirement accepted. Spec #${specNumber} is closed and every linked ticket has been merged.`,
    );
    await context.github.issueClose(requirementNumber);
    context.logger.ok(`Closed spec #${specNumber} and requirement #${requirementNumber}.`);
  } else {
    context.logger.info(
      `Review the report, then run "handrail accept ${specNumber} --close" to close the spec and requirement.`,
    );
  }

  return { result, file: path.join(dir, `acceptance-${specNumber}.md`) };
}

function parseAcceptance(text: string): AcceptanceResult {
  const parsed = extractJson<Partial<AcceptanceResult>>(text);
  if (parsed.verdict !== 'pass' && parsed.verdict !== 'fail') {
    throw new HandrailError('ACCEPTANCE_INVALID', 'Acceptance output must contain verdict "pass" or "fail".');
  }
  return {
    verdict: parsed.verdict,
    summary: String(parsed.summary ?? ''),
    checks: Array.isArray(parsed.checks)
      ? parsed.checks
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const check = item as Record<string, unknown>;
            return {
              item: String(check.item ?? ''),
              status: String(check.status ?? 'unknown'),
              evidence: typeof check.evidence === 'string' ? check.evidence : undefined,
            };
          })
      : [],
    gaps: Array.isArray(parsed.gaps)
      ? parsed.gaps.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function renderAcceptance(
  specNumber: number,
  result: AcceptanceResult,
  pulls: Array<{ ticket: Issue; pr: PullRequest; checks: CheckRun[] }>,
): string {
  return [
    `# Acceptance for spec #${specNumber}`,
    '',
    `Verdict: **${result.verdict}**`,
    '',
    result.summary,
    '',
    '## Checks',
    ...(result.checks.length > 0
      ? result.checks.map((check) => `- [${check.status}] ${check.item}${check.evidence ? ` — ${check.evidence}` : ''}`)
      : ['- None']),
    '',
    '## Gaps',
    ...(result.gaps.length > 0 ? result.gaps.map((gap) => `- ${gap}`) : ['- None']),
    '',
    '## Merged pull requests',
    ...(pulls.length > 0
      ? pulls.map(
          (item) =>
            `- #${item.ticket.number} -> PR #${item.pr.number} (${item.pr.state}); checks: ${
              item.checks.map((check) => `${check.name}=${check.bucket}`).join(', ') || 'none'
            }`,
        )
      : ['- None']),
    '',
  ].join('\n');
}

function isGreen(bucket: string): boolean {
  return bucket === 'pass' || bucket === 'skipping';
}
