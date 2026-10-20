import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/core/agent/tools.js';
import { defaultConfig } from '../src/core/config.js';
import { EvidenceStore } from '../src/core/evidence.js';

describe('agent tools', () => {
  let root: string;
  let context: ToolContext;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'handrail-tools-'));
    await writeFile(path.join(root, 'hello.txt'), 'line one\nline two\n', 'utf8');
    context = {
      root,
      config: defaultConfig('tools').agent,
      evidence: new EvidenceStore(root),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a file with line numbers and a range', async () => {
    const result = await executeTool(context, 'read_file', {
      path: 'hello.txt',
      start_line: 2,
      end_line: 2,
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('2 | line two');
    expect(result.content).not.toContain('line one');
  });

  it('writes a file and creates parent directories', async () => {
    const result = await executeTool(context, 'write_file', {
      path: 'src/new.txt',
      content: 'hello',
    });
    expect(result.isError).toBe(false);
    expect(await readFile(path.join(root, 'src', 'new.txt'), 'utf8')).toBe('hello');
  });

  it('blocks paths outside the repository', async () => {
    const result = await executeTool(context, 'read_file', { path: '../outside.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/escapes the repository/);
  });

  it('blocks agents from editing .handrail', async () => {
    const result = await executeTool(context, 'write_file', {
      path: '.handrail/config.json',
      content: '{}',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/may not edit \.handrail/);
  });

  it('replaces an exact string and refuses ambiguous matches', async () => {
    const ok = await executeTool(context, 'replace_in_file', {
      path: 'hello.txt',
      old_string: 'one',
      new_string: 'ONE',
    });
    expect(ok.isError).toBe(false);
    expect(await readFile(path.join(root, 'hello.txt'), 'utf8')).toContain('line ONE');

    const ambiguous = await executeTool(context, 'replace_in_file', {
      path: 'hello.txt',
      old_string: 'line',
      new_string: 'LINE',
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content).toMatch(/appears 2 times/);
  });

  it('runs an allowed shell command and records evidence', async () => {
    const result = await executeTool(context, 'run_command', { command: 'echo handrail' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('handrail');
    const records = await context.evidence.list({ kind: 'command' });
    expect(records).toHaveLength(1);
    expect(records[0]?.exitCode).toBe(0);
  });

  it('rejects denied commands', async () => {
    const result = await executeTool(context, 'run_command', { command: 'git push --force' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/denied pattern/);
  });

  it('enforces an allowlist when one is configured', async () => {
    context.config = { ...context.config, allowedCommands: ['echo'] };
    const blocked = await executeTool(context, 'run_command', { command: 'printf hi' });
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toMatch(/not in agent.allowedCommands/);

    const allowed = await executeTool(context, 'run_command', { command: 'echo ok' });
    expect(allowed.isError).toBe(false);
  });
});
