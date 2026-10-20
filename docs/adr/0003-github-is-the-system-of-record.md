# 0003. GitHub is the system of record

## Status

Accepted

## Context

A local workflow tool needs state: which requirement is active, which spec
belongs to it, which tickets exist, which PRs are open. That state can live in a
local file, a database or GitHub.

A local database creates a second source of truth. It drifts when people edit
issues, close tickets or merge PRs from the web UI. It also makes the workflow
opaque to teammates who do not run the tool.

## Decision

GitHub issues, labels, comments and pull requests are the authoritative record.
`.handrail/state.json` is a local cache of active IDs and status. It can be
deleted and reconstructed from GitHub. Approval is determined by labels, not by
local state.

Traceability is expressed in issue and PR bodies:

```text
Request: #100
Spec: #101
Task: #102
Closes #102
```

## Consequences

- The workflow is visible without Handrail installed.
- Teammates can inspect and correct artifacts directly on GitHub.
- Local state loss is recoverable.
- Reading the chain costs GitHub API calls and can be slower than a local query.
- Handrail must tolerate manually edited issues and inconsistent links.
