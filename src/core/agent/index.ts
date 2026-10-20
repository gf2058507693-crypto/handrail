import type { AgentConfig } from '../../types.js';
import type { EvidenceStore } from '../evidence.js';
import type { Agent } from './types.js';
import { AnthropicAgent } from './anthropic.js';
import { CommandAgent } from './command.js';
import { MockAgent } from './mock.js';

export function createAgent(
  root: string,
  config: AgentConfig,
  evidence: EvidenceStore,
): Agent {
  switch (config.provider) {
    case 'command':
      return new CommandAgent(root, config, evidence);
    case 'mock':
      return new MockAgent();
    case 'anthropic':
    default:
      return new AnthropicAgent(root, config, evidence);
  }
}

export type { Agent, AgentRequest } from './types.js';
export type { ToolMode } from './tools.js';
