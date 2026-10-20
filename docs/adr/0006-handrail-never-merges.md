# 0006. Handrail never merges

## Status

Accepted

## Context

An automation framework could merge a PR after CI passes, reducing manual work.
It would also become a privileged actor that can bypass the very gates the
workflow is trying to preserve. A model failure or a misconfigured policy could
put unreviewed code on the base branch.

## Decision

Handrail never merges and never approves its own pull request. It creates the
PR, reports CI status and stops. A human with the appropriate repository
permission performs the merge under branch protection.

There is no `--auto-merge` flag. `handrail run --watch` waits for a human to
merge; it does not merge for them.

## Consequences

- The final accountability remains with a person.
- The framework cannot be used as a self-approving deployment bot.
- Throughput is limited by human review, which is intentional.
- Teams that want automated merges can build a separate, explicitly authorized
  system with stricter controls; Handrail will not hide that decision.
