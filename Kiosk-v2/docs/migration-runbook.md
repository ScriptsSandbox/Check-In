# Source-data migration runbook

## Approved boundary

The reconciliation rules in the August 11, 2026 report are approved for implementation. Approval authorizes repeatable dry runs and private staging imports. It does not authorize edits to User Database SIO, Activity Log SIO, Waiver Signatures SIO, or a production cutover.

## Data handling

- Source Sheets are read-only.
- Raw snapshots are temporary inputs and must never be committed to Git, attached to a pull request, or written to application logs.
- Dry-run outputs contain counts and source row numbers only.
- Raw card identifiers exist only in memory while processing. A staging or production writer must convert them to HMAC digests before persistence and must not log the raw value.
- Every imported entity retains source spreadsheet and source row provenance.

## Repeatable dry run

1. Read exact bounded ranges from the four source tabs: user responses, internal training records, activity history, and waiver signatures.
2. Convert the ranges into the `SourceSnapshot` contract in `lib/sync/reconciliation.ts`.
3. Run the reconciliation script against an ephemeral JSON snapshot.
4. Review the aggregate manifest and row-reference issue register.
5. Delete the temporary input snapshot after verification.

The script creates no database records and performs no network requests. Its outputs are safe to retain because they contain no names, email addresses, PIDs, or card values.

## Staging import gate

Before the first private staging import:

- Provide an application HMAC secret through hosted secret storage.
- Confirm exact UC San Diego email addresses for the six approved staff/trainer accounts.
- Produce a transaction plan that can be rolled back as one unit.
- Confirm the staging database is owner-only and separate from production.
- Re-run reconciliation immediately before import and compare the manifest with the approved baseline.

## Production cutover gate

Production import requires a second explicit approval after staging verification and the physical-kiosk test. The current Sheets remain authoritative until that approval and the agreed cutover time.
