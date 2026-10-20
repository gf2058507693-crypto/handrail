import type { CheckRun } from '../types.js';

export interface ChecksSummary {
  status: 'pass' | 'fail' | 'pending' | 'none';
  failures: CheckRun[];
  pending: CheckRun[];
  total: number;
}

export function summarizeChecks(checks: CheckRun[]): ChecksSummary {
  if (checks.length === 0) {
    return { status: 'none', failures: [], pending: [], total: 0 };
  }
  const failures = checks.filter((check) => check.bucket === 'fail' || check.bucket === 'cancel');
  if (failures.length > 0) {
    return { status: 'fail', failures, pending: [], total: checks.length };
  }
  const pending = checks.filter((check) => check.bucket === 'pending');
  if (pending.length > 0) {
    return { status: 'pending', failures: [], pending, total: checks.length };
  }
  return { status: 'pass', failures: [], pending: [], total: checks.length };
}
