import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from './fs.js';
import { HandrailError } from './errors.js';

const promptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

export async function loadPrompt(name: string): Promise<string> {
  const file = path.join(promptDir, `${name}.md`);
  try {
    return await readText(file);
  } catch {
    throw new HandrailError(
      'PROMPT_MISSING',
      `Cannot read prompt ${name}.md from ${promptDir}.`,
      'Run "npm run build" so prompts are copied into dist/prompts.',
    );
  }
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : value;
  });
}

export async function renderPrompt(
  name: string,
  values: Record<string, string>,
): Promise<string> {
  return renderTemplate(await loadPrompt(name), values);
}
