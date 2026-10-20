import { spawn } from 'node:child_process';
import type { CommandResult } from '../types.js';

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;

export async function runCommand(
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  return runSpawn(command, [], options, true);
}

export async function runFile(
  file: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  return runSpawn(file, args, options, false);
}

function runSpawn(
  fileOrCommand: string,
  args: string[],
  options: RunCommandOptions,
  shell: boolean,
): Promise<CommandResult> {
  const startedAt = Date.now();
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise<CommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(fileOrCommand, args, {
      cwd: options.cwd,
      shell,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') <= maxOutput) return next;
      return next.slice(Math.max(0, next.length - maxOutput));
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    const finish = (exitCode: number, extraError?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: shell ? fileOrCommand : [fileOrCommand, ...args].join(' '),
        cwd: options.cwd,
        exitCode,
        stdout,
        stderr: extraError ? `${stderr}\n${extraError}`.trim() : stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    child.on('error', (error: Error) => finish(127, error.message));
    child.on('close', (code: number | null) => {
      finish(timedOut ? 124 : (code ?? 1));
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGTERM');
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

export async function commandExists(command: string, cwd: string): Promise<boolean> {
  const result = await runCommand(
    process.platform === 'win32' ? `where ${command}` : `command -v ${command}`,
    { cwd, timeoutMs: 10_000 },
  );
  return result.exitCode === 0;
}
