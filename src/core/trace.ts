import type { GitHub } from './github.js';
import type { HandrailConfig, Issue, PullRequest, TraceChain } from '../types.js';
import { parseLinkedIssue } from './gates.js';

export async function traceRequirement(
  requirementNumber: number,
  github: GitHub,
  config: HandrailConfig,
): Promise<TraceChain> {
  const requirement = await github.issueView(requirementNumber);
  const allIssues = await github.issueList({ state: 'all', limit: 200 });

  const specs = allIssues.filter(
    (issue) =>
      issue.labels.includes(config.github.labels.spec) &&
      parseLinkedIssue(issue.body, 'Request') === requirementNumber,
  );
  const spec = specs[0];

  const tickets = spec
    ? allIssues.filter(
        (issue) =>
          issue.labels.includes(config.github.labels.task) &&
          parseLinkedIssue(issue.body, 'Spec') === spec.number,
      )
    : [];

  const pulls: PullRequest[] = [];
  for (const ticket of tickets) {
    const branch = `${config.workflow.branchPrefix}${ticket.number}`;
    const pr = await github.prForBranch(branch);
    if (pr) pulls.push(pr);
  }

  return { requirement, spec, tickets, pulls };
}

export function renderTrace(chain: TraceChain, config: HandrailConfig): string {
  const lines: string[] = [];
  lines.push(`Requirement #${chain.requirement?.number ?? '?'}  ${chain.requirement?.title ?? ''}`);
  if (!chain.spec) {
    lines.push('  (no spec linked yet)');
    return lines.join('\n');
  }
  lines.push(`  Spec #${chain.spec.number}  ${chain.spec.title}`);
  if (chain.tickets.length === 0) {
    lines.push('    (no tickets published yet)');
  }
  for (const ticket of chain.tickets) {
    const pr = chain.pulls.find((pull) => pull.headRefName === `${config.workflow.branchPrefix}${ticket.number}`);
    const state = ticket.state === 'CLOSED' ? 'closed' : 'open';
    lines.push(
      `    Ticket #${ticket.number} [${state}] ${ticket.title}${pr ? ` -> PR #${pr.number} (${pr.state})` : ''}`,
    );
  }
  return lines.join('\n');
}

export function findIssueByNumber(issues: Issue[], number: number): Issue | undefined {
  return issues.find((issue) => issue.number === number);
}
