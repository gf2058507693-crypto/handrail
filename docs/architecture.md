# Architecture

This document explains how Handrail is put together and why the boundaries are
where they are. It describes the current implementation, not a future roadmap.

## 1. Goals and non-goals

Handrail has four goals:

1. Turn a product requirement into a traceable chain of GitHub artifacts.
2. Automate the mechanical parts of delivery: drafting, branching, running
   checks, committing, reviewing, and opening pull requests.
3. Keep human approval and independent review mandatory.
4. Make every test claim traceable to a command that actually ran.

It has four explicit non-goals:

1. It is not a fully autonomous project builder.
2. It does not merge pull requests.
3. It does not replace GitHub branch protection, CODEOWNERS or CI.
4. It does not provide a security sandbox for generated code.

## 2. Runtime flow

```text
CLI command
  |
  v
createContext()
  |-- findProjectRoot()      walk up to .handrail/config.json
  |-- loadConfig()           validate and merge defaults
  |-- Git                    subprocess wrapper
  |-- GitHub                 gh subprocess wrapper
  |-- StateStore             local cache of active requirement/spec/tickets
  |-- EvidenceStore          JSONL execution log
  `-- Agent                  anthropic | command | mock
  |
  v
workflow function
  |-- read GitHub issues
  |-- enforce gates
  |-- render prompt
  |-- run agent
  |-- run checks
  |-- write evidence
  |-- create/update GitHub artifacts
  `-- update local state
```

The CLI is intentionally thin. Each command resolves the project context and
calls one workflow function. Workflow functions are where the ordered steps and
gates live.

## 3. Components

| Component | Responsibility | Does not do |
|---|---|---|
| `commands/` | Parse options, create context, call one workflow function | Contain business rules |
| `core/workflow/` | Ordered steps, gate checks, artifact creation | Know about CLI flags |
| `core/gates.ts` | Label and dependency checks | Mutate GitHub |
| `core/github.ts` | `gh` subprocess calls and JSON mapping | Decide policy |
| `core/git.ts` | `git` subprocess calls | Decide branch strategy |
| `core/evidence.ts` | Record and query execution evidence | Interpret product intent |
| `core/agent/` | Agent loop, tools, provider adapters | Enforce workflow gates |
| `core/policy.ts` | Pure PR policy evaluation | Run as a GitHub App |
| `core/state.ts` | Local cache of IDs and status | Replace GitHub as the record |
| `core/scaffold.ts` | Write workflow files into a repository | Modify repository settings |

The separation matters because tests can exercise gates, policy, ticket graph
validation and evidence without GitHub or a model.

## 4. Data model

### 4.1 Requirement

A GitHub issue with the requirement label. The body records source, business
goal, scope, acceptance direction, constraints, open questions and non-goals.
External or incomplete issues can pass through optional triage, which records
related issues, code evidence and missing information before changing readiness
labels. Triage never approves a spec or ticket.

### 4.2 Spec

A GitHub issue with the spec label and `Request: #<requirement>` in its body.
The required sections are enforced by `validateSpecBody()`:

- Problem Statement
- Solution
- User Stories
- Implementation Decisions
- Testing Decisions
- Out of Scope
- Further Notes

### 4.3 Ticket

A GitHub issue with the task label, `Request: #<requirement>` and
`Spec: #<spec>` in its body. Dependencies are written as `Blocked by #<issue>`.

### 4.4 Pull request

A PR whose body contains `Request`, `Spec`, `Task`, an Evidence section and a
Merge Danger section, and whose only close reference is `Closes #<task>`.

### 4.5 Local state

`.handrail/state.json` caches active IDs and ticket status. It is a convenience,
not the source of truth:

- If it is deleted, `handrail` can recover by reading GitHub.
- It is ignored by git.
- It never records approvals as authoritative; labels do.

### 4.6 Evidence

`.handrail/evidence/evidence.jsonl` is append-only JSONL. Each record has a kind,
ticket/spec IDs, command, exit code, duration, timestamp and output tail.
`ticket-<n>.md` is a human-readable projection.

## 5. The agent loop

### 5.1 Anthropic provider

The built-in provider calls `POST /v1/messages` directly with `fetch`. It keeps a
message list and loops until the model stops requesting tools or the turn limit
is reached.

```text
system + user prompt
  |
  v
model response
  |-- text only            -> return
  `-- tool_use blocks
        |
        v
      execute tools
        |
        v
      append tool_result
        |
        `-- loop
```

Tool results are written back as a `user` message containing `tool_result`
blocks. Token usage is summed across turns. A transcript is written to
`.handrail/evidence/transcripts/`.

### 5.2 Tool set

| Mode | Tools |
|---|---|
| `none` | none |
| `read` | `read_file`, `list_files`, `search_files` |
| `write` | read tools plus `write_file`, `replace_in_file`, `run_command` |

Path handling rejects anything outside the repository, anything under `.git/`,
and any write under `.handrail/`. The framework owns config, state and evidence.

`run_command` executes through a shell in the repository root. It enforces a
deny list and an optional allow list. This is an accident-prevention control,
not a sandbox. The generated code runs with the same OS permissions as the user.

### 5.3 Command provider

The command provider writes `system + prompt` to the external command's stdin
and reads stdout. It does not provide tools; the external CLI is responsible for
its own tool loop and safety model.

### 5.4 Truncation

If the turn limit is reached, the result is marked `truncated`. Implementation
refuses to continue, because an unfinished agent run must not be treated as a
delivered ticket.

## 6. Gate enforcement

Gates are checked in workflow code before irreversible steps:

| Step | Gate |
|---|---|
| Draft tickets | Spec has `spec-approved` |
| Publish tickets | Spec has `spec-approved` and `tickets-approved` |
| Implement | Ticket has task label, spec and ticket approvals, dependencies closed |
| Create PR | Review verdict is approve, checks exist and pass |
| Accept | Every ticket closed, every linked PR merged, CI green |
| Merge | GitHub branch protection and human approval (outside Handrail) |

Approval commands add a label and comment with the approver, timestamp and a
SHA-256 of the approved body/draft. This makes the approved content auditable
even if the issue is edited later.

## 7. Policy workflow

`handrail init` writes `.github/scripts/policy.mjs`, a self-contained Node script
that runs on `pull_request` events. It uses `gh api` to read the task and spec
issues and checks:

- trace links exist and agree with each other;
- the task has the task label;
- the spec has both approval labels;
- the PR closes exactly the task, not its parents;
- the Evidence section contains real results and no placeholders;
- the Merge Danger section exists.

The policy is duplicated in `src/core/policy.ts` so it can be unit tested. The
generated script is deliberately dependency-free so it runs in any repository.

## 8. Failure handling

- External command failure raises `ExternalCommandError` with stdout/stderr.
- Missing approvals raise `GateError` with the exact command that fixes it.
- Agent output that is not valid JSON raises `AGENT_OUTPUT_NOT_JSON` with the
  first 400 characters, so prompt drift is visible.
- Ticket cycles and unknown dependencies are rejected before any issue is created.
- A review `block` verdict prevents PR creation.
- Review and configured check records are bound to a commit. PR creation rejects
  stale records after a new commit; a successful rerun replaces a previous
  failure for the same command on that commit.
- A failing check is recorded and prevents PR creation, but the branch and commit
  are kept for inspection.
- The command provider and Anthropic provider both have timeouts. An agent run
  that exceeds the turn limit is marked truncated and does not count as success.

## 9. Extension points

1. **Agent provider**: implement the `Agent` interface in `src/core/agent/`.
2. **Workflow prompts**: edit `src/prompts/*.md`; every command renders these
   files at runtime.
3. **Scaffold templates**: edit `src/templates/`; `npm run build` copies them to
   `dist/templates`.
4. **Gates**: add checks in `src/core/gates.ts` and call them from the relevant
   workflow function.
5. **Policy**: update both `src/core/policy.ts` and the generated script template
   `src/templates/github/scripts/policy.mjs`.

## 10. Testing strategy

The test suite covers the pure and filesystem-bound parts of the system:

- config validation and default merging;
- label gates and trace-link parsing;
- ticket graph validation, cycles and ordering;
- evidence recording and check gating;
- PR policy evaluation;
- scaffolding and idempotency;
- JSON extraction from model output;
- prompt loading;
- path and command safety in agent tools.

GitHub calls and real model calls are not part of the unit suite. They are
exercised through the CLI in a real repository, which is why `handrail doctor`
exists.
