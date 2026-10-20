# 0005. Tickets are vertical slices

## Status

Accepted

## Context

Splitting a requirement by technical layer (database, repository, service, API,
UI) produces tickets that cannot be demonstrated or accepted on their own. It
also creates artificial dependencies and hides integration risk until the end.

## Decision

A ticket must deliver an observable behavior. The ticket planner prompt requires
every ticket to answer "After this is done, what can a user or caller observe?"
and to include observable acceptance criteria, a test plan and a demo.

Handrail validates structure, not semantics: it rejects empty acceptance
criteria, unknown dependencies, duplicate keys and cycles. A human must still
review whether the split is behaviorally coherent.

## Consequences

- Each ticket can be accepted independently.
- Integration risk appears early.
- Fewer artificial dependencies.
- Some infrastructure work must be folded into the first behavior that needs it.
- Human review of the split remains essential; structural validation is not
  enough.
