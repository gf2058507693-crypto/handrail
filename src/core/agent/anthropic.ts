import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { HandrailError } from '../errors.js';
import { ensureDir, tail } from '../fs.js';
import type { AgentConfig, AgentResult, AgentUsage } from '../../types.js';
import type { EvidenceStore } from '../evidence.js';
import type { Agent, AgentRequest } from './types.js';
import { executeTool, toolsForMode, type AnthropicTool } from './tools.js';

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface AnthropicResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

type Message = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

export class AnthropicAgent implements Agent {
  readonly name = 'anthropic';

  constructor(
    private readonly root: string,
    private readonly config: AgentConfig,
    private readonly evidence: EvidenceStore,
  ) {}

  async run(request: AgentRequest): Promise<AgentResult> {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) {
      throw new HandrailError(
        'AGENT_NO_API_KEY',
        `Environment variable ${this.config.apiKeyEnv} is not set.`,
        `Export ${this.config.apiKeyEnv}, or set agent.provider to "command" to use an external agent CLI.`,
      );
    }

    const tools = toolsForMode(request.toolMode);
    const messages: Message[] = [{ role: 'user', content: request.prompt }];
    const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, turns: 0 };
    const transcriptPath = await this.createTranscript(request);
    await appendJsonLine(transcriptPath, {
      type: 'start',
      at: new Date().toISOString(),
      kind: request.kind,
      system: request.system,
      prompt: request.prompt,
      model: this.config.model,
    });

    let finalText = '';
    let stopReason = 'max_turns';

    for (let turn = 0; turn < this.config.maxTurns; turn += 1) {
      usage.turns = turn + 1;
      const response = await this.callApi(apiKey, request.system, messages, tools);
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
      stopReason = response.stop_reason ?? 'unknown';

      const safeContent = response.content.filter(
        (block) => block.type === 'text' || block.type === 'tool_use',
      );
      const text = response.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n')
        .trim();
      if (text) finalText = finalText ? `${finalText}\n${text}` : text;

      await appendJsonLine(transcriptPath, {
        type: 'assistant',
        at: new Date().toISOString(),
        turn: turn + 1,
        stop_reason: response.stop_reason,
        text,
        content: safeContent,
        usage: response.usage,
      });

      messages.push({ role: 'assistant', content: safeContent });

      const toolUses = safeContent.filter(
        (block) => block.type === 'tool_use' && block.id && block.name,
      );
      if (toolUses.length === 0) {
        return {
          text: finalText,
          usage,
          stopReason,
          truncated: stopReason === 'max_tokens',
          transcriptPath,
        };
      }

      const toolResults: ContentBlock[] = [];
      for (const block of toolUses) {
        const result = await executeTool(
          {
            root: this.root,
            config: this.config,
            evidence: this.evidence,
            ticket: request.ticket,
            spec: request.spec,
          },
          block.name as string,
          block.input ?? {},
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
        await appendJsonLine(transcriptPath, {
          type: 'tool_result',
          at: new Date().toISOString(),
          turn: turn + 1,
          tool: block.name,
          input: block.input,
          is_error: result.isError,
          content: tail(result.content, 4000),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    await appendJsonLine(transcriptPath, {
      type: 'end',
      at: new Date().toISOString(),
      reason: 'max_turns',
      usage,
    });

    return {
      text: finalText,
      usage,
      stopReason: 'max_turns',
      truncated: true,
      transcriptPath,
    };
  }

  private async callApi(
    apiKey: string,
    system: string,
    messages: Message[],
    tools: AnthropicTool[],
  ): Promise<AnthropicResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages,
    };
    if (system.trim()) body.system = system;
    if (tools.length > 0) body.tools = tools;

    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < 3) {
          await sleep(attempt * 1000);
          continue;
        }
        throw new HandrailError('AGENT_NETWORK', `Anthropic request failed: ${lastError}`);
      }

      const raw = await response.text();
      if (!response.ok) {
        lastError = raw.slice(0, 1000);
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 3) {
          await sleep(attempt * 1500);
          continue;
        }
        throw new HandrailError(
          'AGENT_API_ERROR',
          `Anthropic API returned ${response.status}: ${lastError}`,
          response.status === 401 ? `Check ${this.config.apiKeyEnv}.` : undefined,
        );
      }

      let parsed: AnthropicResponse;
      try {
        parsed = JSON.parse(raw) as AnthropicResponse;
      } catch (error) {
        throw new HandrailError(
          'AGENT_API_BAD_JSON',
          `Cannot parse Anthropic response: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (parsed.error) {
        throw new HandrailError(
          'AGENT_API_ERROR',
          `Anthropic API error: ${parsed.error.type ?? 'unknown'} ${parsed.error.message ?? ''}`,
        );
      }

      return parsed;
    }

    throw new HandrailError('AGENT_API_ERROR', `Anthropic request failed: ${lastError}`);
  }

  private async createTranscript(request: AgentRequest): Promise<string> {
    const dir = path.join(this.root, '.handrail', 'evidence', 'transcripts');
    await ensureDir(dir);
    const target = request.ticket ?? request.spec ?? 'global';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(dir, `${request.kind}-${target}-${stamp}.jsonl`);
  }
}

async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
