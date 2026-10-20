import { createHash } from 'node:crypto';
import path from 'node:path';
import { readTextIfExists } from '../fs.js';
import { GateError } from '../errors.js';
import type { Context } from '../context.js';

export async function approveSpec(context: Context, specNumber: number): Promise<void> {
  const spec = await context.github.issueView(specNumber);
  if (!spec.labels.includes(context.config.github.labels.spec)) {
    throw new GateError(
      `Issue #${specNumber} is not a spec issue.`,
      `Only issues with the "${context.config.github.labels.spec}" label can be approved as specs.`,
    );
  }

  const user = await context.github.currentUser();
  const hash = sha256(spec.body);
  await context.github.issueEdit(specNumber, {
    addLabels: [context.config.github.labels.specApproved],
    removeLabels: [context.config.github.labels.specReview],
  });
  await context.github.issueComment(
    specNumber,
    [
      `Spec approved by @${user} at ${new Date().toISOString()}.`,
      '',
      `Approved body SHA-256: \`${hash}\``,
      '',
      'This label is an audit record. It does not replace branch protection, CI or PR review.',
    ].join('\n'),
  );
  await context.state.history('spec.approved', { spec: specNumber, user, hash });
  context.logger.ok(`Spec #${specNumber} approved by ${user}.`);
}

export async function approveTickets(context: Context, specNumber: number): Promise<void> {
  const spec = await context.github.issueView(specNumber);
  if (!spec.labels.includes(context.config.github.labels.spec)) {
    throw new GateError(`Issue #${specNumber} is not a spec issue.`);
  }

  const draftFile = path.join(context.root, '.handrail', 'drafts', `tickets-${specNumber}.json`);
  const draft = (await readTextIfExists(draftFile)) ?? '';
  if (!draft) {
    throw new GateError(
      `No ticket draft exists for spec #${specNumber}.`,
      `Run "handrail tickets ${specNumber}" before approving the split.`,
    );
  }

  const user = await context.github.currentUser();
  const hash = sha256(draft);
  await context.github.issueEdit(specNumber, {
    addLabels: [context.config.github.labels.ticketsApproved],
    removeLabels: [context.config.github.labels.needsTicketReview],
  });
  await context.github.issueComment(
    specNumber,
    [
      `Ticket split approved by @${user} at ${new Date().toISOString()}.`,
      '',
      `Approved draft SHA-256: \`${hash}\``,
      '',
      `Publish with \`handrail publish tickets ${specNumber}\`.`,
      'This label is an audit record. It does not replace branch protection, CI or PR review.',
    ].join('\n'),
  );
  await context.state.history('tickets.approved', { spec: specNumber, user, hash });
  context.logger.ok(`Ticket split for spec #${specNumber} approved by ${user}.`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
