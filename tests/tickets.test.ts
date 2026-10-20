import { describe, expect, it } from 'vitest';
import { parseTickets, renderTicketBody, topologicalOrder } from '../src/core/workflow/common.js';
import type { TicketDraft } from '../src/types.js';

const baseTickets: TicketDraft[] = [
  {
    key: 'T1',
    title: 'First',
    goal: 'First behavior',
    acceptance: ['First is observable'],
    blocked_by: [],
    test_plan: ['npm test'],
    demo: 'Run it',
  },
  {
    key: 'T2',
    title: 'Second',
    goal: 'Second behavior',
    acceptance: ['Second is observable'],
    blocked_by: ['T1'],
    test_plan: ['npm test'],
    demo: 'Run it again',
  },
];

describe('ticket planning', () => {
  it('parses a valid plan and keeps dependency order', () => {
    const parsed = parseTickets({ tickets: baseTickets }, 12);
    expect(parsed.tickets).toHaveLength(2);
    expect(topologicalOrder(parsed.tickets).map((ticket) => ticket.key)).toEqual(['T1', 'T2']);
  });

  it('orders independent tickets deterministically', () => {
    const independent: TicketDraft[] = [
      { ...baseTickets[1]!, key: 'T3', title: 'Third', blocked_by: [] },
      { ...baseTickets[0]!, key: 'T4', title: 'Fourth' },
    ];
    expect(topologicalOrder(independent).map((ticket) => ticket.key)).toEqual(['T3', 'T4']);
  });

  it('rejects a dependency cycle', () => {
    const cyclic: TicketDraft[] = [
      { ...baseTickets[0]!, blocked_by: ['T2'] },
      { ...baseTickets[1]! },
    ];
    expect(() => parseTickets({ tickets: cyclic }, 12)).toThrow(/cycle/);
  });

  it('rejects an unknown dependency', () => {
    const broken = [{ ...baseTickets[0]!, blocked_by: ['T9'] }];
    expect(() => parseTickets({ tickets: broken }, 12)).toThrow(/unknown key/);
  });

  it('rejects a ticket without acceptance criteria', () => {
    const broken = [{ ...baseTickets[0]!, acceptance: [] }];
    expect(() => parseTickets({ tickets: broken }, 12)).toThrow(/acceptance criteria/);
  });

  it('rejects too many tickets', () => {
    expect(() => parseTickets({ tickets: baseTickets }, 1)).toThrow(/above the limit/);
  });

  it('renders traceability and explicit dependencies', () => {
    const body = renderTicketBody(baseTickets[1]!, { requirement: 100, spec: 101, blockedBy: [102] });
    expect(body).toContain('Request: #100');
    expect(body).toContain('Spec: #101');
    expect(body).toContain('Blocked by #102');
    expect(body).toContain('- [ ] Second is observable');
  });
});
