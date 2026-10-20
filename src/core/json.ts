import { HandrailError } from './errors.js';

export function extractJson<T>(text: string): T {
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(trimmed.slice(firstObject, lastObject + 1));
  }

  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(trimmed.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  throw new HandrailError(
    'AGENT_OUTPUT_NOT_JSON',
    `Agent did not return valid JSON. First 400 characters:\n${trimmed.slice(0, 400)}`,
    'Re-run the command. If it persists, strengthen the prompt or use a stronger model.',
  );
}

export function asString(value: unknown, field: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new HandrailError('AGENT_OUTPUT_INVALID', `${field} must be a string.`);
  }
  return value;
}

export function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HandrailError('AGENT_OUTPUT_INVALID', `${field} must be an array of strings.`);
  }
  return value;
}
