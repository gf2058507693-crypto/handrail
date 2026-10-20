import { createContext } from '../core/context.js';
import { GateError } from '../core/errors.js';
import { Logger } from '../core/logger.js';
import { approveSpec, approveTickets } from '../core/workflow/approve.js';
import { clarify } from '../core/workflow/clarify.js';
import { intake } from '../core/workflow/intake.js';
import { createSpec } from '../core/workflow/spec.js';
import { planTickets, publishTickets } from '../core/workflow/tickets.js';
import { triageIssue } from '../core/workflow/triage.js';
import { parseIssueNumber, resolveRequirement, resolveSpec } from './helpers.js';

export interface FlowContextOptions {
  cwd: string;
  verbose?: boolean;
  json?: boolean;
}

export async function intakeCommand(
  options: FlowContextOptions & {
    prd: string;
    title?: string;
    source?: string;
    dryRun?: boolean;
  },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  await intake(context, {
    prd: options.prd,
    title: options.title,
    source: options.source,
    dryRun: options.dryRun,
  });
}

export async function clarifyCommand(
  options: FlowContextOptions & {
    issue?: string;
    interactive?: boolean;
    rounds?: string;
    comment?: boolean;
    writeDocs?: boolean;
  },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const issue = await resolveRequirement(context, options.issue);
  const rounds = options.rounds ? Number(options.rounds) : undefined;
  await clarify(context, issue, {
    interactive: options.interactive,
    rounds,
    comment: options.comment,
    writeDocs: options.writeDocs,
  });
}

export async function triageCommand(
  options: FlowContextOptions & { issue: string; apply?: boolean },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  await triageIssue(context, parseIssueNumber(options.issue), options.apply);
}

export async function specCommand(
  options: FlowContextOptions & { requirement?: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const requirement = await resolveRequirement(context, options.requirement);
  await createSpec(context, requirement);
}

export async function ticketsCommand(
  options: FlowContextOptions & { spec?: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = await resolveSpec(context, options.spec);
  await planTickets(context, spec);
}

export async function approveCommand(
  options: FlowContextOptions & { kind: string; number: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const number = parseIssueNumber(options.number);
  if (options.kind === 'spec') {
    await approveSpec(context, number);
    return;
  }
  if (options.kind === 'tickets') {
    await approveTickets(context, number);
    return;
  }
  throw new GateError(
    `Unknown approval kind: ${options.kind}`,
    'Use "handrail approve spec <issue>" or "handrail approve tickets <spec>".',
  );
}

export async function publishCommand(
  options: FlowContextOptions & { kind: string; number?: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = await resolveSpec(context, options.number);
  if (options.kind !== 'tickets') {
    throw new GateError(
      `Unknown publish kind: ${options.kind}`,
      'Use "handrail publish tickets <spec>".',
    );
  }
  await publishTickets(context, spec);
}
