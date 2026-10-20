const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const color = {
  bold: (s: string) => paint('1', s),
  dim: (s: string) => paint('2', s),
  red: (s: string) => paint('31', s),
  green: (s: string) => paint('32', s),
  yellow: (s: string) => paint('33', s),
  blue: (s: string) => paint('34', s),
  magenta: (s: string) => paint('35', s),
  cyan: (s: string) => paint('36', s),
};

export interface LoggerOptions {
  verbose?: boolean;
  json?: boolean;
}

export class Logger {
  private readonly verbose: boolean;
  private readonly json: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.json = options.json ?? false;
  }

  info(message: string): void {
    this.write(console.log, message);
  }

  ok(message: string): void {
    this.write(console.log, `${color.green('OK')} ${message}`);
  }

  warn(message: string): void {
    this.write(console.warn, `${color.yellow('WARN')} ${message}`);
  }

  error(message: string): void {
    this.write(console.error, `${color.red('ERROR')} ${message}`);
  }

  detail(message: string): void {
    if (this.verbose) this.write(console.log, color.dim(message));
  }

  section(title: string): void {
    this.write(console.log, `\n${color.bold(title)}`);
  }

  step(index: number, total: number, title: string): void {
    this.write(console.log, `\n${color.cyan(`[${index}/${total}]`)} ${color.bold(title)}`);
  }

  jsonLine(value: unknown): void {
    if (this.json) console.log(JSON.stringify(value));
  }

  private write(writer: (message?: unknown, ...args: unknown[]) => void, message: string): void {
    if (this.json) {
      writer(message);
      return;
    }
    writer(message);
  }
}
