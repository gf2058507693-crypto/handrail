import path from 'node:path';
import { HandrailError } from '../errors.js';
import { readText } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import { writeDraft } from './common.js';
import type { Context } from '../context.js';
import type { Issue } from '../../types.js';

export interface IntakeOptions {
  prd: string;
  title?: string;
  source?: string;
  dryRun?: boolean;
}

export async function intake(context: Context, options: IntakeOptions): Promise<Issue | null> {
  const prdPath = path.resolve(context.root, options.prd);
  const prd = await readText(prdPath).catch(() => {
    throw new HandrailError('PRD_MISSING', `Cannot read PRD: ${prdPath}`);
  });

  const title = options.title?.trim() || deriveTitle(prd) || 'Untitled requirement';
  const source = options.source ?? options.prd;
  const system = await renderPrompt('intake.system', {});
  const prompt = await renderPrompt('intake.user', {
    projectName: context.config.project.name,
    source,
    title,
    prd: prd.slice(0, 80_000),
  });

  context.logger.info(`Drafting requirement issue with ${context.agent.name}...`);
  const result = await context.agent.run({
    kind: 'intake',
    system,
    prompt,
    toolMode: 'none',
  });
  const body = result.text.trim();
  if (!body) {
    throw new HandrailError('INTAKE_EMPTY', 'The agent returned an empty requirement body.');
  }

  const draftFile = await writeDraft(context, `requirement-${Date.now()}.md`, body);
  context.logger.detail(`Draft saved to ${draftFile}`);

  if (options.dryRun) {
    context.logger.info(body);
    return null;
  }

  const issue = await context.github.issueCreate({
    title: `[Feature] ${title}`,
    body,
    labels: [context.config.github.labels.requirement, context.config.github.labels.needsTriage],
  });
  await context.state.setActiveRequirement(issue.number);
  context.logger.ok(`Created requirement issue #${issue.number}: ${issue.url}`);
  return issue;
}

function deriveTitle(prd: string): string | null {
  for (const line of prd.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').slice(0, 100);
    }
    return trimmed.slice(0, 100);
  }
  return null;
}
