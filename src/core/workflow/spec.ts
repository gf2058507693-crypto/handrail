import { HandrailError } from '../errors.js';
import { renderPrompt } from '../prompts.js';
import { loadDocsBundle } from '../context.js';
import { validateSpecBody } from './common.js';
import { loadClarification } from './clarify.js';
import type { Context } from '../context.js';
import type { Issue } from '../../types.js';

export async function createSpec(context: Context, requirementNumber: number): Promise<Issue> {
  const requirement = await context.github.issueView(requirementNumber);
  if (!requirement.labels.includes(context.config.github.labels.requirement)) {
    context.logger.warn(
      `Issue #${requirementNumber} does not carry the "${context.config.github.labels.requirement}" label; using it as a requirement anyway.`,
    );
  }

  const clarification = await loadClarification(context, requirementNumber);
  if (!clarification) {
    context.logger.warn(
      'No clarification record found. The spec will be based only on the requirement issue. Run "handrail clarify" first for better results.',
    );
  }

  const docs = await loadDocsBundle(context);
  const system = await renderPrompt('spec.system', {});
  const prompt = await renderPrompt('spec.user', {
    requirementNumber: String(requirementNumber),
    projectName: context.config.project.name,
    requirementBody: requirement.body,
    clarification: clarification || '(none)',
    docs,
  });

  context.logger.info(`Drafting spec with ${context.agent.name}...`);
  const result = await context.agent.run({
    kind: 'spec',
    system,
    prompt,
    toolMode: 'read',
    spec: requirementNumber,
  });

  let body = result.text.trim();
  if (!body) {
    throw new HandrailError('SPEC_EMPTY', 'The agent returned an empty spec.');
  }
  if (!/Request\s*:\s*#\d+/i.test(body)) {
    body = `${body}\n\n---\n\nRequest: #${requirementNumber}\n`;
  }
  validateSpecBody(body);

  const spec = await context.github.issueCreate({
    title: `[Spec] ${requirement.title}`,
    body,
    labels: [context.config.github.labels.spec, context.config.github.labels.specReview],
  });
  await context.state.setActiveSpec(spec.number, requirementNumber);
  await context.github.issueComment(
    requirementNumber,
    `Spec drafted in #${spec.number}. A human must review it and add "${context.config.github.labels.specApproved}" before tickets are published.`,
  );

  context.logger.ok(`Created spec issue #${spec.number}: ${spec.url}`);
  return spec;
}
