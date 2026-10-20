import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig } from '../src/core/config.js';

describe('config', () => {
  it('provides a complete default config', () => {
    const config = defaultConfig('demo');
    expect(config.version).toBe(1);
    expect(config.project.name).toBe('demo');
    expect(config.github.labels.specApproved).toBe('spec-approved');
    expect(config.workflow.requireSpecApproval).toBe(true);
    expect(config.agent.provider).toBe('anthropic');
  });

  it('merges partial config with defaults', () => {
    const config = validateConfig({
      project: { name: 'partial' },
      github: { baseBranch: 'develop', labels: { task: 'ticket' } },
      checks: { commands: ['npm test'] },
    });
    expect(config.project.name).toBe('partial');
    expect(config.project.docsDir).toBe('docs');
    expect(config.github.baseBranch).toBe('develop');
    expect(config.github.labels.task).toBe('ticket');
    expect(config.github.labels.spec).toBe('spec');
    expect(config.checks.commands).toEqual(['npm test']);
  });

  it('rejects an unknown provider', () => {
    expect(() => validateConfig({ agent: { provider: 'magic' } })).toThrow(/anthropic, command or mock/);
  });

  it('rejects an empty label', () => {
    expect(() => validateConfig({ github: { labels: { spec: '' } } })).toThrow(/non-empty string/);
  });

  it('rejects a non-numeric maxTurns', () => {
    expect(() => validateConfig({ agent: { maxTurns: 'many' } })).toThrow(/must be a number/);
  });
});
