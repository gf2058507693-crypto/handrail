import { describe, expect, it } from 'vitest';
import {
  hasLabel,
  parseBlockedBy,
  parseCloses,
  parseLinkedIssue,
  requireSpecApproved,
  requireTicketsApproved,
} from '../src/core/gates.js';
import { defaultConfig } from '../src/core/config.js';
import type { Issue } from '../src/types.js';

const config = defaultConfig();
const issue = (labels: string[], body = ''): Issue => ({
  number: 101,
  title: 'Spec',
  body,
  state: 'OPEN',
  url: '',
  labels,
});

describe('gates', () => {
  it('detects labels', () => {
    expect(hasLabel(issue(['spec']), 'spec')).toBe(true);
    expect(hasLabel(issue([]), 'spec')).toBe(false);
  });

  it('blocks an unapproved spec', () => {
    expect(() => requireSpecApproved(issue(['spec']), config)).toThrow(/spec-approved/);
    expect(() => requireSpecApproved(issue(['spec', 'spec-approved']), config)).not.toThrow();
  });

  it('blocks an unapproved ticket split', () => {
    expect(() => requireTicketsApproved(issue(['spec']), config)).toThrow(/tickets-approved/);
    expect(() =>
      requireTicketsApproved(issue(['spec', 'tickets-approved']), config),
    ).not.toThrow();
  });

  it('parses trace links case-insensitively', () => {
    const body = 'Request: #100\nSPEC: #101\nTask: #102';
    expect(parseLinkedIssue(body, 'Request')).toBe(100);
    expect(parseLinkedIssue(body, 'Spec')).toBe(101);
    expect(parseLinkedIssue(body, 'Task')).toBe(102);
    expect(parseLinkedIssue(body, 'Blocker')).toBeNull();
  });

  it('parses every blocked-by number, including comma lists', () => {
    const body = 'Blocked by #102, #103\nblocked by #104\nNot a dependency: #105';
    expect(parseBlockedBy(body).sort()).toEqual([102, 103, 104]);
  });

  it('parses close references', () => {
    expect(parseCloses('Closes #102\ncloses #103').sort()).toEqual([102, 103]);
  });
});
