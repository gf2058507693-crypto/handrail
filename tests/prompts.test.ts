import { describe, expect, it } from 'vitest';
import { loadPrompt, renderTemplate } from '../src/core/prompts.js';

describe('prompts', () => {
  it('renders placeholders', () => {
    expect(renderTemplate('Hello {{name}}, {{missing}}', { name: 'world' })).toBe(
      'Hello world, {{missing}}',
    );
  });

  it('loads every workflow prompt', async () => {
    const names = [
      'intake.system',
      'intake.user',
      'clarify.system',
      'clarify.user',
      'spec.system',
      'spec.user',
      'tickets.system',
      'tickets.user',
      'implement.system',
      'implement.user',
      'review.system',
      'review.user',
      'pr.system',
      'pr.user',
      'accept.system',
      'accept.user',
      'retro.system',
      'retro.user',
    ];
    for (const name of names) {
      const content = await loadPrompt(name);
      expect(content.length).toBeGreaterThan(50);
    }
  });
});
