import path from 'node:path';
import { HandrailError } from '../errors.js';
import { renderPrompt } from '../prompts.js';
import { writeTextAtomic } from '../fs.js';
import { loadSpecContext } from './common.js';
import type { Context } from '../context.js';

export interface RetroOptions {
  publish?: boolean;
}

export async function runRetro(
  context: Context,
  specNumber: number,
  options: RetroOptions = {},
): Promise<{ file: string; markdown: string }> {
  const { spec, requirement, requirementNumber } = await loadSpecContext(context, specNumber);
  const allIssues = await context.github.issueList({ state: 'all', limit: 200 });
  const tickets = allIssues.filter(
    (issue) =>
      issue.labels.includes(context.config.github.labels.task) &&
      Number((issue.body.match(/Spec\s*:\s*#(\d+)/i) ?? [])[1]) === specNumber,
  );

  const pulls: string[] = [];
  for (const ticket of tickets) {
    const branch = `${context.config.workflow.branchPrefix}${ticket.number}`;
    const pr = await context.github.prForBranch(branch);
    if (pr) pulls.push(`#${ticket.number} -> PR #${pr.number} (${pr.state}) ${pr.url}`);
  }

  const evidence = (await context.evidence.list({ spec: specNumber }))
    .map(
      (record) =>
        `- ${record.timestamp} ${record.kind} ${record.command ?? ''} exit=${record.exitCode ?? '-'} ${
          record.meta ? JSON.stringify(record.meta) : ''
        }`,
    )
    .join('\n');
  const state = await context.state.load();
  const history = state.history
    .map((entry) => `- ${entry.at} ${entry.event} ${entry.details ? JSON.stringify(entry.details) : ''}`)
    .join('\n');

  const system = await renderPrompt('retro.system', {});
  const prompt = await renderPrompt('retro.user', {
    requirementNumber: String(requirementNumber),
    specNumber: String(specNumber),
    projectName: context.config.project.name,
    requirementBody: requirement.body,
    specBody: spec.body,
    tickets: tickets.map((ticket) => `- #${ticket.number} [${ticket.state}] ${ticket.title}`).join('\n'),
    pulls: pulls.join('\n'),
    evidence: evidence || '(no evidence records)',
    history: history || '(no history)',
  });

  context.logger.info(`Preparing retrospective for spec #${specNumber}...`);
  const result = await context.agent.run({
    kind: 'retro',
    system,
    prompt,
    toolMode: 'read',
    spec: specNumber,
  });
  const markdown = result.text.trim();
  if (!markdown) {
    throw new HandrailError('RETRO_EMPTY', 'The agent returned an empty retrospective.');
  }

  const file = path.join(
    context.root,
    context.config.project.docsDir,
    `retro-spec-${specNumber}.md`,
  );
  await writeTextAtomic(file, `${markdown}\n`);

  if (options.publish) {
    await context.github.issueComment(
      requirementNumber,
      `Retrospective for spec #${specNumber}:\n\n${markdown}`,
    );
    context.logger.ok(`Posted retrospective to requirement #${requirementNumber}.`);
  }

  context.logger.ok(`Retrospective written to ${file}.`);
  return { file, markdown };
}
