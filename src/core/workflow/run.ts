import { GateError } from '../errors.js';
import { parseBlockedBy } from '../gates.js';
import { summarizeChecks } from '../checks.js';
import { assertDependenciesMet, loadSpecContext } from './common.js';
import { implementTicket } from './implement.js';
import { createPullRequest } from './pr.js';
import type { Context } from '../context.js';
import type { Issue } from '../../types.js';

export interface RunOptions {
  spec?: number;
  maxTickets?: number;
  watch?: boolean;
  watchTimeoutMinutes?: number;
  skipReview?: boolean;
  allowNoChecks?: boolean;
  allowNoCI?: boolean;
}

export async function runSpec(context: Context, options: RunOptions = {}): Promise<void> {
  const state = await context.state.load();
  const specNumber = options.spec ?? state.activeSpec;
  if (!specNumber) {
    throw new GateError(
      'No active spec.',
      'Pass a spec number: handrail run <spec>.',
    );
  }

  const { spec, requirement } = await loadSpecContext(context, specNumber);
  const allIssues = await context.github.issueList({ state: 'all', limit: 200 });
  const tickets = allIssues.filter(
    (issue) =>
      issue.labels.includes(context.config.github.labels.task) &&
      Number((issue.body.match(/Spec\s*:\s*#(\d+)/i) ?? [])[1]) === specNumber,
  );
  if (tickets.length === 0) {
    throw new GateError(
      `Spec #${specNumber} has no tickets.`,
      `Run "handrail publish tickets ${specNumber}" first.`,
    );
  }

  const ordered = orderIssues(tickets);
  const limit = Math.min(options.maxTickets ?? ordered.length, ordered.length);
  context.logger.section(
    `Running spec #${specNumber}: ${spec.title} (requirement #${requirement.number})`,
  );
  context.logger.info(`Tickets in dependency order: ${ordered.map((ticket) => `#${ticket.number}`).join(', ')}`);

  let processed = 0;
  for (const ticket of ordered) {
    if (processed >= limit) break;
    if (ticket.state === 'CLOSED') continue;

    await assertDependenciesMet(context, parseBlockedBy(ticket.body));

    const branch = `${context.config.workflow.branchPrefix}${ticket.number}`;
    let pr = await context.github.prForBranch(branch);

    if (!pr) {
      context.logger.step(processed + 1, limit, `Implement #${ticket.number}: ${ticket.title}`);
      await implementTicket(context, ticket.number, {
        skipReview: options.skipReview,
        allowNoChecks: options.allowNoChecks,
      });
      const created = await createPullRequest(context, ticket.number, {
        create: true,
        draft: false,
        skipReview: options.skipReview,
      });
      pr = created.pr;
    }

    if (!pr) {
      throw new GateError(`No pull request was created for #${ticket.number}.`);
    }
    if (pr.state === 'MERGED') {
      context.logger.ok(`PR #${pr.number} already merged; moving on.`);
      continue;
    }

    const checks = await context.github.prChecks(pr.number);
    const summary = summarizeChecks(checks);
    context.logger.info(
      `PR #${pr.number} checks: ${summary.status} (${summary.total} check(s))`,
    );

    if (summary.status === 'fail') {
      throw new GateError(
        `CI failed on PR #${pr.number}: ${summary.failures
          .map((check) => `${check.name}=${check.bucket}`)
          .join(', ')}.`,
        `Fix the branch and push. Handrail will not merge with failing checks.`,
      );
    }

    if (!options.watch) {
      context.logger.info('');
      context.logger.info(`Human gate: review and merge PR #${pr.number} after CI passes.`);
      context.logger.info(`Then run "handrail run ${specNumber}" again to continue.`);
      return;
    }

    context.logger.info(
      `Waiting for PR #${pr.number} to be merged (timeout ${options.watchTimeoutMinutes ?? 30} minutes)...`,
    );
    await waitForMerge(context, pr.number, options.watchTimeoutMinutes ?? 30);
    processed += 1;
  }

  context.logger.ok(`No open tickets remain for spec #${specNumber}.`);
  context.logger.info(`Next: handrail accept ${specNumber}`);
}

function orderIssues(tickets: Issue[]): Issue[] {
  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));
  const visited = new Map<number, 'visiting' | 'done'>();
  const output: Issue[] = [];

  const visit = (number: number): void => {
    const state = visited.get(number);
    if (state === 'done') return;
    if (state === 'visiting') {
      throw new GateError(`Ticket dependency cycle detected at #${number}.`);
    }
    visited.set(number, 'visiting');
    const ticket = byNumber.get(number);
    if (!ticket) return;
    for (const dependency of parseBlockedBy(ticket.body)) {
      if (byNumber.has(dependency)) visit(dependency);
    }
    visited.set(number, 'done');
    output.push(ticket);
  };

  for (const ticket of tickets) visit(ticket.number);
  return output;
}

async function waitForMerge(context: Context, prNumber: number, timeoutMinutes: number): Promise<void> {
  const deadline = Date.now() + timeoutMinutes * 60 * 1000;
  const intervalMs = 30_000;

  for (;;) {
    const pr = await context.github.prView(prNumber);
    if (pr.state === 'MERGED') {
      context.logger.ok(`PR #${prNumber} merged.`);
      return;
    }
    if (pr.state === 'CLOSED') {
      throw new GateError(`PR #${prNumber} was closed without merging.`);
    }
    if (Date.now() >= deadline) {
      throw new GateError(
        `Timed out waiting for PR #${prNumber} to be merged.`,
        'Merge it manually and run "handrail run <spec>" again.',
      );
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
