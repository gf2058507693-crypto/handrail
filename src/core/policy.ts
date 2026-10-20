import type { Issue } from '../types.js';
import { parseBlockedBy, parseCloses, parseLinkedIssue } from './gates.js';

export interface PolicyInput {
  body: string;
  task: Issue | null;
  spec: Issue | null;
  labels: {
    specApproved: string;
    ticketsApproved: string;
    task: string;
  };
}

export interface PolicyResult {
  ok: boolean;
  violations: string[];
}

export function evaluatePullRequest(input: PolicyInput): PolicyResult {
  const violations: string[] = [];
  const body = input.body ?? '';

  const request = parseLinkedIssue(body, 'Request');
  const spec = parseLinkedIssue(body, 'Spec');
  const task = parseLinkedIssue(body, 'Task');

  if (!request) violations.push('PR body is missing "Request: #<issue>".');
  if (!spec) violations.push('PR body is missing "Spec: #<issue>".');
  if (!task) violations.push('PR body is missing "Task: #<issue>".');

  if (input.task === null) {
    violations.push(`Task issue ${task ? `#${task}` : ''} could not be read.`);
  } else {
    if (!input.task.labels.includes(input.labels.task)) {
      violations.push(`Task issue #${input.task.number} is missing the "${input.labels.task}" label.`);
    }
    if (task && task !== input.task.number) {
      violations.push(`PR references task #${task}, but the resolved task is #${input.task.number}.`);
    }
    const taskSpec = parseLinkedIssue(input.task.body, 'Spec');
    if (spec && taskSpec !== spec) {
      violations.push(`Task #${input.task.number} links Spec #${taskSpec}, but the PR links Spec #${spec}.`);
    }
    const taskRequest = parseLinkedIssue(input.task.body, 'Request');
    if (request && taskRequest !== request) {
      violations.push(`Task #${input.task.number} links Request #${taskRequest ?? '?'}, but the PR links Request #${request}.`);
    }
  }

  if (input.spec === null) {
    violations.push(`Spec issue ${spec ? `#${spec}` : ''} could not be read.`);
  } else {
    if (!input.spec.labels.includes(input.labels.specApproved)) {
      violations.push(`Spec #${input.spec.number} is missing "${input.labels.specApproved}".`);
    }
    if (!input.spec.labels.includes(input.labels.ticketsApproved)) {
      violations.push(`Spec #${input.spec.number} is missing "${input.labels.ticketsApproved}".`);
    }
    if (request) {
      const specRequest = parseLinkedIssue(input.spec.body, 'Request');
      if (specRequest !== request) {
        violations.push(
          `Spec #${input.spec.number} links Request #${specRequest ?? '?'}, but the PR links Request #${request}.`,
        );
      }
    }
  }

  const closes = parseCloses(body);
  if (task && (closes.length !== 1 || closes[0] !== task)) {
    violations.push(`PR must close exactly task #${task}, and no other issue.`);
  }
  if (input.spec && closes.includes(input.spec.number)) {
    violations.push(`PR must not close spec #${input.spec.number}. Close it only after final acceptance.`);
  }
  if (request && closes.includes(request)) {
    violations.push(`PR must not close requirement #${request}.`);
  }

  const evidence = extractSection(body, 'Evidence');
  if (!evidence) {
    violations.push('PR body is missing an "## Evidence" section.');
  } else {
    if (/checklist item|\[ \]|TODO|<.*>/.test(evidence)) {
      violations.push('Evidence section still contains placeholders or unchecked boxes.');
    }
    if (/No commands were recorded|No automated checks executed/i.test(evidence)) {
      violations.push('Evidence section says no commands were executed.');
    }
    if (!/(exit_code|exit code|PASS|FAIL)/i.test(evidence)) {
      violations.push('Evidence section does not contain actual command results.');
    }
  }

  if (!extractSection(body, 'Merge Danger')) {
    violations.push('PR body is missing a "## Merge Danger" section.');
  }

  if (input.task) {
    const dependencies = parseBlockedBy(input.task.body);
    if (dependencies.includes(input.task.number)) {
      violations.push(`Task #${input.task.number} is blocked by itself.`);
    }
  }

  return { ok: violations.length === 0, violations };
}

export function extractSection(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, 'i').test(line));
  if (start === -1) return null;
  const level = (lines[start]?.match(/^#+/) ?? ['##'])[0].length;
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^(#{1,6})\s+/);
    if (match && match[1]!.length <= level) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
