# Scripps Sandbox check-in system — phase 1 foundation

Status: implementation staging; not connected to production check-ins

## What now exists

- A relational database schema and initial migration for accounts, identifiers, cards, waivers, visits, presence, staff permissions, trainer authorizations, tool certifications, staff messages, integration jobs, and audit history.
- A public first-visit form at `/join` that creates a pending account, produces a one-time card-connection code, and ends with the existing DocuSign PowerForm.
- A staff-application prototype at `/staff` covering current presence, staff checkout, arrival messages, user search, and tool certification.
- A kiosk card-connection screen for people who registered online or need to link a replacement card.

## Existing authoritative systems

| Purpose | Current source | Migration behavior |
| --- | --- | --- |
| User profiles and legacy training flags | User Database SIO | Read-only import during migration; compare before cutover |
| Check-in history | Activity Log SIO | Read-only import; continue current writes until cutover |
| Liability waivers | Waiver Signatures SIO | Remains authoritative; synchronize status into the new database |
| Opening hours | Sandbox Access calendar | Remains authoritative; no replacement database |
| Staff identity | UC San Diego Google Workspace | Required for the production staff application |

The current waiver sheet fields are `Name`, `Email`, `Date_Signed`, and `A_Number`. The registration form therefore asks people to use the same name, email, and UC San Diego ID number in DocuSign.

## First-visit and card-link flow

1. The visitor creates a pending account online or on their phone at the makerspace.
2. The system gives them a single-use eight-character card-connection code. Only a digest of the code is stored.
3. The visitor completes the liability waiver in the existing DocuSign PowerForm.
4. A synchronization job matches the resulting Waiver Signatures SIO row to the pending account, primarily by normalized A-number/employee ID and secondarily by normalized email and name.
5. At the makerspace, the visitor taps the physical card and enters the connection code. The code is invalidated and the card is linked.
6. For a replacement ID, the same flow retires the old card. Staff can also complete the link after visually checking the physical ID.

Raw card identifiers must not be stored in the application database. The production card-link service will store an HMAC digest and the last four characters for support display.

## Staff authorization model

- UC San Diego Google sign-in establishes staff identity.
- An application role determines whether the user may view presence, check visitors out, edit kiosk messages, manage people, or administer staff access.
- Tool-specific trainer authorization determines which certifications a staff member can grant.
- Certifications and trainer authorizations have optional expiration fields but do not expire by default.
- Every checkout, permission change, certification, revocation, card link, and staff message is written to the audit log.

## Google Drive structure

The shared `Sandbox Software` folder now contains `Scripps Sandbox Check-In System` with:

- `00 — Project Overview & Decisions`
- `01 — Kiosk Application`
- `02 — Staff Application`
- `03 — Public Account & Waiver Form`
- `04 — Data Model & Integrations`
- `05 — Operations & Support`
- `06 — Archive`

Drive is for project documentation, procedures, and approved exports—not the live account or visit database.

## Required before production cutover

- Register and approve the UC San Diego Google OAuth application for the staff portal.
- Configure the public registration hostname and its privacy notice.
- Provide service access for read-only synchronization from the three current Sheets and the Sandbox Access calendar.
- Validate waiver matching with representative student, staff, faculty, postdoc, and visitor records.
- Implement kiosk-to-database API calls, encrypted local offline queueing, retry behavior, and conflict handling.
- Shadow-write and compare the new system with the current Sheets before enabling production writes.
- Complete a retention decision for account, visit, and audit records; eight years is the current planning assumption, not yet policy.
