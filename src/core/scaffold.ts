import path from 'node:path';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defaultConfig, configPath } from './config.js';
import { detectProject, renderCiWorkflow } from './detect.js';
import { ensureDir, exists, readText, readTextIfExists, writeText, writeTextAtomic } from './fs.js';
import { renderTemplate } from './prompts.js';
import type { AgentProvider, HandrailConfig } from '../types.js';

const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export interface ScaffoldOptions {
  force?: boolean;
  dryRun?: boolean;
  agentProvider?: AgentProvider;
  baseBranch?: string;
  projectName?: string;
}

export interface ScaffoldAction {
  path: string;
  status: 'create' | 'overwrite' | 'skip' | 'dry-run';
  reason?: string;
}

export async function scaffold(
  root: string,
  options: ScaffoldOptions = {},
): Promise<{ actions: ScaffoldAction[]; config: HandrailConfig; detection: Awaited<ReturnType<typeof detectProject>> }> {
  const detection = await detectProject(root);
  const projectName = options.projectName ?? path.basename(path.resolve(root));
  const baseBranch = options.baseBranch ?? 'main';
  const config = defaultConfig(projectName);
  config.github.baseBranch = baseBranch;
  config.checks.commands = detection.checks;
  config.agent.provider = options.agentProvider ?? 'anthropic';

  const actions: ScaffoldAction[] = [];
  const write = async (
    relativePath: string,
    content: string,
    mode?: number,
  ): Promise<void> => {
    const target = path.join(root, relativePath);
    const alreadyExists = await exists(target);
    if (alreadyExists && !options.force) {
      actions.push({ path: relativePath, status: 'skip', reason: 'already exists' });
      return;
    }
    if (options.dryRun) {
      actions.push({ path: relativePath, status: 'dry-run' });
      return;
    }
    await writeText(target, content);
    if (mode !== undefined) {
      await chmod(target, mode);
    }
    actions.push({ path: relativePath, status: alreadyExists ? 'overwrite' : 'create' });
  };

  const files = await buildTemplateFiles(root, config, baseBranch, detection);
  for (const [relativePath, content] of files) {
    const mode = relativePath.endsWith('.mjs') ? 0o755 : undefined;
    await write(relativePath, content, mode);
  }

  // The config is written last so a partially scaffolded repo still has a usable config.
  const configTarget = configPath(root);
  if (await exists(configTarget)) {
    if (options.force) {
      if (!options.dryRun) await writeTextAtomic(configTarget, `${JSON.stringify(config, null, 2)}\n`);
      actions.push({ path: '.handrail/config.json', status: options.dryRun ? 'dry-run' : 'overwrite' });
    } else {
      actions.push({ path: '.handrail/config.json', status: 'skip', reason: 'already exists' });
    }
  } else {
    if (!options.dryRun) {
      await ensureDir(path.dirname(configTarget));
      await writeTextAtomic(configTarget, `${JSON.stringify(config, null, 2)}\n`);
    }
    actions.push({ path: '.handrail/config.json', status: options.dryRun ? 'dry-run' : 'create' });
  }

  const gitignoreAction = await updateGitignore(root, options.dryRun ?? false);
  if (gitignoreAction) actions.push(gitignoreAction);

  return { actions, config, detection };
}

async function buildTemplateFiles(
  root: string,
  config: HandrailConfig,
  baseBranch: string,
  detection: Awaited<ReturnType<typeof detectProject>>,
): Promise<Array<[string, string]>> {
  const values = {
    projectName: config.project.name,
    baseBranch,
    specApproved: config.github.labels.specApproved,
    ticketsApproved: config.github.labels.ticketsApproved,
    taskLabel: config.github.labels.task,
  };

  const fixed: Array<[string, string]> = [
    ['AGENTS.md', 'AGENTS.md'],
    ['GLOSSARY.md', 'GLOSSARY.md'],
    ['docs/adr/0001-record-architecture-decisions.md', 'adr/0001-record-architecture-decisions.md'],
    ['docs/ai-workflow.md', 'docs/ai-workflow.md'],
    ['.github/ISSUE_TEMPLATE/feature.yml', 'github/ISSUE_TEMPLATE/feature.yml'],
    ['.github/ISSUE_TEMPLATE/bug.yml', 'github/ISSUE_TEMPLATE/bug.yml'],
    ['.github/PULL_REQUEST_TEMPLATE.md', 'github/PULL_REQUEST_TEMPLATE.md'],
    ['.github/CODEOWNERS', 'github/CODEOWNERS'],
    ['.github/workflows/ai-dev-policy.yml', 'github/workflows/ai-dev-policy.yml'],
    ['.github/scripts/policy.mjs', 'github/scripts/policy.mjs'],
  ];

  const result: Array<[string, string]> = [];
  for (const [target, source] of fixed) {
    const raw = await readText(path.join(templateDir, source));
    result.push([target, renderTemplate(raw, values)]);
  }

  result.push(['.github/workflows/ci.yml', renderCiWorkflow(detection, baseBranch)]);
  return result;
}

async function updateGitignore(root: string, dryRun: boolean): Promise<ScaffoldAction | null> {
  const file = path.join(root, '.gitignore');
  const current = (await readTextIfExists(file)) ?? '';
  const block = [
    '# Handrail runtime artifacts',
    '.handrail/state.json',
    '.handrail/evidence/',
    '.handrail/drafts/',
    '.handrail/tmp/',
  ];
  const missing = block.filter((line) => !current.split('\n').includes(line));
  if (missing.length === 0) return null;
  if (dryRun) return { path: '.gitignore', status: 'dry-run' };
  const prefix = current.trimEnd();
  const content = `${prefix}${prefix ? '\n\n' : ''}${block.join('\n')}\n`;
  await writeText(file, content);
  return { path: '.gitignore', status: current ? 'overwrite' : 'create' };
}
