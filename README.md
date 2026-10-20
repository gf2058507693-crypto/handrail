# Handrail

**Human-gated, evidence-backed AI delivery on GitHub.**

Handrail is a command-line workflow engine for teams that want AI agents to do
real software delivery without giving up human judgement, traceability or test
evidence.

It turns a product requirement into a requirement issue, a clarification record,
an approved spec, a set of vertical-slice tickets, reviewed branches and
traceable pull requests. It automates the mechanical work and stops at every
gate that needs a person.

```text
PRD
 -> requirement issue
 -> clarification record
 -> spec issue                 [gate: spec-approved]
 -> ticket draft
 -> published tickets          [gate: tickets-approved]
 -> implementation             [gate: checks recorded]
 -> independent review         [gate: review approved]
 -> pull request               [gate: policy + CI]
 -> human approval + merge
 -> final acceptance           [gate: all tickets merged]
 -> retrospective
```

Handrail never merges a pull request, never bypasses branch protection, and never
turns an unexecuted test into a passing check.

---

## Why Handrail exists

AI coding agents are good at producing code. They are not automatically good at
delivering software:

| Failure mode | What Handrail does |
|---|---|
| Requirements live only in chat | Publishes a requirement issue with a source and explicit open questions |
| The agent invents business rules | Separates confirmed decisions, assumptions and open questions before a spec exists |
| One huge change is impossible to verify | Splits work into independently demonstrable tickets with real dependencies |
| "Done" means the agent said so | Records the actual commands and exit codes, and builds PR evidence from them |
| Review standards drift | Uses one review prompt with explicit Standards and Spec dimensions |
| Issues, PRs and tests are disconnected | Maintains `REQ -> SPEC -> TASK -> PR -> CI` traceability and checks it in CI |
| Process exists only in prompts | Enforces gates with GitHub labels, branch protection and a policy workflow |

The design is intentionally the opposite of a fully autonomous "give it a PRD and
walk away" harness. The boring parts are automated; the accountable parts stay
with people.

---

## What is in the box

- A CLI (`handrail`) with commands for intake, clarification, spec, tickets,
  implementation, review, pull request, acceptance and retrospective.
- A scaffolder (`handrail init`) that adds issue forms, a PR template,
  CODEOWNERS, CI, a policy workflow, `AGENTS.md`, `GLOSSARY.md` and ADR
  scaffolding to a repository.
- A pluggable agent runtime:
  - `anthropic`: a built-in Messages API loop with read/write/shell tools.
  - `command`: an external agent CLI such as Claude Code or Codex, driven
    through stdin.
  - `mock`: a deterministic provider for tests and demos.
- An evidence store that records every command, exit code, duration and output
  tail under `.handrail/evidence/`.
- A policy check that fails a PR when trace links, approvals or real evidence
  are missing.

---

## Requirements

- Node.js 20 or newer
- Git
- GitHub CLI (`gh`) authenticated for commands that touch GitHub
- An Anthropic API key, or an external agent command, for the agent steps

---

## Install

From source:

```bash
git clone https://github.com/gf2058507693-crypto/handrail.git
cd handrail
npm install
npm run build
npm link
```

After `npm link`, the `handrail` command is available globally.

---

## Quick start

### 1. Scaffold a repository

```bash
cd your-repo
handrail init
```

This detects your build/test commands and writes:

```text
.handrail/config.json
AGENTS.md
GLOSSARY.md
docs/adr/0001-record-architecture-decisions.md
docs/ai-workflow.md
.github/ISSUE_TEMPLATE/feature.yml
.github/ISSUE_TEMPLATE/bug.yml
.github/PULL_REQUEST_TEMPLATE.md
.github/CODEOWNERS
.github/scripts/policy.mjs
.github/workflows/ci.yml
.github/workflows/ai-dev-policy.yml
```

Create the workflow labels and check the environment:

```bash
handrail init --github
handrail doctor
```

Configure branch protection or rulesets so that `main` requires a pull request,
an independent approval, and the `CI` / `AI development policy` checks. Handrail
prints the reminder; it does not silently change repository settings.

### 2. Configure the agent

Built-in Anthropic provider:

```bash
export ANTHROPIC_API_KEY="..."
```

Or use an external agent CLI:

```json
{
  "agent": {
    "provider": "command",
    "command": ["claude", "-p"]
  }
}
```

The prompt is written to the command's stdin. Any agent CLI that reads a prompt
from stdin and writes its answer to stdout can be used.

### 3. Run the workflow

```bash
# 1. Requirement issue from a PRD
handrail intake --prd PRD.md --title "Order import retry"

# 2. Clarify. Interactive mode asks one question at a time.
handrail clarify --interactive --comment

# 3. Draft a spec, then approve it as a human
handrail spec
handrail approve spec 101

# 4. Draft tickets, review the split, approve, publish
handrail tickets 101
handrail approve tickets 101
handrail publish tickets 101

# 5. Implement one ticket at a time
handrail implement 102
handrail review 102
handrail pr 102 --create

# 6. A human reviews CI and merges the PR. Handrail stops here.
```

After all tickets are merged:

```bash
handrail accept 101 --close
handrail retro 101
```

Or let Handrail walk the dependency order and stop at each human merge gate:

```bash
handrail run 101
```

---

## Commands

| Command | Purpose |
|---|---|
| `handrail init [dir]` | Scaffold workflow files, detect checks, optionally create labels |
| `handrail doctor` | Check Node, config, git, `gh`, auth, labels, checks and agent credentials |
| `handrail intake --prd <file>` | Create a requirement issue |
| `handrail clarify [issue]` | Record decisions, open questions, non-goals, glossary terms and ADR candidates |
| `handrail spec [requirement]` | Create a spec issue linked to the requirement |
| `handrail approve spec <issue>` | Add `spec-approved` and record the approver and body hash |
| `handrail tickets [spec]` | Draft vertical-slice tickets and check the dependency graph |
| `handrail approve tickets <spec>` | Add `tickets-approved` and record the draft hash |
| `handrail publish tickets <spec>` | Create the ticket issues |
| `handrail implement <ticket>` | Create a branch, run the agent, run checks, commit, review |
| `handrail review <ticket>` | Independent Standards + Spec review against the base branch |
| `handrail pr <ticket> --create` | Push the branch and create a traceable PR |
| `handrail status [spec]` | Show the chain and gate status |
| `handrail trace [requirement]` | Print `REQ -> SPEC -> TASK -> PR` |
| `handrail accept [spec]` | Verify every ticket merged and every PR CI green, then run final acceptance |
| `handrail retro [spec]` | Produce a retrospective from actual evidence |
| `handrail run [spec]` | Implement open tickets in dependency order, stopping at merge gates |

Global options: `-C, --cwd <dir>`, `-v, --verbose`, `--json`.

---

## Gates

Handrail enforces these gates in code, on GitHub, or both.

| Gate | Enforced by | What it prevents |
|---|---|---|
| Spec ready | `spec-approved` label, checked before tickets and implementation | Implementing an unreviewed contract |
| Tickets ready | `tickets-approved` label, checked before publishing and implementation | Starting work from an unreviewed split |
| Checks recorded | Evidence store, checked before PR creation | Claiming tests passed without executing them |
| Review approved | Review JSON, checked before PR creation | Skipping independent review |
| Merge ready | GitHub branch protection, CI and CODEOWNERS | Self-approval, failing CI, direct pushes |
| Acceptance | All tickets closed, all linked PRs merged, CI green | Closing a parent issue with unfinished work |

`ready-for-agent` is deliberately not an approval label. It only says the input
is prepared for an agent.

---

## Evidence, not claims

Every configured check and every shell command the agent runs is recorded:

```json
{
  "kind": "check",
  "ticket": 102,
  "command": "npm test",
  "exitCode": 0,
  "durationMs": 8123,
  "timestamp": "2026-10-20T09:00:00.000Z",
  "stdoutTail": "..."
}
```

PR descriptions are generated from these records. If no check was executed, the
PR says so and the policy check fails. There is no code path that turns an
agent's sentence into a passing test result.

Evidence lives under `.handrail/evidence/` and is ignored by git. The durable
record is the PR conversation, CI result and merge commit.

---

## Repository layout

```text
src/
├── cli.ts                 CLI surface
├── commands/              Thin command adapters
├── core/
│   ├── agent/             Anthropic loop, external command, mock, tools
│   ├── workflow/          intake, clarify, spec, tickets, implement, review, pr, accept
│   ├── config.ts          Config schema and validation
│   ├── github.ts          gh CLI wrapper
│   ├── git.ts             git wrapper
│   ├── evidence.ts        Execution evidence store
│   ├── gates.ts           Human-gate checks
│   ├── policy.ts          PR policy logic
│   ├── scaffold.ts        Repository scaffolding
│   └── state.ts           Local workflow state
├── prompts/               Workflow prompt templates
└── templates/             Files copied into target repositories
```

---

## Design decisions

- [0001 Human gates are labels and CI, not prompts](docs/adr/0001-human-gates-are-labels-and-ci.md)
- [0002 Evidence comes from execution](docs/adr/0002-evidence-comes-from-execution.md)
- [0003 GitHub is the system of record](docs/adr/0003-github-is-the-system-of-record.md)
- [0004 The agent runtime is pluggable](docs/adr/0004-agent-runtime-is-pluggable.md)
- [0005 Tickets are vertical slices](docs/adr/0005-tickets-are-vertical-slices.md)
- [0006 Handrail never merges](docs/adr/0006-handrail-never-merges.md)

---

## What Handrail does not do

- It does not merge pull requests.
- It does not weaken branch protection or approve its own PRs.
- It does not replace CI. It requires CI.
- It does not store API keys in the repository. Keys come from environment
  variables; provider configuration never writes them to git.
- It does not claim a test passed unless a command was executed and recorded.
- It does not treat `ready-for-agent` as approval.

---

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run test:coverage
```

The test suite covers config validation, gates, ticket graph validation,
evidence, policy, scaffolding, JSON extraction, prompt loading and agent tool
safety.

---

## License

MIT
