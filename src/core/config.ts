import path from 'node:path';
import { HandrailError } from './errors.js';
import { exists, readText, writeTextAtomic } from './fs.js';
import type { HandrailConfig, LabelSet } from '../types.js';

export const CONFIG_DIR = '.handrail';
export const CONFIG_FILE = 'config.json';

export const DEFAULT_LABELS: LabelSet = {
  requirement: 'requirement',
  spec: 'spec',
  task: 'task',
  needsTriage: 'needs-triage',
  needsInfo: 'needs-info',
  specReview: 'spec-review',
  specApproved: 'spec-approved',
  ticketsApproved: 'tickets-approved',
  needsTicketReview: 'needs-ticket-review',
  readyForAgent: 'ready-for-agent',
  readyForHuman: 'ready-for-human',
  wontfix: 'wontfix',
  blocked: 'blocked',
};

export const DEFAULT_LABEL_META: Record<
  keyof LabelSet,
  { color: string; description: string }
> = {
  requirement: { color: '0e8a16', description: 'Product requirement intake' },
  spec: { color: '1d76db', description: 'Approved or draft engineering specification' },
  task: { color: '5319e7', description: 'Independently deliverable implementation ticket' },
  needsTriage: { color: 'fbca04', description: 'Waiting for triage' },
  needsInfo: { color: 'd4c5f9', description: 'Waiting for more information' },
  specReview: { color: 'fbca04', description: 'Spec waiting for human approval' },
  specApproved: { color: '0e8a16', description: 'Spec approved by a human' },
  ticketsApproved: { color: '0e8a16', description: 'Ticket split approved by a human' },
  needsTicketReview: { color: 'fbca04', description: 'Ticket split waiting for human review' },
  readyForAgent: { color: 'c2e0c6', description: 'Ready for an agent to work on' },
  readyForHuman: { color: 'f9d0c4', description: 'Needs a human decision' },
  wontfix: { color: 'ffffff', description: 'Will not be fixed' },
  blocked: { color: 'b60205', description: 'Blocked by another ticket' },
};

export function defaultConfig(projectName = 'project'): HandrailConfig {
  return {
    version: 1,
    project: {
      name: projectName,
      docsDir: 'docs',
      adrDir: 'docs/adr',
      glossary: 'GLOSSARY.md',
    },
    github: {
      repo: null,
      baseBranch: 'main',
      labels: { ...DEFAULT_LABELS },
    },
    agent: {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      maxTokens: 8192,
      maxTurns: 40,
      command: ['claude', '-p'],
      commandTimeoutMs: 30 * 60 * 1000,
      allowedCommands: [],
      deniedCommands: [
        'rm -rf /',
        'git push --force',
        'git reset --hard',
        'git clean -fd',
        'shutdown',
        'reboot',
      ],
    },
    checks: {
      commands: [],
      timeoutMs: 10 * 60 * 1000,
    },
    workflow: {
      requireSpecApproval: true,
      requireTicketsApproval: true,
      requireReview: true,
      requireChecks: true,
      requireCleanCI: true,
      branchPrefix: 'feat/issue-',
      maxTicketsPerSpec: 12,
    },
  };
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_DIR, CONFIG_FILE);
}

export function statePath(root: string): string {
  return path.join(root, CONFIG_DIR, 'state.json');
}

export async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  for (;;) {
    if (await exists(configPath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new HandrailError(
        'NOT_INITIALIZED',
        `No ${CONFIG_DIR}/${CONFIG_FILE} found from ${start} upward.`,
        'Run "handrail init" in your repository first.',
      );
    }
    current = parent;
  }
}

export async function loadConfig(root: string): Promise<HandrailConfig> {
  const file = configPath(root);
  if (!(await exists(file))) {
    throw new HandrailError(
      'CONFIG_MISSING',
      `Missing ${file}.`,
      'Run "handrail init" first.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(file));
  } catch (error) {
    throw new HandrailError(
      'CONFIG_INVALID_JSON',
      `Cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return validateConfig(parsed, file);
}

export async function saveConfig(root: string, config: HandrailConfig): Promise<void> {
  await writeTextAtomic(configPath(root), `${JSON.stringify(config, null, 2)}\n`);
}

export function validateConfig(input: unknown, source = 'config'): HandrailConfig {
  if (!isRecord(input)) {
    throw new HandrailError('CONFIG_INVALID', `${source} must be a JSON object.`);
  }
  const base = defaultConfig();
  const project = isRecord(input.project) ? input.project : {};
  const github = isRecord(input.github) ? input.github : {};
  const labelsInput = isRecord(github.labels) ? github.labels : {};
  const agent = isRecord(input.agent) ? input.agent : {};
  const checks = isRecord(input.checks) ? input.checks : {};
  const workflow = isRecord(input.workflow) ? input.workflow : {};

  const config: HandrailConfig = {
    version: 1,
    project: {
      name: stringValue(project.name, base.project.name, `${source}.project.name`),
      docsDir: stringValue(project.docsDir, base.project.docsDir, `${source}.project.docsDir`),
      adrDir: stringValue(project.adrDir, base.project.adrDir, `${source}.project.adrDir`),
      glossary: stringValue(project.glossary, base.project.glossary, `${source}.project.glossary`),
    },
    github: {
      repo:
        github.repo === null || github.repo === undefined
          ? null
          : stringValue(github.repo, '', `${source}.github.repo`),
      baseBranch: stringValue(
        github.baseBranch,
        base.github.baseBranch,
        `${source}.github.baseBranch`,
      ),
      labels: mergeLabels(labelsInput, base.github.labels, `${source}.github.labels`),
    },
    agent: {
      provider: providerValue(agent.provider, base.agent.provider, `${source}.agent.provider`),
      model: stringValue(agent.model, base.agent.model, `${source}.agent.model`),
      baseUrl: stringValue(agent.baseUrl, base.agent.baseUrl, `${source}.agent.baseUrl`),
      apiKeyEnv: stringValue(agent.apiKeyEnv, base.agent.apiKeyEnv, `${source}.agent.apiKeyEnv`),
      maxTokens: numberValue(agent.maxTokens, base.agent.maxTokens, `${source}.agent.maxTokens`),
      maxTurns: numberValue(agent.maxTurns, base.agent.maxTurns, `${source}.agent.maxTurns`),
      command: stringArray(agent.command, base.agent.command, `${source}.agent.command`),
      commandTimeoutMs: numberValue(
        agent.commandTimeoutMs,
        base.agent.commandTimeoutMs,
        `${source}.agent.commandTimeoutMs`,
      ),
      allowedCommands: stringArray(
        agent.allowedCommands,
        base.agent.allowedCommands,
        `${source}.agent.allowedCommands`,
      ),
      deniedCommands: stringArray(
        agent.deniedCommands,
        base.agent.deniedCommands,
        `${source}.agent.deniedCommands`,
      ),
    },
    checks: {
      commands: stringArray(checks.commands, base.checks.commands, `${source}.checks.commands`),
      timeoutMs: numberValue(checks.timeoutMs, base.checks.timeoutMs, `${source}.checks.timeoutMs`),
    },
    workflow: {
      requireSpecApproval: boolValue(
        workflow.requireSpecApproval,
        base.workflow.requireSpecApproval,
        `${source}.workflow.requireSpecApproval`,
      ),
      requireTicketsApproval: boolValue(
        workflow.requireTicketsApproval,
        base.workflow.requireTicketsApproval,
        `${source}.workflow.requireTicketsApproval`,
      ),
      requireReview: boolValue(
        workflow.requireReview,
        base.workflow.requireReview,
        `${source}.workflow.requireReview`,
      ),
      requireChecks: boolValue(
        workflow.requireChecks,
        base.workflow.requireChecks,
        `${source}.workflow.requireChecks`,
      ),
      requireCleanCI: boolValue(
        workflow.requireCleanCI,
        base.workflow.requireCleanCI,
        `${source}.workflow.requireCleanCI`,
      ),
      branchPrefix: stringValue(
        workflow.branchPrefix,
        base.workflow.branchPrefix,
        `${source}.workflow.branchPrefix`,
      ),
      maxTicketsPerSpec: numberValue(
        workflow.maxTicketsPerSpec,
        base.workflow.maxTicketsPerSpec,
        `${source}.workflow.maxTicketsPerSpec`,
      ),
    },
  };

  if (config.agent.maxTokens < 256) {
    throw new HandrailError('CONFIG_INVALID', `${source}.agent.maxTokens must be at least 256.`);
  }
  if (config.agent.maxTurns < 1) {
    throw new HandrailError('CONFIG_INVALID', `${source}.agent.maxTurns must be at least 1.`);
  }
  if (config.workflow.maxTicketsPerSpec < 1) {
    throw new HandrailError(
      'CONFIG_INVALID',
      `${source}.workflow.maxTicketsPerSpec must be at least 1.`,
    );
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HandrailError('CONFIG_INVALID', `${field} must be a non-empty string.`);
  }
  return value;
}

function numberValue(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HandrailError('CONFIG_INVALID', `${field} must be a number.`);
  }
  return value;
}

function boolValue(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new HandrailError('CONFIG_INVALID', `${field} must be a boolean.`);
  }
  return value;
}

function stringArray(value: unknown, fallback: string[], field: string): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HandrailError('CONFIG_INVALID', `${field} must be an array of strings.`);
  }
  return [...value];
}

function mergeLabels(
  input: Record<string, unknown>,
  fallback: LabelSet,
  field: string,
): LabelSet {
  const result = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof LabelSet>) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new HandrailError('CONFIG_INVALID', `${field}.${key} must be a non-empty string.`);
    }
    result[key] = value;
  }
  return result;
}

function providerValue(
  value: unknown,
  fallback: HandrailConfig['agent']['provider'],
  field: string,
): HandrailConfig['agent']['provider'] {
  if (value === undefined) return fallback;
  if (value !== 'anthropic' && value !== 'command' && value !== 'mock') {
    throw new HandrailError('CONFIG_INVALID', `${field} must be anthropic, command or mock.`);
  }
  return value;
}
