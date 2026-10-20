# AGENTS.md

## Project

Handrail is a human-gated, evidence-backed AI delivery workflow for GitHub. It
turns a product requirement into a requirement issue, clarification record, spec,
tickets, reviewed branches and traceable pull requests.

Read `docs/architecture.md` before changing the workflow engine. Read
`docs/workflow.md` before changing the process.

## Commands

```bash
npm install
npm run build          # tsc + copy prompts/templates into dist
npm test               # vitest
npm run typecheck      # tsc --noEmit
npm run test:coverage
node dist/cli.js --help
```

## Structure

- `src/cli.ts`: command surface. Keep it thin.
- `src/commands/`: option parsing and context creation.
- `src/core/workflow/`: ordered workflow steps and gate checks.
- `src/core/agent/`: Anthropic loop, command provider, mock, tools.
- `src/core/`: config, GitHub, git, evidence, gates, policy, scaffold, state.
- `src/prompts/`: runtime prompt templates.
- `src/templates/`: files copied into target repositories.
- `tests/`: unit tests for pure and filesystem-bound behavior.

## Invariants

1. Handrail never merges a pull request.
2. Handrail never approves its own pull request.
3. A test result must come from a recorded command. Never turn prose into
   evidence.
4. Human gates are labels and CI, not prompt instructions.
5. GitHub is the system of record. Local state is a cache.
6. Agents may not write to `.handrail/`.
7. Tickets are vertical slices, not technical layers.
8. Every issue and PR link uses explicit `Request: #n`, `Spec: #n`,
   `Task: #n` and `Closes #n` references.
9. Do not weaken `evaluatePullRequest` or the generated policy script to make a
   PR pass. Fix the artifact instead.
10. Keep the built-in agent provider dependency-free; it uses `fetch` directly.

## Testing

- Add a unit test for every pure function or gate change.
- Prefer dependency injection over mocking modules.
- Use temporary directories for filesystem tests.
- Run `npm test` and `npm run build` before claiming completion.
- Do not report a test as passing unless it was actually executed.

## Adding a workflow command

1. Add a prompt pair in `src/prompts/` if the command calls an agent.
2. Add the workflow function in `src/core/workflow/`.
3. Add gate checks before any irreversible step.
4. Record evidence for commands that can fail.
5. Add a thin command adapter and register it in `src/cli.ts`.
6. Update `README.md`, `README.zh-CN.md` and `docs/workflow.md`.
7. Add tests.
