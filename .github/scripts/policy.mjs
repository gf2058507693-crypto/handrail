#!/usr/bin/env node
/**
 * AI development policy check.
 *
 * Fails a pull request unless it is traceable and carries real evidence.
 * This script is self-contained so it works without installing Handrail.
 */

import { execFileSync } from 'node:child_process';

const SPEC_APPROVED = 'spec-approved';
const TICKETS_APPROVED = 'tickets-approved';
const TASK_LABEL = 'task';

const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const body = process.env.PR_BODY ?? '';

const violations = [];

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function issue(number) {
  try {
    return JSON.parse(gh(['api', `repos/${repo}/issues/${number}`]));
  } catch (error) {
    violations.push(`Cannot read issue #${number}: ${error.message}`);
    return null;
  }
}

function labelsOf(item) {
  return (item?.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name));
}

function link(field) {
  const match = body.match(new RegExp(`${field}\\s*:\\s*#(\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function section(name) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^#{1,6}\\s+${name}\\s*$`, 'i').test(line),
  );
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) ?? ['##'])[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

const requestNumber = link('Request');
const specNumber = link('Spec');
const taskNumber = link('Task');

if (!requestNumber) violations.push('PR body is missing "Request: #<issue>".');
if (!specNumber) violations.push('PR body is missing "Spec: #<issue>".');
if (!taskNumber) violations.push('PR body is missing "Task: #<issue>".');

const task = taskNumber ? issue(taskNumber) : null;
const spec = specNumber ? issue(specNumber) : null;

if (task) {
  if (!labelsOf(task).includes(TASK_LABEL)) {
    violations.push(`Task #${taskNumber} is missing the "${TASK_LABEL}" label.`);
  }
  const taskSpec = String(task.body ?? '').match(/Spec\s*:\s*#(\d+)/i);
  if (taskSpec && specNumber && Number(taskSpec[1]) !== specNumber) {
    violations.push(`Task #${taskNumber} links Spec #${taskSpec[1]}, not #${specNumber}.`);
  }
}

if (spec) {
  const labels = labelsOf(spec);
  if (!labels.includes(SPEC_APPROVED)) {
    violations.push(`Spec #${specNumber} is missing "${SPEC_APPROVED}".`);
  }
  if (!labels.includes(TICKETS_APPROVED)) {
    violations.push(`Spec #${specNumber} is missing "${TICKETS_APPROVED}".`);
  }
  const specRequest = String(spec.body ?? '').match(/Request\s*:\s*#(\d+)/i);
  if (specRequest && requestNumber && Number(specRequest[1]) !== requestNumber) {
    violations.push(`Spec #${specNumber} links Request #${specRequest[1]}, not #${requestNumber}.`);
  }
}

const closes = [...body.matchAll(/\bCloses\s+#(\d+)/gi)].map((match) => Number(match[1]));
if (taskNumber && !closes.includes(taskNumber)) {
  violations.push(`PR must contain "Closes #${taskNumber}".`);
}
if (specNumber && closes.includes(specNumber)) {
  violations.push(`PR must not close spec #${specNumber}.`);
}
if (requestNumber && closes.includes(requestNumber)) {
  violations.push(`PR must not close requirement #${requestNumber}.`);
}

const evidence = section('Evidence');
if (!evidence) {
  violations.push('PR body is missing an "## Evidence" section.');
} else {
  if (/\[ \]|TODO|<[^>]+>/.test(evidence)) {
    violations.push('Evidence still contains placeholders or unchecked boxes.');
  }
  if (/No commands were recorded|No automated checks executed/i.test(evidence)) {
    violations.push('Evidence says no commands were executed.');
  }
  if (!/(exit_code|exit code|PASS|FAIL)/i.test(evidence)) {
    violations.push('Evidence does not contain actual command results.');
  }
}

if (!section('Merge Danger')) {
  violations.push('PR body is missing a "## Merge Danger" section.');
}

if (violations.length > 0) {
  console.error('AI development policy failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error(`\nPR #${prNumber ?? '?'} must be traceable and evidence-backed before merge.`);
  process.exit(1);
}

console.log(`AI development policy passed for PR #${prNumber}.`);
