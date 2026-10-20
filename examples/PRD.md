# PRD: Order batch import retry

> This is an example PRD for trying Handrail. It is intentionally small and
> contains two open questions so clarification has something to do.

## Background

Customers import orders in batches from a spreadsheet. When part of a batch
fails, the current experience forces them to fix the file and import the whole
batch again. Successful rows are re-submitted, which creates duplicate work and
support tickets.

## Goal

Let a customer inspect failed rows from an import job and retry only the rows
that are eligible for retry, without re-creating orders that already succeeded.

## In scope

- Show failed rows and the failure reason for an import job.
- Let the customer select eligible failed rows and start a retry.
- Show the result of the retry, including new failures.
- Record an audit trail for each retry attempt.

## User stories

1. As a customer, I can open an import job and see which rows failed and why.
2. As a customer, I can retry selected failed rows.
3. As a customer, I can see whether the retry succeeded, partially succeeded or
   failed again.
4. As an auditor, I can see who retried which rows and when.

## Business rules

- An order that was imported successfully must not be created again by a retry.
- A retry operates only on rows that are currently failed.
- A retry should be safe to submit twice; the second submission must not create
  duplicate orders.
- The failure reason shown to the customer must be actionable and must not leak
  internal stack traces.

## Open questions

- How many retry attempts are allowed per row?
- Which roles may retry: the importer, an administrator, or both?
- How long are the original file and failure details retained?
- Should a retry reuse the original file or the stored failed-row payload?

## Non-goals

- Redesigning the import wizard.
- Importing new file formats.
- Changing pricing or tax calculation.
- Bulk retrying every import job at once.

## Acceptance direction

- Failed rows and reasons are visible for a completed import job.
- A retry of eligible rows produces a new, auditable result.
- Successfully imported orders are never duplicated by a retry.
- Concurrent or repeated retry requests do not create duplicate orders.
- A retry that fails again shows the new failure reason.
