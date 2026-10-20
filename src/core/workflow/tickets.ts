import path from 'node:path';
import { HandrailError } from '../errors.js';
import { extractJson } from '../json.js';
import { readText, readTextIfExists } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import { loadDocsBundle } from '../context.js';
import {
  loadSpecContext,
  parseTickets,
  renderTicketBody,
  writeDraft,
} from './common.js';
import { requireSpecApproved, requireTicketsApproved } from '../gates.js';
import type { Context } from '../context.js';
import type { Issue, TicketDraft } from '../../types.js';

export interface TicketPlan {
  tickets: TicketDraft[];
  file: string;
}

export async function planTickets(context: Context, specNumber: number): Promise<TicketPlan> {
  const { spec, requirement } = await loadSpecContext(context, specNumber);
  requireSpecApproved(spec, context.config);

  const docs = await loadDocsBundle(context);
  const system = await renderPrompt('tickets.system', {});
  const prompt = await renderPrompt('tickets.user', {
    specNumber: String(specNumber),
    projectName: context.config.project.name,
    maxTickets: String(context.config.workflow.maxTicketsPerSpec),
    specBody: spec.body,
    requirementBody: requirement.body,
    docs,
  });

  context.logger.info(`Drafting tickets with ${context.agent.name}...`);
  const result = await context.agent.run({
    kind: 'tickets',
    system,
    prompt,
    toolMode: 'read',
    spec: specNumber,
  });

  const parsed = parseTickets(
    extractJson<unknown>(result.text),
    context.config.workflow.maxTicketsPerSpec,
  );

  const jsonFile = await writeDraft(
    context,
    `tickets-${specNumber}.json`,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  const markdown = renderTicketPlan(specNumber, parsed.tickets);
  await writeDraft(context, `tickets-${specNumber}.md`, markdown);

  context.logger.info(markdown);
  context.logger.ok(`Ticket draft saved to ${jsonFile}`);
  context.logger.info(
    `Next: review the split, then run "handrail approve tickets ${specNumber}" and "handrail publish tickets ${specNumber}".`,
  );

  return { tickets: parsed.tickets, file: jsonFile };
}

export async function publishTickets(context: Context, specNumber: number): Promise<Issue[]> {
  const { spec, requirement } = await loadSpecContext(context, specNumber);
  requireSpecApproved(spec, context.config);
  requireTicketsApproved(spec, context.config);

  const draftFile = path.join(context.root, '.handrail', 'drafts', `tickets-${specNumber}.json`);
  const raw = await readTextIfExists(draftFile);
  if (!raw) {
    throw new HandrailError(
      'TICKETS_DRAFT_MISSING',
      `No ticket draft found at ${draftFile}.`,
      `Run "handrail tickets ${specNumber}" first.`,
    );
  }
  const parsed = parseTickets(JSON.parse(raw), context.config.workflow.maxTicketsPerSpec);

  const existing = (await context.github.issueList({ state: 'all', limit: 200 })).filter(
    (issue) =>
      issue.labels.includes(context.config.github.labels.task) &&
      /Spec\s*:\s*#(\d+)/i.test(issue.body) &&
      Number((issue.body.match(/Spec\s*:\s*#(\d+)/i) ?? [])[1]) === specNumber,
  );
  if (existing.length > 0) {
    throw new HandrailError(
      'TICKETS_ALREADY_PUBLISHED',
      `Spec #${specNumber} already has ${existing.length} published ticket(s): ${existing
        .map((issue) => `#${issue.number}`)
        .join(', ')}.`,
      'Close or delete the old tickets before publishing again.',
    );
  }

  const keyToNumber = new Map<string, number>();
  const created: Issue[] = [];

  for (const draft of parsed.tickets) {
    const issue = await context.github.issueCreate({
      title: `[Task] ${draft.title}`,
      body: renderTicketBody(draft, {
        requirement: requirement.number,
        spec: specNumber,
        blockedBy: [],
      }),
      labels: [
        context.config.github.labels.task,
        context.config.github.labels.readyForAgent,
      ],
    });
    keyToNumber.set(draft.key, issue.number);
    created.push(issue);
    await context.state.registerTicket(specNumber, requirement.number, issue.number, draft.title);
  }

  for (const draft of parsed.tickets) {
    const number = keyToNumber.get(draft.key);
    if (!number) continue;
    const blockedBy = draft.blocked_by.map((key) => keyToNumber.get(key)).filter((value): value is number => Boolean(value));
    const issue = created.find((item) => item.number === number);
    if (!issue) continue;
    await context.github.issueEdit(number, {
      body: renderTicketBody(draft, {
        requirement: requirement.number,
        spec: specNumber,
        blockedBy,
      }),
    });
  }

  await context.github.issueComment(
    specNumber,
    [
      'Tickets published:',
      ...parsed.tickets.map((draft) => `- #${keyToNumber.get(draft.key)} ${draft.title} (${draft.key})`),
      '',
      'Implement in dependency order. Human approval and CI are still required before merge.',
    ].join('\n'),
  );

  context.logger.ok(`Published ${created.length} ticket(s) for spec #${specNumber}.`);
  return created;
}

export function renderTicketPlan(specNumber: number, tickets: TicketDraft[]): string {
  const lines = [
    `# Ticket plan for spec #${specNumber}`,
    '',
    '| Key | Title | Blocked by | Acceptance criteria |',
    '|---|---|---|---|',
  ];
  for (const ticket of tickets) {
    lines.push(
      `| ${ticket.key} | ${ticket.title.replace(/\|/g, '\\|')} | ${
        ticket.blocked_by.join(', ') || '-'
      } | ${ticket.acceptance.length} |`,
    );
  }
  lines.push('', '## Details', '');
  for (const ticket of tickets) {
    lines.push(
      `### ${ticket.key}: ${ticket.title}`,
      '',
      `**Goal:** ${ticket.goal}`,
      '',
      '**Acceptance:**',
      ...ticket.acceptance.map((item) => `- [ ] ${item}`),
      '',
      `**Blocked by:** ${ticket.blocked_by.join(', ') || 'none'}`,
      '',
      '**Demo:**',
      ticket.demo || 'TBD',
      '',
      '**Test plan:**',
      ...(ticket.test_plan.length > 0 ? ticket.test_plan.map((item) => `- ${item}`) : ['- TBD']),
      '',
    );
  }
  return lines.join('\n');
}

export async function readTicketDraft(context: Context, specNumber: number): Promise<TicketDraft[]> {
  const file = path.join(context.root, '.handrail', 'drafts', `tickets-${specNumber}.json`);
  const raw = await readText(file);
  return parseTickets(JSON.parse(raw), context.config.workflow.maxTicketsPerSpec).tickets;
}
