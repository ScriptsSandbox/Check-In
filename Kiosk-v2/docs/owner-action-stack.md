# Owner action stack

This list is deliberately ordered so development can continue without waiting on decisions that are not yet on the critical path.

## 1. Needed before a public pilot

- Choose the visitor-facing entry point: a normal button on the Sandbox WordPress site (recommended) or the purpose-built 4:3 `/join/embed` card.
- Choose or request the public registration hostname. The current `rjatplay.chatgpt.site` address is an owner-only staging site, not the final public identity.
- Confirm that `scripps-sandbox@ucsd.edu` is an actively monitored shared mailbox. It is the proposed first-line contact for account corrections and Sandbox-specific privacy questions; the UC San Diego Campus Privacy Office remains the escalation point.
- Confirm Nathan Park's exact UC San Diego email address when Google sign-in is configured. Exact UC San Diego addresses for the other five approved people were resolved from the existing user sheet and stored only in protected staging configuration—not in Git.

## 2. Institutional access / IT items

- Register the UC San Diego Google OAuth client for the staff application and approve its redirect URL.
- Give the production service identity read access to User Database SIO, Activity Log SIO, Waiver Signatures SIO, and Sandbox Access calendar.
- Confirm whether the approved public registration host may be displayed in a WordPress iframe. This is optional if the WordPress Button block is used.
- Confirm any UC San Diego requirements for privacy language, accessibility review, data classification, incident reporting, and the provisional eight-year retention period.

## 3. Needed before production cutover

- Review a migration reconciliation report: imported people, unmatched identifiers, ambiguous waiver matches, duplicate cards, and training discrepancies.
- Approve the date for a shadow period in which the current Sheets continue operating while the new system compares results.
- Spend 10–15 minutes at the physical kiosk testing: a known card, an unlinked card plus connection code, a replacement card, manual PID/employee-ID check-in, and a brief network interruption.
- Confirm the early-closing warning and staff-message behavior with one real Sandbox Access calendar event.

## 4. Useful later, not launch blockers

- Ask the DocuSign owner whether the PowerForm can receive an approved return URL or webhook. The sheet synchronizer remains the baseline even if this is unavailable.
- Decide whether to use a UC San Diego custom domain for registration and the staff application.
- Place a QR code for `/join` on the website, kiosk, entrance signage, and staff quick-reference material.
- Decide whether tool certifications or trainer authorizations should expire; the schema already supports future expiration dates.

## Decisions already recorded

- Waiver match: exact normalized PID/employee ID first; unique exact email plus normalized name is the only automatic fallback. Partial or duplicate matches require review.
- Accounts stay pending until a waiver is confirmed.
- Staff visually inspect the physical ID before a manual card link or replacement.
- Tool certifications and trainer authorizations do not expire for now, but may later.
- Only administrators grant trainer status; trainers grant only the tool certifications they are authorized to teach.
- Eight years is the provisional retention assumption pending UC San Diego confirmation.

## Initial access roster

| Person | Initial role | Trainer authorizations |
| --- | --- | --- |
| Riley Meehan | Administrator | Laser cutter |
| Rita McBean | Staff | Laser cutter |
| Arnav Dev | Staff | Laser cutter |
| Nathan Park | Staff | Laser cutter |
| Sofia Oliveira | Staff | Laser cutter |
| Bryan Solabac | Staff | Laser cutter |

No personal passwords or UC San Diego sign-in credentials are collected by this project. Staff will sign in directly through UC San Diego Google Workspace after the application has an institutional OAuth client ID and approved redirect URI.
