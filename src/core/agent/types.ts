import type { AgentResult } from '../../types.js';
import type { ToolMode } from './tools.js';

export interface AgentRequest {
  kind:
    | 'intake'
    | 'clarify'
    | 'spec'
    | 'tickets'
    | 'implement'
    | 'review'
    | 'pr'
    | 'accept'
    | 'retro';
  system: string;
  prompt: string;
  toolMode: ToolMode;
  ticket?: number;
  spec?: number;
}

export interface Agent {
  readonly name: string;
  run(request: AgentRequest): Promise<AgentResult>;
}
