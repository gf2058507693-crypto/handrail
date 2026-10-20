# 0001. Record architecture decisions

## Status

Accepted

## Context

Important technical and process decisions are easy to lose in chat history. New
contributors and agents need to understand why the current design exists.

## Decision

Record decisions that are important, hard to reverse, or likely to be questioned
later as short ADRs in `docs/adr/`. Use the Nygard format: Status, Context, Decision,
Consequences.

Do not record routine implementation details. Do not rewrite an accepted ADR when it
is superseded; mark it as superseded and write a new one.

## Consequences

- Decisions have a durable, reviewable home.
- Agents can read the decision record before changing an area.
- The team must keep the index or filenames discoverable.
