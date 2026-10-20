import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { GateError, HandrailError } from '../errors.js';
import { exists, readTextIfExists, writeText, writeTextAtomic } from '../fs.js';
import { extractJson } from '../json.js';
import { renderPrompt } from '../prompts.js';
import { writeDraft } from './common.js';
import { loadDocsBundle, listRepoFiles } from '../context.js';
import type { Context } from '../context.js';
import type { ClarificationResult } from '../../types.js';

export interface ClarifyOptions {
  interactive?: boolean;
  rounds?: number;
  comment?: boolean;
  writeDocs?: boolean;
}

export async function clarify(
  context: Context,
  issueNumber: number,
  options: ClarifyOptions = {},
): Promise<{ result: ClarificationResult; file: string }> {
  const issue = await context.github.issueView(issueNumber);
  const docs = await loadDocsBundle(context);
  const files = await listRepoFiles(context);
  const maxRounds = options.rounds ?? (options.interactive ? 8 : 1);
  const conversation: string[] = [];

  if (options.interactive && !process.stdin.isTTY) {
    throw new HandrailError(
      'NOT_INTERACTIVE',
      'Interactive clarification needs a TTY.',
      'Run this command in a terminal, or omit --interactive to get a written list of open questions.',
    );
  }

  const rl = options.interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  let last: ClarificationResult | null = null;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const system = await renderPrompt('clarify.system', {});
      const prompt = await renderPrompt('clarify.user', {
        issueNumber: String(issue.number),
        projectName: context.config.project.name,
        root: context.root,
        mode: options.interactive ? 'interactive' : 'non-interactive',
        rounds: String(round),
        issueBody: issue.body,
        docs,
        files,
        conversation: conversation.length > 0 ? conversation.join('\n\n') : '(none yet)',
      });

      context.logger.info(`Clarification round ${round + 1}/${maxRounds}...`);
      const result = await context.agent.run({
        kind: 'clarify',
        system,
        prompt,
        toolMode: 'read',
        spec: issue.number,
      });
      last = parseClarification(result.text);

      if (!options.interactive) break;
      if (last.done || !last.next_question) break;

      const answer = (await rl!.question(`\nQuestion: ${last.next_question}\n> `)).trim();
      if (!answer) break;
      conversation.push(`Q: ${last.next_question}\nA: ${answer}`);
      context.logger.detail('Answer recorded.');
    }
  } finally {
    rl?.close();
  }

  if (!last) {
    throw new HandrailError('CLARIFY_EMPTY', 'The agent returned no clarification result.');
  }

  const markdown = renderClarification(issueNumber, last, conversation);
  const file = await writeDraft(context, `clarify-${issueNumber}.md`, markdown);

  if (options.writeDocs) {
    if (!last.done || last.open_questions.length > 0) {
      throw new GateError('Clarification still has open questions; domain docs were not written.');
    }
    await writeDomainDocs(context, issueNumber, last);
  }

  if (options.comment) {
    await context.github.issueComment(issueNumber, markdown);
    context.logger.ok(`Posted clarification summary to #${issueNumber}.`);
  }

  return { result: last, file };
}

async function writeDomainDocs(context: Context, issueNumber: number, result: ClarificationResult): Promise<void> {
  const glossaryFile = path.join(context.root, context.config.project.glossary);
  const current = (await readTextIfExists(glossaryFile)) ?? '# Project Glossary\n\n| Term | Definition | Notes |\n|---|---|---|\n';
  const existing = new Set(
    [...current.matchAll(/^\|\s*([^|]+?)\s*\|/gm)].map((match) => match[1]!.trim().toLowerCase()),
  );
  const rows: string[] = [];
  for (const item of result.glossary_terms) {
    const term = item.term.trim();
    const key = term.toLowerCase();
    if (!term || !item.definition.trim() || existing.has(key)) continue;
    existing.add(key);
    rows.push(`| ${term.replace(/\|/g, '\\|')} | ${item.definition.replace(/\|/g, '\\|')} | Clarification #${issueNumber} |`);
  }
  if (rows.length > 0) {
    await writeTextAtomic(glossaryFile, `${current.trimEnd()}\n${rows.join('\n')}\n`);
    context.logger.ok(`Added ${rows.length} glossary term(s).`);
  }
  for (const [index, candidate] of result.adr_candidates.entries()) {
    const file = path.join(context.root, context.config.project.adrDir, `proposed-${issueNumber}-${index + 1}.md`);
    if (await exists(file)) continue;
    await writeText(file, [
      `# ${candidate.title}`,
      '',
      '## Status',
      '',
      'Proposed',
      '',
      '## Context',
      '',
      candidate.context || `Clarification for requirement #${issueNumber}.`,
      '',
      '## Decision',
      '',
      candidate.decision,
      '',
      '## Consequences',
      '',
      'To be reviewed by the technical owner.',
      '',
    ].join('\n'));
    context.logger.ok(`Wrote proposed ADR: ${file}`);
  }
}

export async function loadClarification(
  context: Context,
  requirementNumber: number,
): Promise<string> {
  const file = path.join(context.root, '.handrail', 'drafts', `clarify-${requirementNumber}.md`);
  return (await readTextIfExists(file)) ?? '';
}

function parseClarification(text: string): ClarificationResult {
  const parsed = extractJson<Partial<ClarificationResult>>(text);
  return {
    summary: stringValue(parsed.summary, ''),
    decisions: stringArray(parsed.decisions),
    assumptions: stringArray(parsed.assumptions),
    open_questions: stringArray(parsed.open_questions),
    non_goals: stringArray(parsed.non_goals),
    glossary_terms: Array.isArray(parsed.glossary_terms)
      ? parsed.glossary_terms
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            term: String((item as { term?: unknown }).term ?? ''),
            definition: String((item as { definition?: unknown }).definition ?? ''),
          }))
          .filter((item) => item.term)
      : [],
    adr_candidates: Array.isArray(parsed.adr_candidates)
      ? parsed.adr_candidates
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            title: String((item as { title?: unknown }).title ?? ''),
            context: String((item as { context?: unknown }).context ?? ''),
            decision: String((item as { decision?: unknown }).decision ?? ''),
          }))
          .filter((item) => item.title)
      : [],
    next_question: typeof parsed.next_question === 'string' ? parsed.next_question : '',
    done: parsed.done === true,
  };
}

function renderClarification(
  issueNumber: number,
  result: ClarificationResult,
  conversation: string[],
): string {
  const lines = [
    `# Clarification for #${issueNumber}`,
    '',
    result.summary || '_No summary provided._',
    '',
    '## Confirmed decisions',
    ...(result.decisions.length > 0 ? result.decisions.map((item) => `- ${item}`) : ['- None']),
    '',
    '## Implementation assumptions',
    ...(result.assumptions.length > 0 ? result.assumptions.map((item) => `- ${item}`) : ['- None']),
    '',
    '## Open questions',
    ...(result.open_questions.length > 0
      ? result.open_questions.map((item) => `- [ ] ${item}`)
      : ['- None']),
    '',
    '## Non-goals',
    ...(result.non_goals.length > 0 ? result.non_goals.map((item) => `- ${item}`) : ['- None']),
    '',
    '## Glossary',
    ...(result.glossary_terms.length > 0
      ? result.glossary_terms.map((item) => `- **${item.term}**: ${item.definition}`)
      : ['- None']),
    '',
    '## ADR candidates',
    ...(result.adr_candidates.length > 0
      ? result.adr_candidates.map((item) => `- **${item.title}**: ${item.decision}`)
      : ['- None']),
    '',
    '## Conversation',
    ...(conversation.length > 0 ? conversation : ['_No interactive answers recorded._']),
    '',
  ];
  return lines.join('\n');
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
