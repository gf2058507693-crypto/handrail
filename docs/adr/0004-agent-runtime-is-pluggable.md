# 0004. The agent runtime is pluggable

## Status

Accepted

## Context

Teams use different coding agents: Anthropic models, Claude Code, Codex, an
internal gateway, or a deterministic test double. Hard-coding one runtime makes
the workflow engine unusable for everyone else and makes tests depend on a
model.

## Decision

Define a small `Agent` interface:

```ts
interface Agent {
  run(request: AgentRequest): Promise<AgentResult>;
}
```

Provide three implementations:

- `anthropic`: a built-in Messages API loop with repository tools;
- `command`: an external CLI driven through stdin/stdout;
- `mock`: deterministic output for tests and demos.

The workflow prompts are provider-neutral Markdown files. The provider only
receives a system prompt, a user prompt, a tool mode and optional ticket/spec
IDs.

## Consequences

- Teams can keep their preferred agent CLI.
- The built-in provider has no SDK dependency and can be audited.
- Tool safety lives in one place for the built-in provider; a command provider
  is responsible for its own tools.
- Prompt quality must be validated across providers.
- Provider-specific behavior such as token accounting differs.
