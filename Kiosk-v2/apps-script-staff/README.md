# Staff desk Apps Script

Responsive staff-only web app backed by the same normalized Google spreadsheet as the kiosk.

## Deploy

1. Create a standalone Apps Script project owned by the UCSD Sandbox account.
2. Copy `appsscript.json`, `StaffCore.gs`, `Code.gs`, and `Index.html` into it.
3. Set script property `USER_DATABASE_SPREADSHEET_ID` to the normalized database ID.
4. In the `Staff Access` tab, make the deploying account active with role `administrator`.
5. Run `setupStaffApp()` once to create `Tool Training` and `Staff Notes`.
6. Deploy as a web app executing as the deploying account, restricted to UC San Diego users.

The app also enforces the active `Staff Access` allowlist on every server call. Roles are `staff`, `trainer`, and `administrator`; only trainers and administrators can record laser training.

FabMan synchronization is deliberately not claimed by this MVP. A recorded approval displays `Not connected` until credentials and resource mapping are configured.
