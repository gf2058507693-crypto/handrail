# AI Development Workflow

This repository uses Handrail. The workflow is intentionally human-gated.

## Standard workflow

For medium and large changes:

1. `handrail intake --prd <file>` creates a requirement issue.
2. `handrail clarify <issue>` reduces uncertainty and records decisions.
3. `handrail spec <requirement>` creates a spec issue.
4. A human runs `handrail approve spec <spec>` after reviewing the spec.
5. `handrail tickets <spec>` drafts implementation tickets.
6. A human reviews the split and runs `handrail approve tickets <spec>`.
7. `handrail publish tickets <spec>` creates the ticket issues.
8. For each ticket, in dependency order: `handrail implement <ticket>`, `handrail review <ticket>`, `handrail pr <ticket> --create`.
9. CI and an independent human approval are required before merge.
10. After all tickets merge: `handrail accept <spec>`, then `handrail retro <spec>`.

## Rules

- Keep clarification, spec and ticket drafting in one continuous context.
- Never implement from an unapproved spec or an unapproved ticket split.
- Every ticket needs observable acceptance criteria.
- Never implement directly on the protected base branch.
- Never claim a test passed unless it was actually run and recorded.
- Do not merge until required CI checks and independent review pass.
- `ready-for-agent` is not an approval label.
- Do not run triage on tickets produced by the ticket planner.
- Record material changes to approved requirements in the issue and spec.
- Keep production deployment permissions separate from coding permissions.

## Small changes

A small change that fits one context window may use the lightweight flow: branch,
implement, test, review, PR. Do not create a spec and tickets merely to satisfy process.

These instructions guide the agent. Mandatory rules are enforced by GitHub branch
protection, CODEOWNERS, CI and the AI development policy check.
