export class HandrailError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'HandrailError';
    this.code = code;
    this.hint = hint;
  }
}

export class GateError extends HandrailError {
  constructor(message: string, hint?: string) {
    super('GATE_BLOCKED', message, hint);
    this.name = 'GateError';
  }
}

export class ExternalCommandError extends HandrailError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    hint?: string,
  ) {
    super(
      'EXTERNAL_COMMAND_FAILED',
      `Command failed with exit code ${exitCode}: ${command}`,
      hint,
    );
    this.name = 'ExternalCommandError';
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function isHandrailError(error: unknown): error is HandrailError {
  return error instanceof HandrailError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
