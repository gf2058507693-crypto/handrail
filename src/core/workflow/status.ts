import { GateError } from '../errors.js';
import { traceRequirement } from '../trace.js';
import { summarizeChecks } from '../checks.js';
import type { Context } from '../context.js';
import type { CheckRun, Issue, PullRequest } from '../../types.js';

export interface StatusOptions {
  spec?: number;
  verbose?: boolean;
}

export interface StatusReport {
  requirement?: Issue;
  spec?: Issue;
  specApproved: boolean;
  ticketsApproved: boolean;
  tickets: Array<{
    number: number;
    title: string;
    state: string;
    branch?: string;
    pr?: PullRequest;
    checks?: CheckRun[];
    checksStatus?: string;
  }>;
}

export async function getStatus(context: Context, options: StatusOptions = {}): Promise<StatusReport> {
  const state = await context.state.load();
  let specNumber = options.spec ?? state.activeSpec;

  if (!specNumber) {
    if (!state.activeRequirement) {
      throw new GateError(
        'No active requirement or spec.',
        'Run "handrail intake --prd <file>" first, or pass a spec number: handrail status <spec>.',
      );
    }
    const issues = await context.github.issueList({ state: 'all', limit: 200 });
    const linked = issues
      .filter((issue) => issue.labels.includes(context.config.github.labels.spec))
      .filter((issue) => Number((issue.body.match(/Request\s*:\s*#(\d+)/i) ?? [])[1]) === state.activeRequirement);
    specNumber = linked[0]?.number;
  }

  if (!specNumber) {
    const requirement = await context.github.issueView(state.activeRequirement!);
    const report: StatusReport = {
      requirement,
      specApproved: false,
      ticketsApproved: false,
      tickets: [],
    };
    printStatus(context, report);
    return report;
  }

  const chain = await traceRequirement(
    chainRequirementNumber(await context.github.issueView(specNumber)),
    context.github,
    context.config,
  );

  const report: StatusReport = {
    requirement: chain.requirement,
    spec: chain.spec,
    specApproved: Boolean(chain.spec?.labels.includes(context.config.github.labels.specApproved)),
    ticketsApproved: Boolean(chain.spec?.labels.includes(context.config.github.labels.ticketsApproved)),
    tickets: [],
  };

  for (const ticket of chain.tickets) {
    const branch = `${context.config.workflow.branchPrefix}${ticket.number}`;
    const pr = chain.pulls.find((pull) => pull.headRefName === branch);
    const checks = pr ? await context.github.prChecks(pr.number) : [];
    report.tickets.push({
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      branch,
      pr: pr ?? undefined,
      checks,
      checksStatus: summarizeChecks(checks).status,
    });
  }

  printStatus(context, report);
  return report;
}

function chainRequirementNumber(spec: Issue): number {
  const match = spec.body.match(/Request\s*:\s*#(\d+)/i);
  if (!match) {
    throw new GateError(`Spec #${spec.number} does not link a requirement.`);
  }
  return Number(match[1]);
}

function printStatus(context: Context, report: StatusReport): void {
  context.logger.section('Handrail status');
  if (report.requirement) {
    context.logger.info(
      `Requirement #${report.requirement.number} [${report.requirement.state}] ${report.requirement.title}`,
    );
  }
  if (!report.spec) {
    context.logger.info('No spec linked yet. Run "handrail clarify" and "handrail spec".');
    return;
  }
  context.logger.info(`Spec #${report.spec.number} [${report.spec.state}] ${report.spec.title}`);
  context.logger.info(`  spec-approved: ${report.specApproved ? 'yes' : 'no'}`);
  context.logger.info(`  tickets-approved: ${report.ticketsApproved ? 'yes' : 'no'}`);

  if (report.tickets.length === 0) {
    context.logger.info('  no tickets published yet');
    return;
  }

  context.logger.section('Tickets');
  for (const ticket of report.tickets) {
    const pr = ticket.pr ? `PR #${ticket.pr.number} (${ticket.pr.state})` : 'no PR';
    const checks = ticket.checksStatus ? `checks=${ticket.checksStatus}` : '';
    context.logger.info(
      `#${ticket.number} [${ticket.state}] ${ticket.title} | ${pr} | ${checks}`,
    );
  }
}
