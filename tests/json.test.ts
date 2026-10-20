import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/core/json.js';

describe('JSON extraction', () => {
  it('parses plain JSON', () => {
    expect(extractJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });

  it('parses fenced JSON', () => {
    expect(extractJson<{ n: number }>('Here is the result:\n```json\n{"n":1}\n```')).toEqual({ n: 1 });
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJson<{ n: number }>('I think this is right: {"n":2} Done.')).toEqual({ n: 2 });
  });

  it('parses arrays', () => {
    expect(extractJson<number[]>('Result: [1,2,3]')).toEqual([1, 2, 3]);
  });

  it('throws a useful error for prose-only output', () => {
    expect(() => extractJson('no JSON here')).toThrow(/did not return valid JSON/);
  });
});
