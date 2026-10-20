import path from 'node:path';
import { HandrailError } from '../errors.js';
import { extractJson } from '../json.js';
import { writeTextAtomic } from '../fs.js';
import { renderPrompt } from '../prompts.js';
import { baseRef, loadTicketContext } from './common.js';
import type { Context } from '../context.js';
import type { ReviewFinding, ReviewResult } from '../../types.js';

export async function reviewTicket(context: Context, ticketNumber: number): Promise<ReviewResult> {
  const { ticket, spec, specNumber } = await loadTicketContext(context, ticketNumber);
  const base = await baseRef(context);
  const expectedBranch = `${context.config.workflow.branchPrefix}${ticketNumber}`;
  const currentBranch = await context.git.currentBranch();

  if (currentBranch !== expectedBranch) {
    if (await context.git.branchExists(expectedBranch)) {
      await context.git.checkout(expectedBranch);
    } else {
      throw new HandrailError(
        'BRANCH_MISSING',
        `Expected branch ${expectedBranch}, current branch is ${currentBranch}.`,
        `Run "handrail implement ${ticketNumber}" first.`,
      );
    }
  }

  const commits = await context.git.commitsAhead(base);
  if (commits === 0) {
    throw new HandrailError(
      'NOTHING_TO_REVIEW',
      `No commits on ${expectedBranch} compared to ${base}.`,
    );
  }
  await context.git.assertClean('Commit or stash changes before recording a review.');
  const headSha = await context.git.revParse('HEAD');
  const baseSha = await context.git.revParse(base);

  const changedFiles = await context.git.changedFiles(base);
  const diff = await context.git.diff(base);
  const system = await renderPrompt('review.system', {});
  const prompt = await renderPrompt('review.user', {
    ticketNumber: String(ticketNumber),
    projectName: context.config.project.name,
    baseRef: base,
    branch: expectedBranch,
    ticketBody: ticket.body,
    specNumber: String(specNumber),
    specBody: spec.body,
    changedFiles: changedFiles.join('\n'),
    diff,
  });

  context.logger.info(`Reviewing #${ticketNumber} against ${base}...`);
  const result = await context.agent.run({
    kind: 'review',
    system,
    prompt,
    toolMode: 'read',
    ticket: ticketNumber,
    spec: specNumber,
  });

  const review = parseReview(result.text);
  const dir = path.join(context.root, '.handrail', 'evidence');
  await writeTextAtomic(
    path.join(dir, `review-${ticketNumber}.json`),
    `${JSON.stringify({ ...review, headSha, baseSha }, null, 2)}\n`,
  );
  await writeTextAtomic(path.join(dir, `review-${ticketNumber}.md`), renderReview(ticketNumber, review));
  await context.evidence.record({
    kind: 'review',
    ticket: ticketNumber,
    spec: specNumber,
    command: `agent review (${context.agent.name})`,
    cwd: context.root,
    exitCode: review.verdict === 'approve' ? 0 : 1,
    meta: {
      verdict: review.verdict,
      blockers: review.findings.filter((finding) => finding.severity === 'blocker').length,
      findings: review.findings.length,
    },
  });

  printReview(context, review);
  return review;
}

function parseReview(text: string): ReviewResult {
  const parsed = extractJson<Record<string, unknown>>(text);
  const verdict =
    parsed.verdict === 'approve' ? 'approve' : parsed.verdict === 'block' ? 'block' : null;
  if (!verdict) {
    throw new HandrailError(
      'REVIEW_INVALID',
      'Review output must contain verdict "approve" or "block".',
    );
  }
  const rawFindings = Array.isArray(parsed.findings) ? (parsed.findings as unknown[]) : [];
  const findings: ReviewFinding[] = rawFindings
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((finding) => ({
      severity: normalizeSeverity(finding.severity),
      dimension: (finding.dimension === 'standards' ? 'standards' : 'spec') as ReviewFinding['dimension'],
      file: typeof finding.file === 'string' ? finding.file : undefined,
      line: typeof finding.line === 'number' ? finding.line : undefined,
      summary: String(finding.summary ?? ''),
      evidence: typeof finding.evidence === 'string' ? finding.evidence : undefined,
    }))
    .filter((finding) => finding.summary);

  const rawCoverage = Array.isArray(parsed.spec_coverage) ? (parsed.spec_coverage as unknown[]) : [];

  return {
    verdict,
    summary: String(parsed.summary ?? ''),
    findings,
    spec_coverage: rawCoverage
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((coverage) => {
        const status =
          coverage.status === 'met' || coverage.status === 'partial' || coverage.status === 'missing'
            ? coverage.status
            : 'partial';
        return {
          requirement: String(coverage.requirement ?? ''),
          status: status as 'met' | 'partial' | 'missing',
          evidence: typeof coverage.evidence === 'string' ? coverage.evidence : undefined,
        };
      }),
  };
}

function normalizeSeverity(value: unknown): ReviewFinding['severity'] {
  return value === 'blocker' || value === 'major' || value === 'minor' || value === 'nit'
    ? value
    : 'major';
}

function renderReview(ticketNumber: number, review: ReviewResult): string {
  const lines = [
    `# Review for #${ticketNumber}`,
    '',
    `Verdict: **${review.verdict}**`,
    '',
    review.summary || '_No summary._',
    '',
    '## Findings',
  ];
  if (review.findings.length === 0) {
    lines.push('_No findings._');
  } else {
    for (const finding of review.findings) {
      lines.push(
        `- **${finding.severity} / ${finding.dimension}** ${finding.summary}` +
          (finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ''})` : ''),
      );
      if (finding.evidence) lines.push(`  - Evidence: ${finding.evidence}`);
    }
  }
  lines.push('', '## Spec coverage');
  if (review.spec_coverage.length === 0) {
    lines.push('_No coverage entries._');
  } else {
    for (const coverage of review.spec_coverage) {
      lines.push(`- [${coverage.status}] ${coverage.requirement}${coverage.evidence ? ` — ${coverage.evidence}` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function printReview(context: Context, review: ReviewResult): void {
  const blockers = review.findings.filter((finding) => finding.severity === 'blocker');
  if (review.verdict === 'approve') {
    context.logger.ok(`Review approved: ${review.summary}`);
  } else {
    context.logger.error(`Review blocked: ${review.summary}`);
  }
  for (const finding of review.findings) {
    const location = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ''})` : '';
    context.logger.info(`- ${finding.severity}/${finding.dimension}: ${finding.summary}${location}`);
  }
  if (blockers.length > 0) {
    context.logger.warn(`${blockers.length} blocker(s) must be resolved.`);
  }
}
