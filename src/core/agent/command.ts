import { spawn } from 'node:child_process';
import { HandrailError } from '../errors.js';
import { tail } from '../fs.js';
import type { AgentConfig, AgentResult } from '../../types.js';
import type { EvidenceStore } from '../evidence.js';
import type { Agent, AgentRequest } from './types.js';

export class CommandAgent implements Agent {
  readonly name = 'command';

  constructor(
    private readonly root: string,
    private readonly config: AgentConfig,
    private readonly evidence: EvidenceStore,
  ) {}

  async run(request: AgentRequest): Promise<AgentResult> {
    const [executable, ...args] = this.config.command;
    if (!executable) {
      throw new HandrailError(
        'AGENT_COMMAND_INVALID',
        'agent.command is empty.',
        'Set agent.command to an executable and its arguments, for example ["claude", "-p"].',
      );
    }

    const prompt = `${request.system}\n\n---\n\n${request.prompt}`;
    const startedAt = Date.now();

    const result = await new Promise<{
      code: number;
      stdout: string;
      stderr: string;
      error?: string;
      timedOut: boolean;
    }>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(executable, args, {
        cwd: this.root,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }, this.config.commandTimeoutMs);

      const finish = (code: number, error?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr, error, timedOut });
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: Error) => finish(127, error.message));
      child.on('close', (code: number | null) => finish(timedOut ? 124 : (code ?? 1)));

      child.stdin.write(prompt);
      child.stdin.end();
    });

    const durationMs = Date.now() - startedAt;
    await this.evidence.record({
      kind: 'agent',
      ticket: request.ticket,
      spec: request.spec,
      command: [executable, ...args].join(' '),
      cwd: this.root,
      exitCode: result.code,
      durationMs,
      stdoutTail: tail(result.stdout, 4000),
      stderrTail: tail(result.stderr, 4000),
      meta: {
        provider: 'command',
        agentKind: request.kind,
        timedOut: result.timedOut,
      },
    });

    if (result.code !== 0 || result.timedOut) {
      throw new HandrailError(
        'AGENT_COMMAND_FAILED',
        `External agent exited with ${result.code}${result.timedOut ? ' (timed out)' : ''}: ${
          result.error ?? result.stderr.slice(-800)
        }`,
        'Check agent.command and the agent CLI credentials.',
      );
    }

    return {
      text: result.stdout.trim(),
      usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
      stopReason: 'end_turn',
      truncated: false,
    };
  }
}
