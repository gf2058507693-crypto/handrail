import { createContext } from '../core/context.js';
import { Logger } from '../core/logger.js';
import { implementTicket } from '../core/workflow/implement.js';
import { reviewTicket } from '../core/workflow/review.js';
import { createPullRequest } from '../core/workflow/pr.js';
import { parseIssueNumber } from './helpers.js';

export interface ActionOptions {
  cwd: string;
  verbose?: boolean;
}

export async function implementCommand(
  options: ActionOptions & {
    ticket: string;
    skipReview?: boolean;
    skipChecks?: boolean;
    allowNoChecks?: boolean;
  },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  await implementTicket(context, parseIssueNumber(options.ticket), {
    skipReview: options.skipReview,
    skipChecks: options.skipChecks,
    allowNoChecks: options.allowNoChecks,
  });
}

export async function reviewCommand(
  options: ActionOptions & { ticket: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  await reviewTicket(context, parseIssueNumber(options.ticket));
}

export async function prCommand(
  options: ActionOptions & {
    ticket: string;
    create?: boolean;
    ready?: boolean;
    skipReview?: boolean;
  },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  await createPullRequest(context, parseIssueNumber(options.ticket), {
    create: options.create,
    draft: options.ready ? false : true,
    skipReview: options.skipReview,
  });
}
