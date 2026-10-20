import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { scaffold } from '../core/scaffold.js';
import { GitHub } from '../core/github.js';
import { loadConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { AgentProvider } from '../types.js';

export interface InitCommandOptions {
  force?: boolean;
  dryRun?: boolean;
  agent?: AgentProvider;
  base?: string;
  name?: string;
  github?: boolean;
}

export async function initCommand(
  target: string,
  options: InitCommandOptions,
  logger: Logger,
): Promise<void> {
  const root = path.resolve(target);
  await mkdir(root, { recursive: true });

  const result = await scaffold(root, {
    force: options.force,
    dryRun: options.dryRun,
    agentProvider: options.agent,
    baseBranch: options.base,
    projectName: options.name,
  });

  logger.section(`Scaffolding ${root}`);
  for (const action of result.actions) {
    const label = {
      create: 'create',
      overwrite: 'update',
      skip: 'skip',
      'dry-run': 'would create',
    }[action.status];
    logger.info(`${label.padEnd(12)} ${action.path}${action.reason ? ` (${action.reason})` : ''}`);
  }

  logger.section('Detected project');
  logger.info(`Stack: ${result.detection.stack}`);
  logger.info(`Checks: ${result.detection.checks.length > 0 ? result.detection.checks.join(', ') : '(none)'}`);
  if (result.detection.checks.length === 0) {
    logger.warn(
      'No check command was detected. Add checks.commands to .handrail/config.json before implementing.',
    );
  }

  if (options.dryRun) {
    logger.warn('Dry run: no files were written.');
    return;
  }

  if (options.github) {
    const config = await loadConfig(root);
    const github = new GitHub(root, config);
    await github.ensureAuth();
    const labels = await github.ensureLabels(config.github.labels);
    logger.ok(`Created ${labels.created.length} label(s); ${labels.existing.length} already existed.`);
  }

  logger.section('Next steps');
  logger.info('1. Review AGENTS.md, GLOSSARY.md, .github/ and .handrail/config.json.');
  logger.info('2. Commit the scaffold.');
  logger.info('3. Run "handrail doctor" to check git, gh, labels and agent credentials.');
  logger.info('4. Configure branch protection: require PR, independent approval and the CI checks.');
  logger.info('5. Start with "handrail intake --prd <file>".');

  if (result.config.agent.provider === 'anthropic') {
    const env = result.config.agent.apiKeyEnv;
    if (!process.env[env]) {
      logger.warn(
        `${env} is not set. Implementation commands will fail until you export it or switch agent.provider to "command".`,
      );
    }
  }
}
