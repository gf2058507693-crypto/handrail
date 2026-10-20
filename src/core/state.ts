import path from 'node:path';
import { readTextIfExists, writeTextAtomic } from './fs.js';
import { statePath } from './config.js';

export interface TicketState {
  spec: number;
  requirement: number;
  title: string;
  status:
    | 'draft'
    | 'published'
    | 'implemented'
    | 'reviewed'
    | 'pr-open'
    | 'merged'
    | 'accepted';
  branch?: string;
  pr?: number;
  updatedAt: string;
}

export interface HandrailState {
  version: 1;
  activeRequirement?: number;
  activeSpec?: number;
  specs: Record<string, { requirement: number; tickets: number[] }>;
  tickets: Record<string, TicketState>;
  history: Array<{ at: string; event: string; details?: Record<string, unknown> }>;
}

export function emptyState(): HandrailState {
  return { version: 1, specs: {}, tickets: {}, history: [] };
}

export class StateStore {
  constructor(private readonly root: string) {}

  async load(): Promise<HandrailState> {
    const raw = await readTextIfExists(statePath(this.root));
    if (!raw) return emptyState();
    try {
      const parsed = JSON.parse(raw) as HandrailState;
      if (parsed.version !== 1) return emptyState();
      return {
        ...emptyState(),
        ...parsed,
        specs: parsed.specs ?? {},
        tickets: parsed.tickets ?? {},
        history: parsed.history ?? [],
      };
    } catch {
      return emptyState();
    }
  }

  async save(state: HandrailState): Promise<void> {
    await writeTextAtomic(statePath(this.root), `${JSON.stringify(state, null, 2)}\n`);
  }

  async update(mutator: (state: HandrailState) => void): Promise<HandrailState> {
    const state = await this.load();
    mutator(state);
    await this.save(state);
    return state;
  }

  async setActiveRequirement(issue: number): Promise<void> {
    await this.update((state) => {
      state.activeRequirement = issue;
      state.history.push({ at: now(), event: 'requirement.active', details: { issue } });
    });
  }

  async setActiveSpec(spec: number, requirement: number): Promise<void> {
    await this.update((state) => {
      state.activeSpec = spec;
      state.specs[String(spec)] = state.specs[String(spec)] ?? {
        requirement,
        tickets: [],
      };
      state.history.push({ at: now(), event: 'spec.active', details: { spec, requirement } });
    });
  }

  async registerTicket(spec: number, requirement: number, issue: number, title: string): Promise<void> {
    await this.update((state) => {
      state.tickets[String(issue)] = {
        spec,
        requirement,
        title,
        status: 'published',
        updatedAt: now(),
      };
      const entry = state.specs[String(spec)] ?? { requirement, tickets: [] };
      if (!entry.tickets.includes(issue)) entry.tickets.push(issue);
      state.specs[String(spec)] = entry;
      state.history.push({ at: now(), event: 'ticket.published', details: { issue, spec } });
    });
  }

  async updateTicket(issue: number, patch: Partial<TicketState>): Promise<void> {
    await this.update((state) => {
      const current = state.tickets[String(issue)];
      if (!current) return;
      state.tickets[String(issue)] = {
        ...current,
        ...patch,
        updatedAt: now(),
      };
    });
  }

  async history(event: string, details?: Record<string, unknown>): Promise<void> {
    await this.update((state) => {
      state.history.push({ at: now(), event, details });
    });
  }
}

function now(): string {
  return new Date().toISOString();
}

export function writeDraftPath(root: string, name: string): string {
  return path.join(root, '.handrail', 'drafts', name);
}
