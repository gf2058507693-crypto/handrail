import { GateError } from './errors.js';
import type { HandrailConfig, Issue } from '../types.js';

export function hasLabel(issue: Issue, label: string): boolean {
  return issue.labels.includes(label);
}

export function requireLabel(issue: Issue, label: string, hint: string): void {
  if (!hasLabel(issue, label)) {
    throw new GateError(`Issue #${issue.number} is missing the "${label}" label.`, hint);
  }
}

export function requireSpecApproved(issue: Issue, config: HandrailConfig): void {
  if (!config.workflow.requireSpecApproval) return;
  requireLabel(
    issue,
    config.github.labels.specApproved,
    `A human must approve the spec first: handrail approve spec ${issue.number}`,
  );
}

export function requireTicketsApproved(issue: Issue, config: HandrailConfig): void {
  if (!config.workflow.requireTicketsApproval) return;
  requireLabel(
    issue,
    config.github.labels.ticketsApproved,
    `A human must approve the ticket split first: handrail approve tickets ${issue.number}`,
  );
}

export function requireTaskLabel(issue: Issue, config: HandrailConfig): void {
  requireLabel(
    issue,
    config.github.labels.task,
    'This issue is not an implementation ticket. Publish tickets with "handrail publish tickets <spec>".',
  );
}

export function isSpecIssue(issue: Issue, config: HandrailConfig): boolean {
  return hasLabel(issue, config.github.labels.spec);
}

export function isRequirementIssue(issue: Issue, config: HandrailConfig): boolean {
  return hasLabel(issue, config.github.labels.requirement);
}

export function isTaskIssue(issue: Issue, config: HandrailConfig): boolean {
  return hasLabel(issue, config.github.labels.task);
}

export function parseLinkedIssue(body: string, field: string): number | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}\\s*:\\s*#(\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

export function parseBlockedBy(body: string): number[] {
  const numbers = new Set<number>();
  const lines = body.split('\n');
  for (const line of lines) {
    if (!/blocked\s+by/i.test(line)) continue;
    for (const match of line.matchAll(/#(\d+)/g)) {
      numbers.add(Number(match[1]));
    }
  }
  return [...numbers];
}

export function parseCloses(body: string): number[] {
  const numbers = new Set<number>();
  for (const match of body.matchAll(/\bCloses\s+#(\d+)/gi)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers];
}
