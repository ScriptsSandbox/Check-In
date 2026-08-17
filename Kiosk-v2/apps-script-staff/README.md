# Staff desk Apps Script

Responsive staff-only web app backed by the same normalized Google spreadsheet as the kiosk.

## Deploy

1. Create a standalone Apps Script project owned by the UCSD Sandbox account.
2. Copy `appsscript.json`, `StaffCore.gs`, `Code.gs`, and `Index.html` into it.
3. Set script property `USER_DATABASE_SPREADSHEET_ID` to the normalized database ID.
4. In the `Staff Access` tab, make the deploying account active with role `administrator`.
5. Run `setupStaffApp()` once to create `Tool Training` and `Staff Notes`.
6. Deploy as a web app executing as the deploying account, restricted to UC San Diego users.

During the DocuSign transition, optionally set `SCRIPPS_WAIVER_STATUS_URL` and `SCRIPPS_WAIVER_API_KEY` as Script Properties. The staff card-connection queue will then accept either the existing registration waiver status or a verified completion from the Scripps DocuSign Web Form. If the new service is unavailable, legacy verified waivers remain sufficient and the queue fails closed for new-only records.

The app also enforces the active `Staff Access` allowlist on every server call. Roles are `staff`, `trainer`, and `administrator`; only trainers and administrators can record laser training.

Any approved staff member can edit a member's profile from the person card. The update writes the role to `People` and the role-dependent affiliation and anticipated graduation to the latest `Registrations` row, with the staff reviewer and timestamp recorded.

Staff whose `Staff Access` row has `Card Linking Allowed` enabled (and administrators) also see **Connect cards**. It lists the newest registered, waiver-verified accounts with no active card. A second **Not ready to connect** section shows active cardless accounts that are missing registration or a verified waiver, with a staff-facing explanation of the blocker. Selecting an eligible person creates a 45-second `Kiosk Link Requests` handoff; the kiosk revalidates the request, connects the first card, records the authorizing staff account, and checks the member in. Existing-card accounts are deliberately excluded and must use the replacement-card workflow.

FabMan synchronization is deliberately not claimed by this MVP. A recorded approval displays `Not connected` until credentials and resource mapping are configured.
