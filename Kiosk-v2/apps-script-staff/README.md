# Staff desk Apps Script

Responsive staff-only web app backed by the same normalized Google spreadsheet as the kiosk.

Production web app: `https://script.google.com/macros/s/AKfycbyZOztABpgj5kVB9Aj8CD2G6N6bWUrXXA-a-7ql7ETlAEoCP8K2uUCfTt45wiGCaY2Y/exec`

## Deploy

For local Clasp use, copy `.clasp.json.example` to `.clasp.json` and insert the institutional script ID from the restricted UCSD deployment inventory. The active mapping is intentionally ignored by Git. Authenticate with `clasp login`; never copy or commit `~/.clasprc.json`. See [`../docs/apps-script-recovery.md`](../docs/apps-script-recovery.md).

1. Create a standalone Apps Script project owned by the UCSD Sandbox account.
2. Copy `appsscript.json`, `StaffCore.gs`, `Code.gs`, and `Index.html` into it.
3. Set script property `USER_DATABASE_SPREADSHEET_ID` to the normalized database ID.
4. The Staff Desk accepts an exact ID or email match from the existing `Waiver Signatures SIO` spreadsheet as well as completed records in the production `Scripps Waivers` tab.
5. In the `Staff Access` tab, make the deploying account active with role `administrator`.
6. Run `setupStaffApp()` once to create the operational tabs, including the formula-backed `Current Presence` feed.
7. Run `setupAuditDashboard()` once as the institutional owner to create and protect `Visit Snapshots` and `Audit Dashboard`, backfill existing visit events, and install the five-minute snapshot trigger. Historical backfill rows use the latest profile information available at setup; new events preserve the profile and registration state at capture time.
8. Deploy from the Apps Script **Deploy → Manage deployments** interface as a **Web app** executing as the deploying account, restricted to UC San Diego users. Do not use `clasp deploy` to update the production web app: it creates a library-only deployment and breaks the `/exec` address. Use `clasp push` for source, create a numbered version, then select that version on the existing web-app deployment in the Apps Script interface.

## Presence performance

The live dashboard reads the small `Current Presence` tab every six seconds. That tab contains only today's visit events and is derived from `Visits`; the server still computes the authoritative current/left state so checkouts and reopens retain their normal behavior. The larger account, waiver, training, identifier, and FabMan index loads separately in the background and is cached for ten minutes. Profile, training, and FabMan changes invalidate that background index immediately.

The browser keeps a short-lived optimistic presence override after **Mark left** or **Undo**. This prevents a person from briefly reappearing while Google Sheets recalculates the formula-backed feed.

## Audit snapshots

`Visits` remains the authoritative append-only event log. Every five minutes, the owner-run trigger copies new events into the protected `Visit Snapshots` tab together with the member name, role, program or department, registration and waiver state, source, flags, capture time, and original visit row. Snapshot IDs are deterministic by source row and visit ID, so rerunning setup or a delayed trigger does not duplicate captured events.

The protected `Audit Dashboard` is a rolling 30-day, formula-driven view of visits, unique visitors, manual check-ins, active days, missing-role records, duplicate visit IDs, snapshot lag, visits by day, and visits by role. Staff can view it but only the institutional script owner can edit the dashboard or snapshot table. The dashboard's initial-backfill note documents the historical-data limitation.

During the DocuSign transition, the staff card-connection queue accepts either the existing registration waiver status or a completed record in the production spreadsheet's `Scripps Waivers` tab. `setupStaffApp()` creates that tab when needed. No external waiver-status service or additional Staff Desk secret is required.

The app also enforces the active `Staff Access` allowlist on every server call. Roles are `staff`, `trainer`, and `administrator`; only trainers and administrators can record laser training.

Online registration is self-service and does not require staff approval. The dashboard treats legacy `Unreviewed` rows as valid submissions and checks the actual waiver records before showing a waiver warning; only explicit incomplete registrations or genuinely unmatched waivers are flagged.

Any approved staff member can edit a member's profile from the person card. The update writes the role to `People` and the role-dependent affiliation and anticipated graduation to the latest `Registrations` row, with the staff reviewer and timestamp recorded.

Staff whose `Staff Access` row has `Card Linking Allowed` enabled (and administrators) also see **Connect cards**. It lists the newest registered, waiver-verified accounts with no active card. A second **Not ready to connect** section shows active cardless accounts that are missing registration or a verified waiver, with a staff-facing explanation of the blocker. Selecting an eligible person creates a 45-second `Kiosk Link Requests` handoff; the kiosk revalidates the request, connects the first card, records the authorizing staff account, and checks the member in. Existing-card accounts are deliberately excluded and must use the replacement-card workflow.

The **Tasks** tab is a lightweight internal board with `To do`, `In progress`, `Review / test`, and `Done` columns. Any approved staff member can add, claim, release, review, finish, or reopen a task. Administrators also see **More → Paste task list**, which previews up to 40 lines in the format `Task | Time | Suggested person | Priority` before saving them. Normal priority is intentionally unlabelled on the board; only high-priority work receives a tag.

New registrations are provisioned and linked in FabMan automatically by the registration service. Staff Desk reads `FabMan Provisioning` so temporary failures appear as automatic setup pending/retrying rather than asking staff to create a member. The manual **Find FabMan member** path remains only for legacy accounts that predate automatic provisioning. Once a member is linked, recorded laser approvals synchronize to FabMan; physical key assignment remains separate.
