# Scripps Sandbox registration web app

Production web app: `https://script.google.com/macros/s/AKfycby_JK-E1lheAvN7gr-4dVfKja00IVrZsGIRs-2GYdjho1Q6wrQBtElknehFtMcMMzUE/exec`

This Google Apps Script web app writes new registrations into the normalized `People`, `Identifiers`, and `Registrations` tables. New accounts are usable immediately; registration `Status` starts as `Submitted` and does not require staff review. It does not use a pending-registration tab or activation gate.

Each successful registration also provisions the matching member in the UCSD FabMan account, assigns the Scripps Sandbox space/package, and stores the verified member ID in `FabMan Links`. Exact existing members are reused by Sandbox person metadata, email, or UCSD ID; ambiguous matches stop instead of risking an incorrect link. `FabMan Provisioning` records each attempt, and a five-minute trigger retries temporary API failures without staff action.

The kiosk still requires a matching waiver record before check-in succeeds. After registration, the form links directly to the existing DocuSign PowerForm. A redirect proves only that the user was sent to DocuSign, not that the waiver was completed.

## Data and access safeguards

- Deploy only from a UC San Diego-managed Google Workspace account.
- Give the script only the explicit Google Sheets OAuth scope in `appsscript.json`.
- Keep the user database private to designated Sandbox staff.
- The public app accepts writes only. It never returns database rows.
- An anonymous submission cannot update an existing PID, TSN, employee ID, or email.
- Student identifiers support legacy PIDs and nine-digit Triton Student Numbers (TSNs). They remain separate identifier types so a future authorized PID-to-TSN crosswalk can attach both values to one person without discarding the PID.
- Role and SIO department/division choices follow the commonly used SIO taxonomy. Student roles require an anticipated graduation month and year, stored in `Registrations`.
- Visitors can also identify an external university or institution, a community affiliation, or another organization.
- The affiliation question branches by role: undergraduates choose a major; Scripps and non-Scripps graduate students choose an appropriate program or department; MAS students choose their program; and employees or visitors choose a unit or organization.
- Input is length-limited, normalized, and protected against spreadsheet-formula injection.
- A script lock serializes duplicate checks and appends.
- FabMan creation is duplicate-safe and retryable. A partial API success is recovered by searching the Sandbox person metadata, email, and UCSD ID before any new member is created.
- FabMan API failures do not discard an otherwise valid Sandbox registration; the automatic retry queue completes the external provisioning later.
- Kiosk mode (`?mode=kiosk`) may be embedded by the local Raspberry Pi app. The Pi retains the 45-second inactivity return, and the form adds an explicit **Done — back to check-in** control plus Escape-key navigation after account creation.
- The form includes a honeypot and minimum-fill-time check.
- Do not add health, birth-date, Social Security, payment, or card-UID fields.

## Setup

For local Clasp use, copy `.clasp.json.example` to `.clasp.json` and insert the institutional script ID from the restricted UCSD deployment inventory. The active mapping is intentionally ignored by Git. Authenticate with `clasp login`; never copy or commit `~/.clasprc.json`. See [`../docs/apps-script-recovery.md`](../docs/apps-script-recovery.md).

1. Create a standalone Apps Script project in the UCSD-managed account.
2. Add `RegistrationCore.gs`, `Code.gs`, `Index.html`, and the manifest.
3. In **Project Settings → Script properties**, add `USER_DATABASE_SPREADSHEET_ID` with the target user-database spreadsheet ID, `WAIVER_POWERFORM_URL` with the approved DocuSign PowerForm URL, and `FABMAN_API_KEY` with the same limited administrative integration key used by the Staff Desk. For the Scripps-owned waiver callback, also add a long random `DOCUSIGN_CONNECT_TOKEN` and the exact `DOCUSIGN_WAIVER_TEMPLATE_ID`. None of these values belongs in source control.
4. Confirm the normalized tables include the columns asserted by `setupRegistrationSheet`, including `Registrations` → `Anticipated Graduation`, then run the function as the owner. It creates `FabMan Provisioning` when needed and verifies `FabMan Links`.
5. Run `setupFabmanProvisioning` once as the owner. Confirm it reports `triggerCreated: true` (or an existing trigger) and that the five-minute `retryFabmanProvisioning` trigger appears under **Triggers**.
6. Run `registrationStatus` and confirm the returned spreadsheet/tab names and `fabmanConfigured: true`.
7. Deploy from the Apps Script **Deploy → Manage deployments** interface as a **Web app** that executes as the deploying UCSD account. If UCSD policy permits, allow anonymous access; otherwise stop and use the allowed domain setting rather than moving the app to a personal account. Do not use `clasp deploy` to update the production web app: it creates a library-only deployment and breaks the `/exec` address. Use `clasp push` for source, create a numbered version, then select that version on the existing web-app deployment in the Apps Script interface.
8. Test one fictional registration first. Verify one FabMan member, package `9464`, one active `FabMan Links` row, and a `Complete` provisioning row. Remove the fictional records from both systems after verification.
9. Test one authorized real registration, verify the user database and FabMan rows, complete DocuSign, and verify kiosk check-in.
10. Set `NEXT_PUBLIC_REGISTRATION_URL` to the deployed Apps Script web-app URL, rebuild the kiosk, and verify its QR code and link on a phone.
11. Only then replace the public website's registration link.

The same web-app deployment accepts completed DocuSign Connect JSON at
`WEB_APP_URL?waiver_key=DOCUSIGN_CONNECT_TOKEN`. It writes duplicate-safe rows
to the `Scripps Waivers` tab in the production spreadsheet. Restrict DocuSign
delivery to completed events for the Sandbox template and never publish the
callback URL.

For a non-production permission and schema test, set `USER_DATABASE_SPREADSHEET_ID` to an approved test-copy ID, run `setupRegistrationSheet`, and submit only fictional records. Replace the property with the production ID only after the test succeeds.

## Local validation

```bash
node --test apps-script-registration/test/*.test.cjs
```
