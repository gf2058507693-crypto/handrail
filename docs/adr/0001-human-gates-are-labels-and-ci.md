# 0001. Human gates are labels and CI, not prompts

## Status

Accepted

## Context

An agent can be instructed to "wait for human approval", but a prompt is not an
enforcement mechanism. If the agent ignores the instruction, nothing stops it.
The workflow needs gates that are visible, auditable and independent of the
model.

## Decision

Represent approvals as GitHub labels and comments:

- `spec-approved` on the spec issue;
- `tickets-approved` on the spec issue;
- review verdict in a recorded JSON file;
- merge approval and branch protection in GitHub.

Handrail checks these before drafting tickets, publishing tickets, implementing,
and creating a PR. The approval command records the approver, timestamp and a
SHA-256 of the approved content.

Prompts explain the workflow; they do not enforce it.

## Consequences

- Approvals survive process restarts and are visible to the whole team.
- A missing approval produces a clear, actionable error.
- Label hygiene becomes part of operations.
- A team may map label names to its existing conventions.
- The model cannot silently skip a gate.

`ready-for-agent` is intentionally separate from approval labels. It describes
input readiness, not human consent.
