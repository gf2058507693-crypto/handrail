import path from 'node:path';
import { findProjectRoot, loadConfig } from './config.js';
import { Git } from './git.js';
import { GitHub } from './github.js';
import { StateStore } from './state.js';
import { EvidenceStore } from './evidence.js';
import { createAgent, type Agent } from './agent/index.js';
import { readTextIfExists } from './fs.js';
import type { HandrailConfig } from '../types.js';
import type { Logger } from './logger.js';

export interface Context {
  root: string;
  config: HandrailConfig;
  git: Git;
  github: GitHub;
  state: StateStore;
  evidence: EvidenceStore;
  agent: Agent;
  logger: Logger;
}

export async function createContext(cwd: string, logger: Logger): Promise<Context> {
  const root = await findProjectRoot(cwd);
  const config = await loadConfig(root);
  const evidence = new EvidenceStore(root);
  return {
    root,
    config,
    git: new Git(root),
    github: new GitHub(root, config),
    state: new StateStore(root),
    evidence,
    agent: createAgent(root, config.agent, evidence),
    logger,
  };
}

export async function loadDocsBundle(context: Context): Promise<string> {
  const parts: string[] = [];
  const agents = await readTextIfExists(path.join(context.root, 'AGENTS.md'));
  if (agents) parts.push(`## AGENTS.md\n\n${agents}`);
  const glossary = await readTextIfExists(path.join(context.root, context.config.project.glossary));
  if (glossary) parts.push(`## ${context.config.project.glossary}\n\n${glossary}`);

  const adrDir = path.join(context.root, context.config.project.adrDir);
  const adrFiles = await listMarkdownFiles(adrDir, 12);
  for (const file of adrFiles) {
    const content = await readTextIfExists(path.join(adrDir, file));
    if (content) {
      const trimmed = content.length > 6000 ? `${content.slice(0, 6000)}\n[truncated]` : content;
      parts.push(`## ADR ${file}\n\n${trimmed}`);
    }
  }

  return truncate(parts.join('\n\n'), 40_000);
}

export async function listRepoFiles(context: Context, limit = 200): Promise<string> {
  const result = await context.git.run(['ls-files']);
  if (result.exitCode !== 0) return '(repository file list unavailable)';
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join('\n');
}

async function listMarkdownFiles(dir: string, limit: number): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
      .slice(0, limit);
  } catch {
    return [];
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[truncated at ${max} characters]`;
}
