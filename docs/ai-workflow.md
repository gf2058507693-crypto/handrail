# AI-native delivery workflow

> Project: handrail
> Base branch: main

This document describes the default workflow scaffolded by Handrail. It is a
starting point, not a substitute for team policy.

## Workflow

```text
Product input
  -> requirement issue
  -> clarification record
  -> spec issue              [gate: spec-approved]
  -> ticket draft
  -> published tickets       [gate: tickets-approved]
  -> implementation          [gate: checks recorded]
  -> independent review      [gate: review approved]
  -> pull request            [gate: policy + CI]
  -> human approval + merge
  -> final acceptance        [gate: all tickets merged]
  -> retrospective
```

## Traceability chain

`REQ -> SPEC -> TASK -> PR -> CI -> RELEASE`

- The requirement issue is the product source.
- The spec is the engineering contract.
- A ticket is the execution unit.
- The PR closes exactly one ticket.
- CI stores the actual build and test result.
- The release record stores the version and rollback information.

## Gates

| Gate | Required condition | Responsible |
|---|---|---|
| Spec approved | `spec-approved` label on the spec issue | Requirement owner + technical owner |
| Tickets approved | `tickets-approved` label on the spec issue | Technical owner |
| Checks recorded | At least one check command exited 0 | Implementation owner |
| Review approved | Independent review has no blocker | Reviewer / Code Owner |
| Merge ready | Policy check and required CI pass, human approval present | GitHub rules + CI |
| Acceptance | Every ticket merged and the spec verified | Requirement owner + technical owner |

## Labels

The labels are configured in `.handrail/config.json` and can be mapped to existing
team labels. The important distinction is between "ready for an agent" and
"approved by a human"; they must never be the same label.

## Evidence

Handrail records every command it runs under `.handrail/evidence/`. PR descriptions
are built from those records. A command that was not executed cannot appear as a
passing check.
