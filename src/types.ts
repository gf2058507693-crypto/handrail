export type AgentProvider = 'anthropic' | 'command' | 'mock';

export interface LabelSet {
  requirement: string;
  spec: string;
  task: string;
  needsTriage: string;
  needsInfo: string;
  specReview: string;
  specApproved: string;
  ticketsApproved: string;
  needsTicketReview: string;
  readyForAgent: string;
  readyForHuman: string;
  wontfix: string;
  blocked: string;
}

export interface AgentConfig {
  provider: AgentProvider;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  maxTokens: number;
  maxTurns: number;
  /** External command used when provider is "command". Prompt is written to stdin. */
  command: string[];
  commandTimeoutMs: number;
  /** When non-empty, the shell tool only accepts commands whose first tokens match one of these prefixes. */
  allowedCommands: string[];
  /** Substrings that are always rejected by the shell tool. */
  deniedCommands: string[];
}

export interface ChecksConfig {
  commands: string[];
  timeoutMs: number;
}

export interface WorkflowConfig {
  requireSpecApproval: boolean;
  requireTicketsApproval: boolean;
  requireReview: boolean;
  requireChecks: boolean;
  requireCleanCI: boolean;
  branchPrefix: string;
  maxTicketsPerSpec: number;
}

export interface HandrailConfig {
  version: 1;
  project: {
    name: string;
    docsDir: string;
    adrDir: string;
    glossary: string;
  };
  github: {
    repo: string | null;
    baseBranch: string;
    labels: LabelSet;
  };
  agent: AgentConfig;
  checks: ChecksConfig;
  workflow: WorkflowConfig;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  labels: string[];
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  headRefName: string;
  baseRefName: string;
  mergeable?: string;
}

export interface CheckRun {
  name: string;
  state: string;
  bucket: string;
  link?: string;
}

export interface TicketDraft {
  key: string;
  title: string;
  goal: string;
  acceptance: string[];
  blocked_by: string[];
  test_plan: string[];
  demo: string;
  files_hint?: string[];
}

export interface ClarificationResult {
  summary: string;
  decisions: string[];
  open_questions: string[];
  non_goals: string[];
  glossary_terms: Array<{ term: string; definition: string }>;
  adr_candidates: Array<{ title: string; context: string; decision: string }>;
  next_question?: string;
  done?: boolean;
}

export interface ReviewFinding {
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  dimension: 'standards' | 'spec';
  file?: string;
  line?: number;
  summary: string;
  evidence?: string;
}

export interface ReviewResult {
  verdict: 'approve' | 'block';
  summary: string;
  findings: ReviewFinding[];
  spec_coverage: Array<{
    requirement: string;
    status: 'met' | 'missing' | 'partial';
    evidence?: string;
  }>;
}

export interface EvidenceRecord {
  id: string;
  kind: 'check' | 'command' | 'agent' | 'review' | 'git' | 'github' | 'acceptance';
  ticket?: number;
  spec?: number;
  command?: string;
  cwd: string;
  exitCode?: number;
  durationMs?: number;
  timestamp: string;
  stdoutTail?: string;
  stderrTail?: string;
  meta?: Record<string, unknown>;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

export interface AgentResult {
  text: string;
  usage: AgentUsage;
  stopReason: string;
  truncated: boolean;
  transcriptPath?: string;
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface TraceChain {
  requirement?: Issue;
  spec?: Issue;
  tickets: Issue[];
  pulls: PullRequest[];
}
