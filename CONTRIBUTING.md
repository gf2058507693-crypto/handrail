# Contributing

Handrail is a workflow engine, not a code generator. Contributions should make
the workflow more traceable, more evidence-backed or easier to operate without
weakening a human gate.

## Before you start

- Read `docs/architecture.md` and `docs/workflow.md`.
- Read `AGENTS.md` for invariants.
- For a behavior change, open an issue with observable acceptance criteria.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

Use Node.js 20 or newer. The project is ESM TypeScript. Imports include the
`.js` extension.

## Pull requests

- Keep one behavioral change per pull request.
- Add or update tests.
- Run `npm test` and `npm run build`; paste the actual result.
- Do not claim a command passed unless you ran it.
- Do not weaken `src/core/policy.ts` or the generated policy script to make a PR
  pass. Fix the artifact instead.
- Do not add auto-merge behavior. Handrail never merges.

## Commit style

Use a conventional prefix:

```text
feat: add acceptance evidence report
fix: reject ticket dependency cycles
docs: explain the human gate model
test: cover spec approval labels
```

## Adding a workflow command

See the checklist in `AGENTS.md`. In short: add a prompt pair if needed, add the
workflow function, enforce gates before irreversible steps, record evidence,
wire a thin CLI adapter, update README and workflow docs, and add tests.

## Code style

- Prefer small pure functions and dependency injection over module mocking.
- Keep CLI handlers thin; business ordering belongs in `src/core/workflow/`.
- Put user-facing errors in `HandrailError` or `GateError` with an actionable
  hint.
- Never swallow an error that would make a failed check look successful.
