import type { AgentResult } from '../../types.js';
import type { Agent, AgentRequest } from './types.js';

/**
 * Deterministic agent used by tests and by "handrail demo".
 * It never pretends to have inspected the repository.
 */
export class MockAgent implements Agent {
  readonly name = 'mock';

  async run(request: AgentRequest): Promise<AgentResult> {
    const text = mockText(request);
    return {
      text,
      usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
      stopReason: 'end_turn',
      truncated: false,
    };
  }
}

function mockText(request: AgentRequest): string {
  switch (request.kind) {
    case 'intake':
      return [
        '## Source',
        '- Mock product input',
        '',
        '## Business goal',
        'Demonstrate the Handrail workflow without calling a model.',
        '',
        '## In scope',
        '- A mock requirement',
        '',
        '## Acceptance direction',
        '- The workflow commands can be exercised end to end',
        '',
        '## Constraints',
        '- Mock provider only',
        '',
        '## Open questions',
        '- None for the demo',
        '',
        '## Non-goals',
        '- Producing real code',
        '',
        '## Delivery checklist',
        '- [ ] Clarification completed',
        '- [ ] Spec approved',
        '- [ ] Tickets approved',
        '- [ ] Implementation and verification',
        '- [ ] PR reviewed and merged',
      ].join('\n');

    case 'clarify':
      return JSON.stringify(
        {
          summary: 'Mock clarification completed.',
          decisions: ['The demo uses the mock agent.'],
          open_questions: [],
          non_goals: ['Real model output'],
          glossary_terms: [{ term: 'mock', definition: 'A deterministic stand-in for an agent.' }],
          adr_candidates: [],
          next_question: '',
          done: true,
        },
        null,
        2,
      );

    case 'triage':
      return JSON.stringify({
        status: 'needs-info',
        summary: 'The mock agent cannot verify the reported behavior.',
        missing_information: ['A reproducible example'],
        related_issues: [],
        code_evidence: [],
      });

    case 'spec':
      return [
        '# Mock specification',
        '',
        '## Problem Statement',
        'The demo needs a spec.',
        '',
        '## Solution',
        'Use the mock agent.',
        '',
        '## User Stories',
        '1. A maintainer can run the workflow.',
        '',
        '## Implementation Decisions',
        '- Use the configured agent.',
        '',
        '## Testing Decisions',
        '- Run the configured checks.',
        '',
        '## Out of Scope',
        '- Real model behaviour.',
        '',
        '## Open Questions',
        '- None.',
        '',
        '## Further Notes',
        '- Request: #1',
      ].join('\n');

    case 'tickets':
      return JSON.stringify(
        {
          tickets: [
            {
              key: 'T1',
              title: 'Mock ticket one',
              goal: 'The first observable behavior exists.',
              acceptance: ['The first behavior can be demonstrated.'],
              blocked_by: [],
              test_plan: ['npm test'],
              demo: 'Run the demo.',
            },
            {
              key: 'T2',
              title: 'Mock ticket two',
              goal: 'The second observable behavior exists.',
              acceptance: ['The second behavior can be demonstrated.'],
              blocked_by: ['T1'],
              test_plan: ['npm test'],
              demo: 'Run the demo again.',
            },
          ],
        },
        null,
        2,
      );

    case 'review':
      return JSON.stringify(
        {
          verdict: 'approve',
          summary: 'Mock review approved.',
          findings: [],
          spec_coverage: [{ requirement: 'Mock behavior', status: 'met', evidence: 'mock' }],
        },
        null,
        2,
      );

    case 'pr':
      return JSON.stringify(
        {
          summary: 'Mock change summary.',
          behavior_changes: ['Mock behavior added.'],
          risks: {
            reversibility: 'Two-way',
            blast_radius: 'Demo only',
            data_compatibility: 'None',
            rollback: 'Revert the commit',
          },
        },
        null,
        2,
      );

    case 'accept':
      return JSON.stringify(
        {
          verdict: 'pass',
          summary: 'Mock acceptance passed.',
          checks: [{ item: 'Mock requirement', status: 'met', evidence: 'mock' }],
          gaps: [],
        },
        null,
        2,
      );

    case 'retro':
      return [
        '## Outcome',
        'The mock workflow completed.',
        '',
        '## What worked',
        '- Deterministic commands.',
        '',
        '## What caused rework',
        '- Nothing in the mock path.',
        '',
        '## Evidence gaps',
        '- This was a mock run.',
        '',
        '## Improvements',
        '### CI',
        '### Documentation',
        '### Agent guidance',
        '### Team process',
        '',
        '## Follow-ups',
        '- Run with a real agent.',
      ].join('\n');

    case 'implement':
      return 'Mock implementation completed. No files were changed by the mock agent.';
  }
}
