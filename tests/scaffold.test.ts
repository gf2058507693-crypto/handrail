import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scaffold } from '../src/core/scaffold.js';
import { exists } from '../src/core/fs.js';

describe('scaffold', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'handrail-scaffold-'));
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'demo',
          scripts: { test: 'vitest run', build: 'tsc' },
        },
        null,
        2,
      ),
    );
    await writeFile(path.join(root, 'package-lock.json'), '{}');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates workflow files and detects Node checks', async () => {
    const result = await scaffold(root, { projectName: 'demo' });
    expect(result.detection.stack).toBe('node');
    expect(result.config.checks.commands).toEqual(['npm test', 'npm run build']);

    expect(await exists(path.join(root, 'AGENTS.md'))).toBe(true);
    expect(await exists(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'))).toBe(true);
    expect(await exists(path.join(root, '.github', 'scripts', 'policy.mjs'))).toBe(true);
    expect(await exists(path.join(root, '.handrail', 'config.json'))).toBe(true);

    const ci = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm ci');
    expect(ci).toContain('npm test');

    const policy = await readFile(path.join(root, '.github', 'scripts', 'policy.mjs'), 'utf8');
    expect(policy).toContain('spec-approved');
    expect(policy).toContain('tickets-approved');
    expect(policy).toContain('task');
  });

  it('adds Handrail runtime artifacts to .gitignore', async () => {
    await scaffold(root, { projectName: 'demo' });
    const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    expect(ignore).toContain('.handrail/evidence/');
    expect(ignore).toContain('.handrail/state.json');
  });

  it('skips existing files unless force is set', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'custom');
    const result = await scaffold(root, { projectName: 'demo' });
    const action = result.actions.find((item) => item.path === 'AGENTS.md');
    expect(action?.status).toBe('skip');
    expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe('custom');

    await scaffold(root, { projectName: 'demo', force: true });
    expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toContain('Handrail');
  });

  it('writes nothing in dry-run mode', async () => {
    const dryRoot = await mkdtemp(path.join(tmpdir(), 'handrail-dry-'));
    try {
      const result = await scaffold(dryRoot, { projectName: 'dry', dryRun: true });
      expect(result.actions.every((action) => action.status === 'dry-run')).toBe(true);
      expect(await exists(path.join(dryRoot, 'AGENTS.md'))).toBe(false);
      expect(await exists(path.join(dryRoot, '.handrail', 'config.json'))).toBe(false);
    } finally {
      await rm(dryRoot, { recursive: true, force: true });
    }
  });
});
