# AI Development Workflow

This repository uses Handrail. The workflow is intentionally human-gated.

## Standard workflow

For medium and large changes:

1. `handrail intake --prd <file>` creates a requirement issue.
2. Optionally run `handrail triage <issue> --apply` for external or incomplete issues; do not triage planner-generated tickets.
3. `handrail clarify <issue> --interactive --comment --write-docs` reduces uncertainty, records decisions and assumptions, and proposes domain docs.
4. `handrail spec <requirement>` creates a spec issue.
5. A human runs `handrail approve spec <spec>` after reviewing the spec.
6. `handrail tickets <spec>` drafts implementation tickets.
7. A human reviews the split and runs `handrail approve tickets <spec>`.
8. `handrail publish tickets <spec>` creates the ticket issues.
9. For each ticket, in dependency order: `handrail implement <ticket>`, `handrail review <ticket>`, `handrail pr <ticket> --create`.
10. CI and an independent human approval are required before merge.
11. After all tickets merge: `handrail accept <spec>`, then `handrail retro <spec>`.

## Rules

- Keep clarification, spec and ticket drafting in one continuous context.
- Never implement from an unapproved spec or an unapproved ticket split.
- Every ticket needs observable acceptance criteria.
- Never implement directly on the protected base branch.
- Never claim a test passed unless it was actually run and recorded.
- For complex rules and bug fixes, use Red → Green → Refactor at agreed test boundaries.
- Do not merge until required CI checks and independent review pass.
- `ready-for-agent` is not an approval label.
- Do not run triage on tickets produced by the ticket planner.
- Record material changes to approved requirements in the issue and spec.
- Keep production deployment permissions separate from coding permissions.

## Small changes

A small change that fits one context window may use a lightweight GitHub flow:
one issue, branch, implementation, proportionate tests, independent review and PR.
Handrail's full-chain commands require an approved Spec and tickets, so use the
repository's ordinary GitHub workflow for this case. Do not create a Spec and
tickets merely to satisfy process. Security, migration, production configuration
and multi-behavior changes use the full workflow.

These instructions guide the agent. Mandatory rules are enforced by GitHub branch
protection, CODEOWNERS, CI and the AI development policy check.
