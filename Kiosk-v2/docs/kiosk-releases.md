# Kiosk release history

The revision shown in the kiosk's **Staff** panel comes from
`lib/kiosk-release.ts`. Update that file and add a row here for every kiosk
deployment that changes the interface or check-in behavior.

Revision format: `YYYY.MM.DD.N`, where `N` starts at `1` and increases when
more than one revision is released on the same day.

| Revision | Date | What changed |
| --- | --- | --- |
| 2026.08.21.1 | August 21, 2026 | The `Sandbox Access` calendar now automatically drives open, closing-soon, and closed kiosk states. Reservations and explicit closures override open blocks, adjacent open blocks are treated continuously, stale status is visible to staff, and the existing closing-time control remains available as a same-day manual override. |
| 2026.08.19.3 | August 19, 2026 | Card connections now insert a distinct card-history row and verify that exact record by reading it back before the kiosk can report success. Staff Desk and kiosk instructions now require the explicit CARD CONNECTED result before moving to the next person, with clear retry language on failure. |
| 2026.08.19.2 | August 19, 2026 | Phase 2 records each accepted visit to a durable SQLite outbox before confirmation, synchronizes queued rows to Google Sheets in the background with retry and Visit ID deduplication, exposes queue health in Staff controls, and keeps kiosk-created registrations inside the kiosk shell with an explicit return control and the normal 45-second inactivity reset. |
| 2026.08.19.1 | August 19, 2026 | Phase 1 performance work keeps expired account, waiver, and visit snapshots usable while Google refreshes in the background; card-link status is polled once by the bridge instead of once per browser request; every accepted card now receives a visible result; and the confirmation screen resets after three seconds for faster lines. |
| 2026.08.17.2 | August 17, 2026 | The Scripps-owned waiver transition now stays in UC San Diego Google services: DocuSign completion events write to the protected production spreadsheet, and both Staff Desk and kiosk read that tab directly. |
| 2026.08.17.1 | August 17, 2026 | Existing legacy waivers remain sufficient while completed waivers from the new Scripps-owned DocuSign form are accepted as a second source. New-source failures cannot invalidate a legacy match. |
| 2026.08.14.12 | August 14, 2026 | Staff can open a newest-first queue of registered, waiver-verified members without active cards, select a member, and have the kiosk prompt that person by name to tap. The first card is connected and the visit is checked in together, with expiry, cancellation, revalidation, and an audit trail. |
| 2026.08.14.11 | August 14, 2026 | Graduate students now choose one concise graduate-program answer. Applied Ocean Science records SIO, ECE, or MAE in that answer, and common interdisciplinary programs are represented without adding another screen. |
| 2026.08.14.10 | August 14, 2026 | Master's and doctoral students are recorded as separate roles; the profile grid no longer shows a dark empty cell; staff can edit a member's role, affiliation, and graduation details from the Staff Desk. |
| 2026.08.14.9 | August 14, 2026 | Profile dialogs are smaller, previous-question navigation consistently says Back, and UG Student Employee is consolidated into Undergraduate Student (UG) on the kiosk and registration form. |
| 2026.08.14.8 | August 14, 2026 | Visitor pages remain quiet for 30 seconds, then show the return notice and countdown only during the final 15 seconds of the 45-second timeout. |
| 2026.08.14.7 | August 14, 2026 | Closing-soon and closed check-ins repeat the prominent status rectangle; profile questions can go back to correct earlier answers; an intentional restart can resume profile questions without recording another visit. |
| 2026.08.14.6 | August 14, 2026 | The inactivity notice uses one strict 30-second countdown, only “Stay here” restarts it, and the progress ring and number are centered correctly. |
| 2026.08.14.5 | August 14, 2026 | Waiver screens explain the processing delay; unattended visitor screens return home after 30 seconds; closing-soon and closed check-ins use unmistakable full-screen treatments; closing times expire at midnight. |
| 2026.08.14.4 | August 14, 2026 | Card replacement now adds the card-history timestamp column when upgrading an older Cards sheet and preserves the sheet's existing column order. |
| 2026.08.14.3 | August 14, 2026 | Linking a new card now disables the account's previous active card(s), records the replacement, and leaves only the new card active. |
| 2026.08.14.2 | August 14, 2026 | Existing accounts can receive additional active cards without disabling their earlier cards; cards still cannot be shared between accounts. |
| 2026.08.14.1 | August 14, 2026 | Profile questions now appear before the orange confirmation; profile prompts use a high-contrast card and improved field spacing; the Staff panel shows the active revision. |
