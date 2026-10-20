import { describe, expect, it } from 'vitest';
import { evaluatePullRequest, extractSection } from '../src/core/policy.js';
import type { Issue } from '../src/types.js';

const labels = {
  specApproved: 'spec-approved',
  ticketsApproved: 'tickets-approved',
  task: 'task',
};

const task: Issue = {
  number: 102,
  title: 'Show failed rows',
  state: 'OPEN',
  url: '',
  labels: ['task'],
  body: 'Request: #100\nSpec: #101\nBlocked by #103',
};

const spec: Issue = {
  number: 101,
  title: 'Retry failed rows',
  state: 'OPEN',
  url: '',
  labels: ['spec', 'spec-approved', 'tickets-approved'],
  body: '## Problem Statement\n...\n\nRequest: #100',
};

const validBody = [
  '## Spec / Tasks',
  '- Request: #100',
  '- Spec: #101',
  '- Task: #102',
  '',
  '## Summary',
  'Show failed rows.',
  '',
  '## Evidence',
  '| Command | Result | exit_code |',
  '| `npm test` | PASS | 0 |',
  '',
  '## Merge Danger',
  '- Reversibility: Two-way',
  '',
  'Closes #102',
].join('\n');

describe('pull request policy', () => {
  it('passes a traceable, evidence-backed PR', () => {
    const result = evaluatePullRequest({ body: validBody, task, spec, labels });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('requires Request, Spec and Task links', () => {
    const result = evaluatePullRequest({ body: '## Summary\nx', task, spec, labels });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/Request/);
    expect(result.violations.join('\n')).toMatch(/Spec/);
    expect(result.violations.join('\n')).toMatch(/Task/);
  });

  it('requires spec and ticket approvals', () => {
    const unapproved = { ...spec, labels: ['spec'] };
    const result = evaluatePullRequest({ body: validBody, task, spec: unapproved, labels });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/spec-approved/);
    expect(result.violations.join('\n')).toMatch(/tickets-approved/);
  });

  it('rejects placeholder evidence', () => {
    const body = validBody.replace('| `npm test` | PASS | 0 |', '- [ ] tests run');
    const result = evaluatePullRequest({ body, task, spec, labels });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/placeholders/);
  });

  it('rejects closing the spec from a task PR', () => {
    const body = `${validBody}\nCloses #101`;
    const result = evaluatePullRequest({ body, task, spec, labels });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/must not close spec/);
  });

  it('rejects a task that links a different spec', () => {
    const wrongTask = { ...task, body: 'Request: #100\nSpec: #999' };
    const result = evaluatePullRequest({ body: validBody, task: wrongTask, spec, labels });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/Task #102 links Spec #999/);
  });

  it('extracts a section without swallowing the next heading', () => {
    expect(extractSection(validBody, 'Evidence')).toContain('npm test');
    expect(extractSection(validBody, 'Evidence')).not.toContain('Merge Danger');
  });
});
