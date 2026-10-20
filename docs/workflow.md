# Workflow

This is the default delivery workflow Handrail implements. It is based on a
simple idea: an AI agent may do the work, but a person owns the decision.

## 1. Principles

1. The requirement issue is the product entry point; the PRD remains the
   business source.
2. The spec is the engineering contract. No implementation starts without an
   approved spec.
3. A ticket is an independently demonstrable vertical slice, not a technical
   layer.
4. Tests are evidence only when a command was executed and recorded.
5. A human approves the spec, the ticket split and the pull request.
6. `ready-for-agent` means "the input is prepared", never "approved".
7. Small changes may use a lighter flow; process must match risk.

## 2. Roles

| Role | Responsibility |
|---|---|
| Requirement owner | Business goal, rules, scope, acceptance direction |
| Technical owner | Architecture, spec approval, ticket split and dependencies |
| Implementation owner | Ticket delivery, real check evidence, commit and feedback |
| Reviewer / Code Owner | Independent review, risk judgement, required fixes |
| AI agent | Investigation, drafting, implementation, testing, evidence |
| GitHub / CI | Durable artifacts, approval records, required checks |

Handrail is the workflow engine. It does not replace any of these roles.

## 3. Artifacts

```text
PRD (source document)
  |
  +-- Requirement issue      product intent and open questions
        |
        +-- Spec issue      engineering contract, linked with Request: #n
              |
              +-- Task issues     vertical slices, linked with Spec: #n
                    |
                    +-- Pull request   one task, one PR, Closes #task
                          |
                          +-- CI result, review, human approval, merge
```

The durable chain is `REQ -> SPEC -> TASK -> PR -> CI -> RELEASE`.

## 4. Stage 0: intake

Command:

```bash
handrail intake --prd PRD.md --title "Order import retry"
```

Handrail asks the agent to turn the PRD into a requirement issue without
inventing rules. Ambiguity goes into "Open questions". The issue gets the
requirement and needs-triage labels.

Human check:

- The source document and version are correct.
- The business goal and acceptance direction are clear.
- Unknown rules are explicitly marked as open questions.
- Owners and priority are filled in according to team convention.

## 5. Stage 1: clarification

Command:

```bash
handrail clarify --interactive --comment
```

The agent reads the issue, repository docs, glossary, ADRs and relevant files.
It asks one material question at a time and records the answer. It separates:

- confirmed decisions;
- implementation assumptions;
- open questions;
- non-goals;
- glossary terms;
- ADR candidates.

The result is written to `.handrail/drafts/clarify-<issue>.md` and optionally
posted to the issue.

Passing criteria:

- Material business rules and boundaries are confirmed.
- Open questions are not presented as requirements.
- Domain terms and important architecture decisions are recorded.
- The requirement owner confirms the summary.

## 6. Stage 2: spec

Commands:

```bash
handrail spec
handrail approve spec <spec>
```

The spec must include Problem Statement, Solution, User Stories,
Implementation Decisions, Testing Decisions, Out of Scope and Further Notes.
It must link `Request: #<requirement>`.

The approval command adds `spec-approved` and comments with the approver,
timestamp and a SHA-256 of the spec body. The hash is an audit aid: if the body
changes later, the approved content can still be identified.

Human check:

- The spec matches the requirement and the confirmed decisions.
- No unconfirmed assumption became a requirement.
- Test boundaries are observable.
- Non-goals and compatibility constraints are explicit.
- The technical owner agrees with the implementation decisions.

## 7. Stage 3: tickets

Commands:

```bash
handrail tickets <spec>
handrail approve tickets <spec>
handrail publish tickets <spec>
```

The ticket planner returns JSON. Handrail validates:

- at least one ticket and no more than `workflow.maxTicketsPerSpec`;
- unique keys;
- every ticket has observable acceptance criteria;
- every dependency exists;
- no cycles;
- dependency order is computable.

A ticket is a vertical slice. It must answer: "After this is done, what can a
user or caller observe?" It must not be "add the database table" or "write the
service layer" on its own.

Human check:

- Every ticket has independent tracking value.
- Acceptance criteria are observable and testable.
- Blocked-by edges are real, not decorative.
- Parallel work was not serialized without reason.
- The split is not inflated to look thorough.

## 8. Stage 4: implementation

Command:

```bash
handrail implement <ticket>
```

Handrail:

1. Checks the task label, spec approval, ticket approval and dependencies.
2. Refuses to start with a dirty working tree.
3. Creates `feat/issue-<ticket>` from the base branch.
4. Runs the agent with the ticket, spec, requirement, AGENTS.md, glossary, ADRs
   and current diff.
5. Commits the result.
6. Runs every configured check and records the command, exit code, duration and
   output tail.
7. Runs an independent review unless `--skip-review` is explicit.
8. Stops if a check fails or the review blocks. The branch is kept.

The agent is told not to create a PR, merge, close issues, edit `.handrail/`, or
change acceptance criteria to make a test pass.

## 9. Stage 5: review

Command:

```bash
handrail review <ticket>
```

The review compares the branch to the base branch and produces JSON:

```json
{
  "verdict": "approve",
  "summary": "one paragraph",
  "findings": [],
  "spec_coverage": [
    { "requirement": "...", "status": "met", "evidence": "..." }
  ]
}
```

Two dimensions are reported separately:

- **Standards**: conventions, module boundaries, error handling, tests,
  security, unnecessary complexity.
- **Spec**: whether the approved spec and ticket are implemented, and whether
  scope expanded or a behavior is missing.

A `block` verdict prevents PR creation.

## 10. Stage 6: pull request and merge

Commands:

```bash
handrail pr <ticket> --create
```

Handrail:

1. Re-checks the review record and check evidence.
2. Pushes the branch.
3. Generates a PR body with trace links, summary, behavior changes, real
   evidence, diff stat, merge danger and a reviewer checklist.
4. Creates or updates the PR. By default the PR is a draft; `--ready` creates a
   ready-for-review PR.

The PR body must contain:

```markdown
## Spec / Tasks
- Request: #100
- Spec: #101
- Task: #102

## Summary
## Evidence
## Merge Danger
## Reviewer Checklist

Closes #102
```

A human reviews and merges. Branch protection must require:

- pull request before merge;
- independent approval;
- the `CI` check;
- the `AI development policy` check.

Handrail never merges. It also does not approve its own PR.

## 11. Stage 7: acceptance and retrospective

Commands:

```bash
handrail accept <spec> --close
handrail retro <spec>
```

Acceptance first verifies the facts:

- every ticket is closed;
- every linked PR is merged, not merely closed;
- every PR has green CI unless `--allow-no-ci` is explicit.

Then the agent compares the merged result with the spec and requirement and
returns `pass` or `fail` with evidence and gaps. `--close` closes the spec and
requirement only after a passing verdict.

The retrospective is based on issues, PRs, evidence records and state history.
It classifies improvements into CI, documentation, agent guidance and team
process.

## 12. Labels

Default labels:

| Label | Meaning |
|---|---|
| `requirement` | Product requirement issue |
| `spec` | Engineering spec issue |
| `task` | Independently deliverable implementation ticket |
| `needs-triage` | Waiting for triage |
| `needs-info` | Waiting for more information |
| `spec-review` | Spec waiting for human approval |
| `spec-approved` | Spec approved by a human |
| `tickets-approved` | Ticket split approved by a human |
| `needs-ticket-review` | Ticket split waiting for review |
| `ready-for-agent` | Input prepared for an agent, not an approval |
| `ready-for-human` | Needs a human decision |
| `blocked` | Blocked by another ticket |
| `wontfix` | Decided not to fix |

Teams may map these to existing labels in `.handrail/config.json`. The semantic
separation matters more than the names.

## 13. Small changes

A bug fix or a small change that fits one context window may use:

```bash
git switch -c fix/issue-123
handrail implement 123 --skip-review
handrail pr 123 --create
```

Do not create a spec and tickets merely to satisfy process. Do not use the
lightweight flow for a change that touches multiple behaviors, data migration,
security or production configuration.

## 14. Anti-patterns

- Treating an agent's completion message as delivery.
- Writing "tests pass" without a recorded command.
- Approving a spec by editing the issue instead of adding the approval label.
- Using `ready-for-agent` as a merge approval.
- Creating one ticket per technical layer.
- Serializing tickets that have no real dependency.
- Letting the implementation agent approve its own change.
- Merging with failing or missing CI because "it is a small change".
- Closing the parent requirement before final acceptance.

## 15. Rollout

1. Run one real medium-sized requirement through the full flow.
2. Verify every artifact is traceable to the next stage.
3. Turn stable manual checks into CI checks.
4. Add CODEOWNERS for critical directories.
5. Compare cycle time, rework, CI first-pass rate and review findings before and
   after the pilot.
6. Do not measure success by lines of generated code.
