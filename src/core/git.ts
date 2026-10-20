import { runFile } from './exec.js';
import { ExternalCommandError, HandrailError } from './errors.js';
import type { CommandResult } from '../types.js';

export class Git {
  constructor(readonly root: string) {}

  async run(args: string[], timeoutMs = 120_000): Promise<CommandResult> {
    return runFile('git', args, { cwd: this.root, timeoutMs });
  }

  async must(args: string[], hint?: string): Promise<CommandResult> {
    const result = await this.run(args);
    if (result.exitCode !== 0) {
      throw new ExternalCommandError(`git ${args.join(' ')}`, result.exitCode, result.stdout, result.stderr, hint);
    }
    return result;
  }

  async assertRepo(): Promise<void> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree']);
    if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
      throw new HandrailError('NOT_A_GIT_REPO', `${this.root} is not a git repository.`);
    }
  }

  async currentBranch(): Promise<string> {
    const result = await this.must(['branch', '--show-current']);
    return result.stdout.trim();
  }

  async statusPorcelain(): Promise<string> {
    return (await this.must(['status', '--porcelain'])).stdout;
  }

  async isClean(): Promise<boolean> {
    return (await this.statusPorcelain()).trim() === '';
  }

  async assertClean(hint = 'Commit or stash your changes before continuing.'): Promise<void> {
    if (!(await this.isClean())) {
      throw new HandrailError('DIRTY_WORKTREE', 'Working tree has uncommitted changes.', hint);
    }
  }

  async fetch(remote = 'origin'): Promise<CommandResult> {
    return this.run(['fetch', remote, '--prune'], 180_000);
  }

  async revParse(ref: string): Promise<string | null> {
    const result = await this.run(['rev-parse', '--verify', ref]);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async branchExists(name: string): Promise<boolean> {
    if (await this.revParse(`refs/heads/${name}`)) return true;
    return (await this.revParse(`refs/remotes/origin/${name}`)) !== null;
  }

  async checkoutNew(branch: string, baseRef: string): Promise<void> {
    await this.must(['checkout', '-B', branch, baseRef], `Cannot create branch ${branch} from ${baseRef}.`);
  }

  async checkout(branch: string): Promise<void> {
    await this.must(['checkout', branch]);
  }

  async addAll(): Promise<void> {
    await this.must(['add', '-A']);
  }

  async commit(message: string): Promise<boolean> {
    const staged = await this.run(['diff', '--cached', '--quiet']);
    if (staged.exitCode === 0) return false;
    await this.must(['commit', '-m', message]);
    return true;
  }

  async push(branch: string, setUpstream = true): Promise<void> {
    const args = ['push'];
    if (setUpstream) args.push('-u');
    args.push('origin', branch);
    await this.must(args, 'Push failed. Check your git remote and credentials.');
  }

  async diffStat(baseRef: string): Promise<string> {
    return (await this.must(['diff', '--stat', `${baseRef}...HEAD`])).stdout;
  }

  async diff(baseRef: string, maxChars = 120_000): Promise<string> {
    const result = await this.must(['diff', `${baseRef}...HEAD`]);
    if (result.stdout.length <= maxChars) return result.stdout;
    return `${result.stdout.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters]`;
  }

  async changedFiles(baseRef: string): Promise<string[]> {
    const result = await this.must(['diff', '--name-only', `${baseRef}...HEAD`]);
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async log(baseRef: string, maxCount = 20): Promise<string> {
    return (await this.must(['log', `--max-count=${maxCount}`, '--oneline', `${baseRef}..HEAD`])).stdout;
  }

  async commitsAhead(baseRef: string): Promise<number> {
    const result = await this.must(['rev-list', '--count', `${baseRef}..HEAD`]);
    return Number(result.stdout.trim() || '0');
  }

  async mergeBase(baseRef: string): Promise<string> {
    return (await this.must(['merge-base', baseRef, 'HEAD'])).stdout.trim();
  }

  async remoteUrl(remote = 'origin'): Promise<string | null> {
    const result = await this.run(['remote', 'get-url', remote]);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }
}
