import { createContext } from '../core/context.js';
import { Logger } from '../core/logger.js';
import { commandExists } from '../core/exec.js';

export interface DoctorOptions {
  cwd: string;
  verbose?: boolean;
}

interface Check {
  name: string;
  ok: boolean;
  critical: boolean;
  detail: string;
}

export async function doctorCommand(options: DoctorOptions): Promise<boolean> {
  const logger = new Logger({ verbose: options.verbose });
  const checks: Check[] = [];

  checks.push({
    name: 'Node.js >= 20',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    critical: true,
    detail: process.version,
  });

  let context;
  try {
    context = await createContext(options.cwd, logger);
    checks.push({ name: 'Handrail config', ok: true, critical: true, detail: '.handrail/config.json' });
  } catch (error) {
    checks.push({
      name: 'Handrail config',
      ok: false,
      critical: true,
      detail: error instanceof Error ? error.message : String(error),
    });
    print(logger, checks);
    return false;
  }

  const gitRepo = await context.git.run(['rev-parse', '--is-inside-work-tree']);
  checks.push({
    name: 'Git repository',
    ok: gitRepo.exitCode === 0 && gitRepo.stdout.trim() === 'true',
    critical: true,
    detail: context.root,
  });

  const remote = await context.git.remoteUrl();
  checks.push({
    name: 'Origin remote',
    ok: Boolean(remote),
    critical: true,
    detail: remote ?? 'missing',
  });

  const ghAvailable = await commandExists('gh', context.root);
  checks.push({ name: 'GitHub CLI', ok: ghAvailable, critical: true, detail: ghAvailable ? 'gh' : 'not installed' });

  if (ghAvailable) {
    const auth = await context.github.run(['auth', 'status']);
    let user = '';
    if (auth.exitCode === 0) {
      try {
        user = await context.github.currentUser();
      } catch {
        user = 'unknown';
      }
    }
    checks.push({
      name: 'GitHub authentication',
      ok: auth.exitCode === 0,
      critical: true,
      detail: auth.exitCode === 0 ? `@${user}` : auth.stderr.trim().slice(0, 200),
    });

    if (auth.exitCode === 0) {
      try {
        const repo = await context.github.repoName();
        checks.push({ name: 'GitHub repository', ok: true, critical: true, detail: repo });
        const raw = await context.github.run(['label', 'list', '--limit', '200', '--json', 'name']);
        const existing = new Set(
          (JSON.parse(raw.stdout) as Array<{ name: string }>).map((label) => label.name),
        );
        const wanted = Object.values(context.config.github.labels);
        const missing = wanted.filter((name) => !existing.has(name));
        checks.push({
          name: 'Workflow labels',
          ok: missing.length === 0,
          critical: false,
          detail: missing.length === 0 ? `${wanted.length} labels` : `missing: ${missing.join(', ')}`,
        });
      } catch (error) {
        checks.push({
          name: 'GitHub repository',
          ok: false,
          critical: true,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  checks.push({
    name: 'Check commands',
    ok: context.config.checks.commands.length > 0,
    critical: false,
    detail:
      context.config.checks.commands.length > 0
        ? context.config.checks.commands.join('; ')
        : 'none configured',
  });

  const provider = context.config.agent.provider;
  if (provider === 'anthropic') {
    const env = context.config.agent.apiKeyEnv;
    checks.push({
      name: `Agent API key (${env})`,
      ok: Boolean(process.env[env]),
      critical: true,
      detail: process.env[env] ? 'set' : 'not set',
    });
  } else if (provider === 'command') {
    const executable = context.config.agent.command[0] ?? '';
    const found = executable ? await commandExists(executable, context.root) : false;
    checks.push({
      name: 'Agent command',
      ok: found,
      critical: true,
      detail: found ? context.config.agent.command.join(' ') : `${executable || '(empty)'} not found`,
    });
  } else {
    checks.push({ name: 'Agent provider', ok: true, critical: false, detail: 'mock' });
  }

  const clean = await context.git.isClean();
  checks.push({
    name: 'Working tree',
    ok: clean,
    critical: false,
    detail: clean ? 'clean' : 'uncommitted changes',
  });

  print(logger, checks);
  return checks.every((check) => check.ok || !check.critical);
}

function print(logger: Logger, checks: Check[]): void {
  logger.section('Handrail doctor');
  for (const check of checks) {
    const mark = check.ok ? 'PASS' : check.critical ? 'FAIL' : 'WARN';
    const line = `${mark.padEnd(4)} ${check.name}: ${check.detail}`;
    if (check.ok) logger.info(line);
    else if (check.critical) logger.error(line);
    else logger.warn(line);
  }
}
