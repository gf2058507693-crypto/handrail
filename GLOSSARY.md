# Project Glossary

| Term | Definition | Notes |
|---|---|---|
| Requirement | Product-level request tracked in a requirement issue. | The PRD remains the business source. |
| Clarification | A record of confirmed decisions, assumptions, open questions and non-goals. | Not implementation. |
| Spec | Approved engineering contract for a requirement. | Must include `Request: #n`. |
| Ticket | Independently deliverable vertical slice of a spec. | Must include observable acceptance criteria. |
| Gate | A checkpoint enforced by labels, code or CI. | Not a prompt instruction. |
| Evidence | Recorded output and exit code of a command that actually ran. | Never a model claim. |
| Policy | The PR check that verifies trace links, approvals and evidence. | Runs in GitHub Actions. |
| Ready-for-agent | Input is prepared for an agent. | Not an approval label. |
| Trace chain | `REQ -> SPEC -> TASK -> PR -> CI -> RELEASE`. | Expressed in issue and PR bodies. |
| Vertical slice | A ticket that delivers a complete observable behavior. | Opposite of a layer-only task. |
| Agent provider | The runtime that executes prompts and tools. | `anthropic`, `command` or `mock`. |
| Local state | `.handrail/state.json`, a cache of active IDs and status. | GitHub is authoritative. |
