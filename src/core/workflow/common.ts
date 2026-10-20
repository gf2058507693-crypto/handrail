import path from 'node:path';
import { GateError, HandrailError } from '../errors.js';
import { writeTextAtomic } from '../fs.js';
import { parseBlockedBy, parseLinkedIssue, requireTicketsApproved, requireSpecApproved, requireTaskLabel } from '../gates.js';
import type { Context } from '../context.js';
import type { Issue, TicketDraft } from '../../types.js';

export interface TicketContext {
  ticket: Issue;
  spec: Issue;
  requirement: Issue;
  specNumber: number;
  requirementNumber: number;
  blockedBy: number[];
}

export interface SpecContext {
  spec: Issue;
  requirement: Issue;
  requirementNumber: number;
}

export async function loadSpecContext(context: Context, specNumber: number): Promise<SpecContext> {
  const spec = await context.github.issueView(specNumber);
  if (!spec.labels.includes(context.config.github.labels.spec)) {
    throw new GateError(
      `Issue #${specNumber} is not a spec issue.`,
      `Specs must carry the "${context.config.github.labels.spec}" label.`,
    );
  }
  const requirementNumber = parseLinkedIssue(spec.body, 'Request');
  if (!requirementNumber) {
    throw new GateError(
      `Spec #${specNumber} does not link a requirement ("Request: #<issue>").`,
      'Fix the spec body before continuing.',
    );
  }
  const requirement = await context.github.issueView(requirementNumber);
  return { spec, requirement, requirementNumber };
}

export async function loadTicketContext(
  context: Context,
  ticketNumber: number,
  options: { enforceGates?: boolean } = {},
): Promise<TicketContext> {
  const ticket = await context.github.issueView(ticketNumber);
  requireTaskLabel(ticket, context.config);

  const specNumber = parseLinkedIssue(ticket.body, 'Spec');
  const requirementNumber = parseLinkedIssue(ticket.body, 'Request');
  if (!specNumber || !requirementNumber) {
    throw new GateError(
      `Ticket #${ticketNumber} must link "Spec: #<issue>" and "Request: #<issue>".`,
    );
  }

  const spec = await context.github.issueView(specNumber);
  const requirement = await context.github.issueView(requirementNumber);
  if (options.enforceGates !== false) {
    requireSpecApproved(spec, context.config);
    requireTicketsApproved(spec, context.config);
  }

  return {
    ticket,
    spec,
    requirement,
    specNumber,
    requirementNumber,
    blockedBy: parseBlockedBy(ticket.body),
  };
}

export async function baseRef(context: Context): Promise<string> {
  const remote = `origin/${context.config.github.baseBranch}`;
  return (await context.git.revParse(`refs/remotes/${remote}`)) ? remote : context.config.github.baseBranch;
}

export async function fetchBase(context: Context): Promise<void> {
  const result = await context.git.fetch();
  if (result.exitCode !== 0) {
    context.logger.detail(`git fetch failed; continuing with local refs: ${result.stderr.slice(0, 300)}`);
  }
}

export async function assertDependenciesMet(
  context: Context,
  blockedBy: number[],
): Promise<void> {
  for (const dependency of blockedBy) {
    const issue = await context.github.tryIssue(dependency);
    if (!issue) {
      throw new GateError(
        `Ticket depends on #${dependency}, which cannot be read.`,
        'Fix the dependency reference before implementing.',
      );
    }
    if (issue.state !== 'CLOSED') {
      throw new GateError(
        `Ticket is blocked by #${dependency} (${issue.title}), which is still ${issue.state}.`,
        `Finish and merge #${dependency} first, or remove the dependency if it is not real.`,
      );
    }
  }
}

export async function runChecks(
  context: Context,
  input: {
    ticket: number;
    spec: number;
    commands: string[];
    allowNoChecks?: boolean;
  },
): Promise<{ ok: boolean; failed: string[] }> {
  if (input.commands.length === 0) {
    if (!input.allowNoChecks) {
      throw new GateError(
        'No check commands are configured.',
        'Add checks.commands to .handrail/config.json, or pass --allow-no-checks for an explicitly evidence-free run.',
      );
    }
    context.logger.warn('No checks configured; proceeding because --allow-no-checks was passed.');
    return { ok: true, failed: [] };
  }

  const failed: string[] = [];
  for (const command of input.commands) {
    context.logger.info(`Running check: ${command}`);
    const result = await (await import('../exec.js')).runCommand(command, {
      cwd: context.root,
      timeoutMs: context.config.checks.timeoutMs,
    });
    await context.evidence.recordCommand(result, 'check', {
      ticket: input.ticket,
      spec: input.spec,
      label: 'configured check',
    });
    if (result.exitCode === 0) {
      context.logger.ok(`Check passed: ${command}`);
    } else {
      failed.push(command);
      context.logger.error(
        `Check failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}): ${command}`,
      );
      if (result.stdout.trim()) context.logger.detail(result.stdout.slice(-2000));
      if (result.stderr.trim()) context.logger.detail(result.stderr.slice(-2000));
    }
  }

  return { ok: failed.length === 0, failed };
}

export async function evidenceMarkdown(context: Context, ticket: number): Promise<string> {
  const records = await context.evidence.list({ ticket });
  if (records.length === 0) return '_No commands were recorded._';
  const rows = records
    .filter((record) => record.kind === 'check' || record.kind === 'command')
    .map((record) => {
      const command = (record.command ?? record.kind).replace(/\|/g, '\\|');
      const result = record.exitCode === 0 ? 'PASS' : 'FAIL';
      return `| \`${command}\` | ${result} | ${record.exitCode ?? '-'} | ${record.durationMs ?? '-'} ms | ${record.timestamp} |`;
    });
  if (rows.length === 0) return '_No build or test commands were recorded._';
  return [
    '| Command | Result | exit_code | Duration | Recorded at |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

export function validateSpecBody(body: string): void {
  const required = [
    'Problem Statement',
    'Solution',
    'User Stories',
    'Implementation Decisions',
    'Testing Decisions',
    'Out of Scope',
    'Further Notes',
  ];
  const missing = required.filter(
    (section) => !new RegExp(`^##\\s+${section}\\s*$`, 'im').test(body),
  );
  if (missing.length > 0) {
    throw new HandrailError(
      'SPEC_INVALID',
      `The generated spec is missing required sections: ${missing.join(', ')}.`,
      'Re-run "handrail spec" or edit the draft before publishing.',
    );
  }
}

export interface ParsedTickets {
  tickets: TicketDraft[];
}

export function parseTickets(value: unknown, maxTickets: number): ParsedTickets {
  if (!isRecord(value) || !Array.isArray(value.tickets)) {
    throw new HandrailError('TICKETS_INVALID', 'Ticket output must be an object with a "tickets" array.');
  }
  if (value.tickets.length === 0) {
    throw new HandrailError('TICKETS_EMPTY', 'The ticket planner returned no tickets.');
  }
  if (value.tickets.length > maxTickets) {
    throw new HandrailError(
      'TICKETS_TOO_MANY',
      `The ticket planner returned ${value.tickets.length} tickets, above the limit of ${maxTickets}.`,
      'Raise workflow.maxTicketsPerSpec or split the spec.',
    );
  }

  const tickets: TicketDraft[] = value.tickets.map((item, index) => {
    if (!isRecord(item)) {
      throw new HandrailError('TICKETS_INVALID', `tickets[${index}] must be an object.`);
    }
    const key = stringField(item.key, `tickets[${index}].key`);
    const title = stringField(item.title, `tickets[${index}].title`);
    const goal = stringField(item.goal, `tickets[${index}].goal`);
    const acceptance = stringArrayField(item.acceptance, `tickets[${index}].acceptance`);
    if (acceptance.length === 0) {
      throw new HandrailError(
        'TICKETS_INVALID',
        `tickets[${index}] has no acceptance criteria.`,
        'Every ticket needs observable acceptance criteria.',
      );
    }
    return {
      key,
      title,
      goal,
      acceptance,
      blocked_by: stringArrayField(item.blocked_by, `tickets[${index}].blocked_by`),
      test_plan: stringArrayField(item.test_plan, `tickets[${index}].test_plan`),
      demo: stringField(item.demo, `tickets[${index}].demo`),
      files_hint: item.files_hint === undefined ? [] : stringArrayField(item.files_hint, `tickets[${index}].files_hint`),
    };
  });

  const keys = new Set(tickets.map((ticket) => ticket.key));
  if (keys.size !== tickets.length) {
    throw new HandrailError('TICKETS_DUPLICATE_KEY', 'Ticket keys must be unique.');
  }
  for (const ticket of tickets) {
    for (const dependency of ticket.blocked_by) {
      if (!keys.has(dependency)) {
        throw new HandrailError(
          'TICKETS_BAD_DEPENDENCY',
          `Ticket ${ticket.key} is blocked by unknown key ${dependency}.`,
        );
      }
      if (dependency === ticket.key) {
        throw new HandrailError('TICKETS_BAD_DEPENDENCY', `Ticket ${ticket.key} is blocked by itself.`);
      }
    }
  }
  topologicalOrder(tickets);
  return { tickets };
}

export function topologicalOrder(tickets: TicketDraft[]): TicketDraft[] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const visited = new Map<string, 'visiting' | 'done'>();
  const output: TicketDraft[] = [];

  const visit = (key: string): void => {
    const state = visited.get(key);
    if (state === 'done') return;
    if (state === 'visiting') {
      throw new HandrailError('TICKETS_CYCLE', `Ticket dependency cycle detected at ${key}.`);
    }
    visited.set(key, 'visiting');
    const ticket = byKey.get(key);
    if (!ticket) throw new HandrailError('TICKETS_BAD_DEPENDENCY', `Unknown ticket key ${key}.`);
    for (const dependency of ticket.blocked_by) visit(dependency);
    visited.set(key, 'done');
    output.push(ticket);
  };

  for (const ticket of tickets) visit(ticket.key);
  return output;
}

export function renderTicketBody(
  ticket: TicketDraft,
  input: { requirement: number; spec: number; blockedBy: number[] },
): string {
  return [
    `## Goal`,
    ticket.goal,
    '',
    `## Acceptance criteria`,
    ...ticket.acceptance.map((item) => `- [ ] ${item}`),
    '',
    `## Test plan`,
    ...(ticket.test_plan.length > 0 ? ticket.test_plan.map((item) => `- ${item}`) : ['- TBD']),
    '',
    `## Demo`,
    ticket.demo || 'TBD',
    '',
    `## Dependencies`,
    input.blockedBy.length > 0
      ? input.blockedBy.map((number) => `Blocked by #${number}`).join('\n')
      : 'None.',
    '',
    `## Traceability`,
    `Request: #${input.requirement}`,
    `Spec: #${input.spec}`,
    `Ticket key: ${ticket.key}`,
    '',
    `## Notes`,
    ticket.files_hint && ticket.files_hint.length > 0
      ? `Suggested files: ${ticket.files_hint.map((file) => `\`${file}\``).join(', ')}`
      : 'No file hints provided.',
  ].join('\n');
}

export async function writeDraft(context: Context, name: string, content: string): Promise<string> {
  const file = path.join(context.root, '.handrail', 'drafts', name);
  await writeTextAtomic(file, content);
  return file;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HandrailError('TICKETS_INVALID', `${field} must be a non-empty string.`);
  }
  return value;
}

function stringArrayField(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HandrailError('TICKETS_INVALID', `${field} must be an array of strings.`);
  }
  return value;
}
