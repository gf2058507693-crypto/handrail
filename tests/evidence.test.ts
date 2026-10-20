import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceStore } from '../src/core/evidence.js';

describe('evidence store', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'handrail-evidence-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('records checks and fails when a check failed', async () => {
    const store = new EvidenceStore(root);
    await store.record({
      kind: 'check',
      ticket: 2,
      spec: 1,
      command: 'npm test',
      cwd: root,
      exitCode: 1,
      durationMs: 20,
    });
    const gate = await store.assertChecksPassed(2, true);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/1 check\(s\) failed/);
  });

  it('passes only when every check exited zero', async () => {
    const store = new EvidenceStore(root);
    await store.record({ kind: 'check', ticket: 3, command: 'npm test', cwd: root, exitCode: 0 });
    await store.record({ kind: 'command', ticket: 3, command: 'echo', cwd: root, exitCode: 0 });
    await expect(store.assertChecksPassed(3, true)).resolves.toEqual({ ok: true });
  });

  it('uses the latest result for each configured command on the current commit', async () => {
    const store = new EvidenceStore(root);
    await store.record({ kind: 'check', ticket: 6, command: 'npm test', exitCode: 1, meta: { headSha: 'a' } });
    await store.record({ kind: 'check', ticket: 6, command: 'npm test', exitCode: 0, meta: { headSha: 'a' } });
    await store.record({ kind: 'check', ticket: 6, command: 'npm run build', exitCode: 0, meta: { headSha: 'a' } });
    expect(await store.assertChecksPassed(6, true, 'a', ['npm test', 'npm run build'])).toEqual({ ok: true });
    const stale = await store.assertChecksPassed(6, true, 'b', ['npm test', 'npm run build']);
    expect(stale.ok).toBe(false);
    expect(stale.reason).toMatch(/No check commands/);
    const missing = await store.assertChecksPassed(6, true, 'a', ['npm test', 'npm run lint']);
    expect(missing.reason).toMatch(/npm run lint/);
  });

  it('fails when no checks exist and one is required', async () => {
    const store = new EvidenceStore(root);
    const gate = await store.assertChecksPassed(4, true);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/No check commands/);
  });

  it('filters by spec as well as ticket', async () => {
    const store = new EvidenceStore(root);
    await store.record({ kind: 'check', ticket: 1, spec: 10, command: 'a', cwd: root, exitCode: 0 });
    await store.record({ kind: 'check', ticket: 2, spec: 10, command: 'b', cwd: root, exitCode: 0 });
    await store.record({ kind: 'check', ticket: 3, spec: 11, command: 'c', cwd: root, exitCode: 0 });
    expect(await store.list({ spec: 10 })).toHaveLength(2);
  });

  it('writes a human-readable ticket report', async () => {
    const store = new EvidenceStore(root);
    await store.record({ kind: 'check', ticket: 5, command: 'npm test', cwd: root, exitCode: 0 });
    const file = await store.writeTicketReport(5);
    expect(await readFile(file, 'utf8')).toContain('npm test');
  });
});
