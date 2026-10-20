import { GateError } from '../core/errors.js';
import { Logger } from '../core/logger.js';
import type { Context } from '../core/context.js';

export function createLoggerFrom(options: {
  verbose?: boolean;
  json?: boolean;
}): Logger {
  return new Logger({ verbose: options.verbose, json: options.json });
}

export async function resolveRequirement(context: Context, value?: string): Promise<number> {
  if (value) return parseIssueNumber(value);
  const state = await context.state.load();
  if (state.activeRequirement) return state.activeRequirement;
  throw new GateError(
    'No requirement specified.',
    'Pass an issue number or run "handrail intake --prd <file>" first.',
  );
}

export async function resolveSpec(context: Context, value?: string): Promise<number> {
  if (value) return parseIssueNumber(value);
  const state = await context.state.load();
  if (state.activeSpec) return state.activeSpec;
  throw new GateError(
    'No spec specified.',
    'Pass a spec number or run "handrail spec <requirement>" first.',
  );
}

export function parseIssueNumber(value: string): number {
  const match = String(value).match(/#?(\d+)/);
  if (!match) {
    throw new GateError(`Not an issue number: ${value}`);
  }
  return Number(match[1]);
}
