import path from 'node:path';
import { runFile } from './exec.js';
import { ExternalCommandError, HandrailError } from './errors.js';
import { writeText } from './fs.js';
import { DEFAULT_LABEL_META } from './config.js';
import type {
  CheckRun,
  HandrailConfig,
  Issue,
  LabelSet,
  PullRequest,
} from '../types.js';

interface GhIssueJson {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  labels: Array<{ name: string } | string>;
}

interface GhPrJson {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  headRefName: string;
  baseRefName: string;
  mergeable?: string;
}

export class GitHub {
  constructor(
    private readonly root: string,
    private readonly config: HandrailConfig,
  ) {}

  async run(args: string[], timeoutMs = 120_000): Promise<ReturnType<typeof runFile>> {
    return runFile('gh', args, { cwd: this.root, timeoutMs });
  }

  private async must(args: string[], hint?: string): Promise<string> {
    const result = await this.run(args);
    if (result.exitCode !== 0) {
      throw new ExternalCommandError(`gh ${args.join(' ')}`, result.exitCode, result.stdout, result.stderr, hint);
    }
    return result.stdout;
  }

  async ensureAuth(): Promise<string> {
    const result = await this.run(['auth', 'status']);
    if (result.exitCode !== 0) {
      throw new HandrailError(
        'GH_NOT_AUTHENTICATED',
        'GitHub CLI is not authenticated.',
        'Run "gh auth login" and try again.',
      );
    }
    return (await this.must(['api', 'user', '--jq', '.login'])).trim();
  }

  async repoName(): Promise<string> {
    if (this.config.github.repo) return this.config.github.repo;
    const raw = await this.must(
      ['repo', 'view', '--json', 'nameWithOwner'],
      'No GitHub repository detected. Set github.repo in .handrail/config.json or add an origin remote.',
    );
    return (JSON.parse(raw) as { nameWithOwner: string }).nameWithOwner;
  }

  async currentUser(): Promise<string> {
    return (await this.must(['api', 'user', '--jq', '.login'])).trim();
  }

  async issueView(number: number): Promise<Issue> {
    const raw = await this.must([
      'issue',
      'view',
      String(number),
      '--json',
      'number,title,body,state,url,labels',
    ]);
    return mapIssue(JSON.parse(raw) as GhIssueJson);
  }

  async tryIssue(number: number): Promise<Issue | null> {
    const result = await this.run([
      'issue',
      'view',
      String(number),
      '--json',
      'number,title,body,state,url,labels',
    ]);
    if (result.exitCode !== 0) return null;
    return mapIssue(JSON.parse(result.stdout) as GhIssueJson);
  }

  async issueCreate(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<Issue> {
    const bodyFile = await this.writeTemp(`issue-${Date.now()}.md`, input.body);
    const args = ['issue', 'create', '--title', input.title, '--body-file', bodyFile];
    for (const label of input.labels) args.push('--label', label);
    const output = await this.must(args);
    const match = output.match(/https:\/\/github\.com\/[^\s]+\/issues\/(\d+)/);
    if (!match) {
      const numberMatch = output.match(/#(\d+)/);
      if (!numberMatch) {
        throw new HandrailError('GH_ISSUE_PARSE', `Cannot parse created issue from: ${output}`);
      }
      return this.issueView(Number(numberMatch[1]));
    }
    return this.issueView(Number(match[1]));
  }

  async issueComment(number: number, body: string): Promise<void> {
    const bodyFile = await this.writeTemp(`comment-${Date.now()}.md`, body);
    await this.must(['issue', 'comment', String(number), '--body-file', bodyFile]);
  }

  async issueEdit(
    number: number,
    input: { body?: string; addLabels?: string[]; removeLabels?: string[] },
  ): Promise<void> {
    const args = ['issue', 'edit', String(number)];
    if (input.body !== undefined) {
      const bodyFile = await this.writeTemp(`edit-${Date.now()}.md`, input.body);
      args.push('--body-file', bodyFile);
    }
    for (const label of input.addLabels ?? []) args.push('--add-label', label);
    for (const label of input.removeLabels ?? []) args.push('--remove-label', label);
    await this.must(args);
  }

  async issueClose(number: number, comment?: string): Promise<void> {
    const args = ['issue', 'close', String(number)];
    if (comment) args.push('--comment', comment);
    await this.must(args);
  }

  async issueList(input: {
    labels?: string[];
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  } = {}): Promise<Issue[]> {
    const args = [
      'issue',
      'list',
      '--state',
      input.state ?? 'open',
      '--limit',
      String(input.limit ?? 100),
      '--json',
      'number,title,body,state,url,labels',
    ];
    for (const label of input.labels ?? []) args.push('--label', label);
    const raw = await this.must(args);
    return (JSON.parse(raw) as GhIssueJson[]).map(mapIssue);
  }

  async ensureLabels(labels: LabelSet): Promise<{ created: string[]; existing: string[] }> {
    const raw = await this.must(['label', 'list', '--limit', '200', '--json', 'name']);
    const existing = new Set(
      (JSON.parse(raw) as Array<{ name: string }>).map((label) => label.name),
    );
    const created: string[] = [];
    const already: string[] = [];
    for (const key of Object.keys(labels) as Array<keyof LabelSet>) {
      const name = labels[key];
      if (existing.has(name)) {
        already.push(name);
        continue;
      }
      const meta = DEFAULT_LABEL_META[key];
      await this.must([
        'label',
        'create',
        name,
        '--color',
        meta.color,
        '--description',
        meta.description,
      ]);
      created.push(name);
    }
    return { created, existing: already };
  }

  async prCreate(input: {
    base: string;
    head: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest> {
    const bodyFile = await this.writeTemp(`pr-${Date.now()}.md`, input.body);
    const args = [
      'pr',
      'create',
      '--base',
      input.base,
      '--head',
      input.head,
      '--title',
      input.title,
      '--body-file',
      bodyFile,
    ];
    if (input.draft) args.push('--draft');
    const output = await this.must(args);
    const match = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (!match) {
      const numberMatch = output.match(/#(\d+)/);
      if (!numberMatch) {
        throw new HandrailError('GH_PR_PARSE', `Cannot parse created pull request from: ${output}`);
      }
      return this.prView(Number(numberMatch[1]));
    }
    return this.prView(Number(match[1]));
  }

  async prView(number: number): Promise<PullRequest> {
    const raw = await this.must([
      'pr',
      'view',
      String(number),
      '--json',
      'number,title,body,state,url,headRefName,baseRefName,mergeable',
    ]);
    return mapPr(JSON.parse(raw) as GhPrJson);
  }

  async prEdit(number: number, input: { title?: string; body?: string }): Promise<void> {
    const args = ['pr', 'edit', String(number)];
    if (input.title) args.push('--title', input.title);
    if (input.body !== undefined) {
      const bodyFile = await this.writeTemp(`pr-edit-${Date.now()}.md`, input.body);
      args.push('--body-file', bodyFile);
    }
    await this.must(args);
  }

  async prForBranch(branch: string): Promise<PullRequest | null> {
    const raw = await this.must([
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '5',
      '--json',
      'number,title,body,state,url,headRefName,baseRefName',
    ]);
    const list = JSON.parse(raw) as GhPrJson[];
    return list.length > 0 ? mapPr(list[0]!) : null;
  }

  async prChecks(number: number): Promise<CheckRun[]> {
    const result = await this.run([
      'pr',
      'checks',
      String(number),
      '--json',
      'name,state,bucket,link',
    ]);
    if (result.exitCode !== 0) return [];
    return JSON.parse(result.stdout) as CheckRun[];
  }

  async prDiffStat(number: number): Promise<string> {
    return this.must(['pr', 'diff', String(number), '--patch']);
  }

  async commentOnPr(number: number, body: string): Promise<void> {
    const bodyFile = await this.writeTemp(`pr-comment-${Date.now()}.md`, body);
    await this.must(['pr', 'comment', String(number), '--body-file', bodyFile]);
  }

  private async writeTemp(name: string, content: string): Promise<string> {
    const file = path.join(this.root, '.handrail', 'tmp', name);
    await writeText(file, content);
    return file;
  }
}

function mapIssue(issue: GhIssueJson): Issue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    url: issue.url,
    labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name)),
  };
}

function mapPr(pr: GhPrJson): PullRequest {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    state: pr.state,
    url: pr.url,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    mergeable: pr.mergeable,
  };
}
