import { HandrailError, GateError } from '../errors.js';
import { extractJson } from '../json.js';
import { renderPrompt } from '../prompts.js';
import { loadDocsBundle, listRepoFiles } from '../context.js';
import { writeDraft } from './common.js';
import type { Context } from '../context.js';

export interface TriageResult {
  status: 'ready' | 'needs-info' | 'ready-for-human' | 'duplicate' | 'already-implemented';
  summary: string;
  missing_information: string[];
  related_issues: number[];
  code_evidence: string[];
}

export async function triageIssue(
  context: Context,
  issueNumber: number,
  apply = false,
): Promise<{ result: TriageResult; file: string }> {
  const issue = await context.github.issueView(issueNumber);
  if (issue.labels.includes(context.config.github.labels.task) || issue.labels.includes(context.config.github.labels.spec)) {
    throw new GateError(`Issue #${issueNumber} is a generated task or spec, not an intake issue.`);
  }
  const others = (await context.github.issueList({ state: 'all', limit: 100 }))
    .filter((candidate) => candidate.number !== issueNumber)
    .map((candidate) => `#${candidate.number} [${candidate.state}] ${candidate.title}`)
    .join('\n');
  const system = await renderPrompt('triage.system', {});
  const prompt = await renderPrompt('triage.user', {
    issueNumber: String(issueNumber),
    title: issue.title,
    issueBody: issue.body,
    otherIssues: others || '(none)',
    docs: await loadDocsBundle(context),
    files: await listRepoFiles(context),
  });
  const response = await context.agent.run({ kind: 'triage', system, prompt, toolMode: 'read' });
  if (response.truncated) throw new HandrailError('TRIAGE_TRUNCATED', 'The triage agent did not finish.');
  const result = parseTriage(response.text);
  const markdown = renderTriage(issueNumber, result);
  const file = await writeDraft(context, `triage-${issueNumber}.md`, markdown);
  if (apply) {
    const label = result.status === 'ready'
      ? context.config.github.labels.readyForAgent
      : result.status === 'needs-info'
        ? context.config.github.labels.needsInfo
        : context.config.github.labels.readyForHuman;
    await context.github.issueEdit(issueNumber, {
      addLabels: [label],
      removeLabels: [
        context.config.github.labels.needsTriage,
        context.config.github.labels.needsInfo,
        context.config.github.labels.readyForAgent,
        context.config.github.labels.readyForHuman,
      ].filter((item) => item !== label && issue.labels.includes(item)),
    });
    await context.github.issueComment(issueNumber, markdown);
    context.logger.ok(`Triage recorded on #${issueNumber}: ${result.status}.`);
  } else {
    context.logger.info(`Triage draft: ${file}`);
  }
  return { result, file };
}

export function parseTriage(text: string): TriageResult {
  const value = extractJson<Record<string, unknown>>(text);
  const allowed = ['ready', 'needs-info', 'ready-for-human', 'duplicate', 'already-implemented'];
  if (!allowed.includes(String(value.status))) {
    throw new HandrailError('TRIAGE_INVALID', 'Triage must return a valid status.');
  }
  const strings = (input: unknown): string[] => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const numbers = Array.isArray(value.related_issues)
    ? value.related_issues.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (!summary) throw new HandrailError('TRIAGE_INVALID', 'Triage must include a summary.');
  if (value.status === 'ready' && strings(value.missing_information).length > 0) {
    throw new HandrailError('TRIAGE_INVALID', 'Ready triage cannot have missing information.');
  }
  if (value.status === 'duplicate' && numbers.length === 0) {
    throw new HandrailError('TRIAGE_INVALID', 'Duplicate triage must cite the related issue.');
  }
  return {
    status: value.status as TriageResult['status'],
    summary,
    missing_information: strings(value.missing_information),
    related_issues: numbers,
    code_evidence: strings(value.code_evidence),
  };
}

function renderTriage(issueNumber: number, result: TriageResult): string {
  return [
    `# Triage for #${issueNumber}`,
    '',
    `Status: **${result.status}**`,
    '',
    result.summary,
    '',
    '## Missing information',
    ...result.missing_information.map((item) => `- ${item}`),
    '',
    '## Related issues',
    ...result.related_issues.map((number) => `- #${number}`),
    '',
    '## Code evidence',
    ...result.code_evidence.map((item) => `- ${item}`),
    '',
  ].join('\n');
}
