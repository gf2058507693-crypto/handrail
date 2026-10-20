# 0002. Evidence comes from execution

## Status

Accepted

## Context

Coding agents frequently report that tests pass when the tests were not run, were
run against the wrong code, or failed but were summarized optimistically. A PR
description written by a model is not evidence.

## Decision

Every configured check and every shell command run by the built-in agent is
recorded as an evidence record:

```json
{
  "kind": "check",
  "command": "npm test",
  "exitCode": 0,
  "durationMs": 8123,
  "timestamp": "..."
}
```

PR evidence is generated from these records, not from the model's prose. If no
check record exists, PR creation is blocked when checks are required. The policy
workflow also rejects PRs whose Evidence section contains placeholders or says
that no commands were executed.

## Consequences

- A passing test claim always points to an execution.
- Agents cannot improve their evidence by writing a better sentence.
- The evidence log is local and ignored by git; durable evidence lives in CI and
  the PR conversation.
- Teams must configure at least one meaningful check command.
- A skipped check is visible rather than hidden.
