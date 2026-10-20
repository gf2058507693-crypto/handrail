import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { ensureDir, isPathInside, tail, writeTextAtomic } from '../fs.js';
import { runCommand } from '../exec.js';
import { HandrailError } from '../errors.js';
import type { AgentConfig } from '../../types.js';
import type { EvidenceStore } from '../evidence.js';
import type { Logger } from '../logger.js';

export type ToolMode = 'none' | 'read' | 'write';

export interface ToolContext {
  root: string;
  config: AgentConfig;
  evidence: EvidenceStore;
  logger?: Logger;
  ticket?: number;
  spec?: number;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const READ_FILE: AnthropicTool = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file inside the repository. Optionally pass start_line and end_line (1-based, inclusive).',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path.' },
      start_line: { type: 'number', description: 'First line to return.' },
      end_line: { type: 'number', description: 'Last line to return.' },
    },
    required: ['path'],
  },
};

const LIST_FILES: AnthropicTool = {
  name: 'list_files',
  description:
    'List files and directories inside the repository. Directories such as node_modules, .git and dist are skipped.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative directory. Defaults to ".".' },
      max_depth: { type: 'number', description: 'Maximum recursion depth. Defaults to 4.' },
    },
  },
};

const SEARCH_FILES: AnthropicTool = {
  name: 'search_files',
  description:
    'Search text files for a JavaScript regular expression. Returns matching file paths with line numbers.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression.' },
      path: { type: 'string', description: 'Repository-relative directory. Defaults to ".".' },
      case_sensitive: { type: 'boolean', description: 'Defaults to false.' },
    },
    required: ['pattern'],
  },
};

const WRITE_FILE: AnthropicTool = {
  name: 'write_file',
  description: 'Create or fully overwrite a UTF-8 text file inside the repository.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path.' },
      content: { type: 'string', description: 'Full file content.' },
    },
    required: ['path', 'content'],
  },
};

const REPLACE_IN_FILE: AnthropicTool = {
  name: 'replace_in_file',
  description:
    'Replace an exact string in a file. Fails when old_string is absent or appears more than once unless replace_all is true.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path.' },
      old_string: { type: 'string', description: 'Exact text to replace.' },
      new_string: { type: 'string', description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence.' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

const RUN_COMMAND: AnthropicTool = {
  name: 'run_command',
  description:
    'Run a shell command in the repository root. Use it for builds, tests, formatters and git commits. Output is recorded as evidence.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
      timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 600000.' },
    },
    required: ['command'],
  },
};

export function toolsForMode(mode: ToolMode): AnthropicTool[] {
  if (mode === 'none') return [];
  if (mode === 'read') return [READ_FILE, LIST_FILES, SEARCH_FILES];
  return [READ_FILE, LIST_FILES, SEARCH_FILES, WRITE_FILE, REPLACE_IN_FILE, RUN_COMMAND];
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

export async function executeTool(
  context: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_file':
        return await readFileTool(context, input);
      case 'list_files':
        return await listFilesTool(context, input);
      case 'search_files':
        return await searchFilesTool(context, input);
      case 'write_file':
        return await writeFileTool(context, input);
      case 'replace_in_file':
        return await replaceInFileTool(context, input);
      case 'run_command':
        return await runCommandTool(context, input);
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

async function readFileTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const file = resolveInside(context.root, stringInput(input, 'path'));
  const content = await readFile(file, 'utf8');
  const lines = content.split('\n');
  const start = Math.max(1, numberInput(input, 'start_line') ?? 1);
  const end = Math.min(lines.length, numberInput(input, 'end_line') ?? lines.length);
  const slice = lines.slice(start - 1, end);
  const numbered = slice.map((line, index) => `${String(start + index).padStart(6)} | ${line}`);
  return {
    content: `${relative(context.root, file)} lines ${start}-${end} of ${lines.length}\n${numbered.join('\n')}`,
    isError: false,
  };
}

async function listFilesTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const start = resolveInside(context.root, stringInput(input, 'path', '.'));
  const maxDepth = Math.min(10, numberInput(input, 'max_depth') ?? 4);
  const entries = await walk(context.root, start, maxDepth, 2000);
  return { content: entries.join('\n') || '(empty)', isError: false };
}

async function searchFilesTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const pattern = stringInput(input, 'pattern');
  const start = resolveInside(context.root, stringInput(input, 'path', '.'));
  const caseSensitive = input.case_sensitive === true;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch (error) {
    return {
      content: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }

  const files = await walk(context.root, start, 8, 5000, true);
  const results: string[] = [];
  for (const file of files) {
    const absolute = path.join(context.root, file);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size > 512 * 1024) continue;
    let content: string;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      regex.lastIndex = 0;
      if (regex.test(lines[index] ?? '')) {
        results.push(`${file}:${index + 1}: ${(lines[index] ?? '').trim().slice(0, 200)}`);
        if (results.length >= 200) break;
      }
    }
    if (results.length >= 200) break;
  }

  return {
    content: results.length > 0 ? results.join('\n') : `No matches for /${pattern}/.`,
    isError: false,
  };
}

async function writeFileTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const file = resolveInside(context.root, stringInput(input, 'path'), true);
  const content = stringInput(input, 'content');
  await ensureDir(path.dirname(file));
  await writeTextAtomic(file, content);
  return { content: `Wrote ${relative(context.root, file)} (${content.length} chars).`, isError: false };
}

async function replaceInFileTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const file = resolveInside(context.root, stringInput(input, 'path'), true);
  const oldString = stringInput(input, 'old_string');
  const newString = stringInput(input, 'new_string');
  const replaceAll = input.replace_all === true;
  const content = await readFile(file, 'utf8');
  const count = countOccurrences(content, oldString);
  if (count === 0) {
    return { content: `old_string not found in ${relative(context.root, file)}.`, isError: true };
  }
  if (count > 1 && !replaceAll) {
    return {
      content: `old_string appears ${count} times in ${relative(context.root, file)}. Provide more context or set replace_all.`,
      isError: true,
    };
  }
  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await writeTextAtomic(file, updated);
  return {
    content: `Replaced ${replaceAll ? count : 1} occurrence(s) in ${relative(context.root, file)}.`,
    isError: false,
  };
}

async function runCommandTool(context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const command = stringInput(input, 'command');
  assertCommandAllowed(context.config, command);
  const timeoutMs = Math.min(
    10 * 60 * 1000,
    numberInput(input, 'timeout_ms') ?? 10 * 60 * 1000,
  );
  const result = await runCommand(command, { cwd: context.root, timeoutMs });
  await context.evidence.recordCommand(result, 'command', {
    ticket: context.ticket,
    spec: context.spec,
    label: 'agent shell',
  });
  const output = [
    `exit_code: ${result.exitCode}`,
    result.timedOut ? 'timed_out: true' : '',
    result.stdout ? `stdout:\n${tail(result.stdout, 20_000)}` : '',
    result.stderr ? `stderr:\n${tail(result.stderr, 10_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { content: output, isError: result.exitCode !== 0 || result.timedOut };
}

function assertCommandAllowed(config: AgentConfig, command: string): void {
  const normalized = command.trim();
  for (const denied of config.deniedCommands) {
    if (denied && normalized.includes(denied)) {
      throw new HandrailError(
        'COMMAND_DENIED',
        `Command contains a denied pattern: ${denied}`,
        'Change the command or update agent.deniedCommands in .handrail/config.json.',
      );
    }
  }
  if (config.allowedCommands.length === 0) return;
  const allowed = config.allowedCommands.some((prefix) => normalized.startsWith(prefix));
  if (!allowed) {
    throw new HandrailError(
      'COMMAND_NOT_ALLOWED',
      `Command is not in agent.allowedCommands: ${normalized}`,
      `Allowed prefixes: ${config.allowedCommands.join(', ')}`,
    );
  }
}

function resolveInside(root: string, value: string, forWrite = false): string {
  const absolute = path.resolve(root, value);
  if (!isPathInside(root, absolute)) {
    throw new HandrailError('PATH_OUTSIDE_REPO', `Path escapes the repository: ${value}`);
  }
  const relativePath = path.relative(root, absolute).split(path.sep).join('/');
  if (relativePath === '.git' || relativePath.startsWith('.git/')) {
    throw new HandrailError('PATH_PROTECTED', 'The .git directory is protected.');
  }
  if (forWrite && (relativePath === '.handrail' || relativePath.startsWith('.handrail/'))) {
    throw new HandrailError(
      'PATH_PROTECTED',
      'Agents may not edit .handrail/. The framework owns configuration, state and evidence.',
    );
  }
  return absolute;
}

async function walk(
  root: string,
  start: string,
  maxDepth: number,
  maxEntries: number,
  filesOnly = false,
): Promise<string[]> {
  const results: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'target', 'build']);

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxEntries) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        if (!filesOnly) results.push(`${relative(root, path.join(dir, entry.name))}/`);
        await visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        results.push(relative(root, path.join(dir, entry.name)));
      }
    }
  }

  await visit(start, 0);
  return results;
}

function stringInput(input: Record<string, unknown>, key: string, fallback?: string): string {
  const value = input[key];
  if (typeof value === 'string') return value;
  if (fallback !== undefined) return fallback;
  throw new HandrailError('TOOL_INPUT_INVALID', `Missing string input: ${key}`);
}

function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/') || '.';
}
