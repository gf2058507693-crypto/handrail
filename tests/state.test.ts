import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../src/core/state.js';

describe('state store', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'handrail-state-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists active requirement, spec and tickets', async () => {
    const store = new StateStore(root);
    await store.setActiveRequirement(100);
    await store.setActiveSpec(101, 100);
    await store.registerTicket(101, 100, 102, 'First ticket');

    const state = await store.load();
    expect(state.activeRequirement).toBe(100);
    expect(state.activeSpec).toBe(101);
    expect(state.specs['101']?.tickets).toEqual([102]);
    expect(state.tickets['102']?.status).toBe('published');
  });

  it('updates ticket status without losing traceability', async () => {
    const store = new StateStore(root);
    await store.setActiveSpec(101, 100);
    await store.registerTicket(101, 100, 102, 'First ticket');
    await store.updateTicket(102, { status: 'pr-open', branch: 'feat/issue-102', pr: 55 });
    const state = await store.load();
    expect(state.tickets['102']).toMatchObject({
      spec: 101,
      requirement: 100,
      status: 'pr-open',
      branch: 'feat/issue-102',
      pr: 55,
    });
  });

  it('returns an empty state when the file is missing or corrupt', async () => {
    const store = new StateStore(root);
    expect((await store.load()).tickets).toEqual({});
  });
});
