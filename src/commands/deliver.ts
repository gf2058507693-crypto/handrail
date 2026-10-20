import { createContext } from '../core/context.js';
import { Logger } from '../core/logger.js';
import { acceptSpec } from '../core/workflow/accept.js';
import { runRetro } from '../core/workflow/retro.js';
import { getStatus } from '../core/workflow/status.js';
import { runSpec } from '../core/workflow/run.js';
import { traceRequirement, renderTrace } from '../core/trace.js';
import { resolveRequirement, resolveSpec } from './helpers.js';

export interface DeliverOptions {
  cwd: string;
  verbose?: boolean;
  json?: boolean;
}

export async function acceptCommand(
  options: DeliverOptions & { spec?: string; close?: boolean; allowNoCI?: boolean },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = await resolveSpec(context, options.spec);
  await acceptSpec(context, spec, { close: options.close, allowNoCI: options.allowNoCI });
}

export async function retroCommand(
  options: DeliverOptions & { spec?: string; publish?: boolean },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = await resolveSpec(context, options.spec);
  await runRetro(context, spec, { publish: options.publish });
}

export async function statusCommand(
  options: DeliverOptions & { spec?: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = options.spec ? Number(options.spec) : undefined;
  const report = await getStatus(context, { spec });
  if (options.json) console.log(JSON.stringify(report, null, 2));
}

export async function traceCommand(
  options: DeliverOptions & { requirement?: string },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const requirement = await resolveRequirement(context, options.requirement);
  const chain = await traceRequirement(requirement, context.github, context.config);
  if (options.json) {
    console.log(JSON.stringify(chain, null, 2));
    return;
  }
  console.log(renderTrace(chain, context.config));
}

export async function runCommand(
  options: DeliverOptions & {
    spec?: string;
    maxTickets?: string;
    watch?: boolean;
    watchTimeout?: string;
    skipReview?: boolean;
    allowNoChecks?: boolean;
    allowNoCI?: boolean;
  },
): Promise<void> {
  const context = await createContext(options.cwd, new Logger({ verbose: options.verbose }));
  const spec = await resolveSpec(context, options.spec);
  await runSpec(context, {
    spec,
    maxTickets: options.maxTickets ? Number(options.maxTickets) : undefined,
    watch: options.watch,
    watchTimeoutMinutes: options.watchTimeout ? Number(options.watchTimeout) : undefined,
    skipReview: options.skipReview,
    allowNoChecks: options.allowNoChecks,
    allowNoCI: options.allowNoCI,
  });
}
