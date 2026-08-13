# PID-to-TSN crosswalk

## Identity rule

A person has one stable `Person ID`. PID and TSN are verified aliases in the
`Identifiers` table. Adding a TSN must never create, rename, or merge a person.

For a continuing student the rows look like:

| Person ID | Type | Normalized Value | Primary | Verified | Active |
| --- | --- | --- | --- | --- | --- |
| `person_…` | PID | `A12345678` | TRUE | TRUE | TRUE |
| `person_…` | TSN | `200010746` | FALSE | TRUE | TRUE |

New students who only have a TSN may use TSN as their primary identifier.

## Controlled import

1. Obtain an authoritative crosswalk with `Person ID`, PID, TSN, source,
   verifier, and verification timestamp. Do not infer a mapping from name alone.
2. Run the no-write planner in `lib/sync/identifier-crosswalk.ts`.
3. Stop the entire batch if a PID or TSN is already active on another person,
   a row is incomplete, or the existing database already contains conflicting
   ownership.
4. Have a second staff member review counts and conflicts.
5. Append only missing aliases to `Identifiers`; never replace a `Person ID`.
6. Verify that PID and TSN both resolve to the same person at the kiosk and that
   waiver lookup succeeds through either alias.
7. Retain the source and verification provenance. Rollback deactivates only the
   newly appended alias rows; it does not delete people, visits, cards, or PIDs.

## Registration duplicate prevention

Before creating an account, registration must resolve the submitted PID or TSN
against every active alias. A unique match returns the existing-account flow.
No match may create a new person. Multiple matches are a blocker for staff
review. Email remains a second duplicate signal, not authority to merge two
people.

## Migration safety lesson

Legacy rows sharing an identifier are not automatically the same person. When
both normalized name and email differ, quarantine the collision for review.
The Caitlyn Webster / Natalie Levy collision is the reference case for this
guardrail.
