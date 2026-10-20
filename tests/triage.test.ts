import { describe, expect, it } from 'vitest';
import { parseTriage } from '../src/core/workflow/triage.js';

describe('triage result', () => {
  it('accepts a structured decision and rejects an unknown status', () => {
    expect(parseTriage(JSON.stringify({
      status: 'needs-info',
      summary: 'Reproduction is missing',
      missing_information: ['Steps'],
      related_issues: [12],
      code_evidence: [],
    })).related_issues).toEqual([12]);
    expect(() => parseTriage('{"status":"approved","summary":"ok"}')).toThrow(/valid status/);
  });
});
