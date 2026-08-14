# Scripps Sandbox registration web app

This Google Apps Script web app writes new registrations into the normalized `People`, `Identifiers`, and `Registrations` tables. New accounts are usable immediately; registration `Status` starts as `Unreviewed` for after-the-fact staff review. It does not use a pending-registration tab or activation gate.

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
- The form includes a honeypot and minimum-fill-time check.
- Do not add health, birth-date, Social Security, payment, or card-UID fields.

## Setup

1. Create a standalone Apps Script project in the UCSD-managed account.
2. Add `RegistrationCore.gs`, `Code.gs`, `Index.html`, and the manifest.
3. In **Project Settings → Script properties**, add `USER_DATABASE_SPREADSHEET_ID` with the target user-database spreadsheet ID and `WAIVER_POWERFORM_URL` with the approved DocuSign PowerForm URL. Neither value belongs in source control.
4. Confirm the normalized tables include the columns asserted by `setupRegistrationSheet`, including `Registrations` → `Anticipated Graduation`, then run the function as the owner.
5. Run `registrationStatus` and confirm the returned spreadsheet and tab names.
6. Deploy as a web app that executes as the deploying UCSD account. If UCSD policy permits, allow anonymous access; otherwise stop and use the allowed domain setting rather than moving the app to a personal account.
7. Test one fictional registration first. Remove the fictional row after verification.
8. Test one authorized real registration, verify the user database row, complete DocuSign, and verify kiosk check-in.
9. Set `NEXT_PUBLIC_REGISTRATION_URL` to the deployed Apps Script web-app URL, rebuild the kiosk, and verify its QR code and link on a phone.
10. Only then replace the public website's registration link.

For a non-production permission and schema test, set `USER_DATABASE_SPREADSHEET_ID` to an approved test-copy ID, run `setupRegistrationSheet`, and submit only fictional records. Replace the property with the production ID only after the test succeeds.

## Local validation

```bash
node --test apps-script-registration/test/*.test.cjs
```
