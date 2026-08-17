# Scripps DocuSign waiver transition

## Acceptance policy

The transition is additive. A completed waiver from either source is sufficient:

1. the existing `Waiver Signatures SIO` Google Sheet; or
2. the `Scripps Waivers` tab in `Scripps Sandbox Database v2 — Production`.

Legacy completions remain valid indefinitely. The Scripps integration never
writes to or invalidates the old sheet.

## Google-only data flow

DocuSign Connect sends completed-envelope JSON to the UC San Diego-owned
registration Apps Script web app. The handler validates an unguessable callback
token and, when configured, the exact DocuSign template ID. It records only the
minimum matching data in the production spreadsheet: receipt time, envelope ID,
status, completion time, participant name and email, optional UC San Diego ID,
normalized ID, template ID, and source.

Duplicate Connect deliveries are safe: envelope ID is unique and a repeated
event does not add a second row. The kiosk and Staff Desk read the protected
Google Sheet directly; they do not call a separate public status service.

## Required configuration

- Registration Apps Script property: `DOCUSIGN_CONNECT_TOKEN`
- Registration Apps Script property: `DOCUSIGN_WAIVER_TEMPLATE_ID`
- Production spreadsheet tab: `Scripps Waivers`
- Optional Pi setting: `SCRIPPS_WAIVER_TAB_NAME=Scripps Waivers`
- DocuSign Connect destination:
  `REGISTRATION_WEB_APP_URL?waiver_key=DOCUSIGN_CONNECT_TOKEN`

Do not place the callback URL or token in source control, staff documentation,
QR codes, or public pages.

Google Apps Script exposes query parameters and POST bodies to `doPost`, but it
does not expose arbitrary request headers. Therefore this design uses a strong
callback token plus template filtering rather than DocuSign's HMAC header. If
UC San Diego requires HMAC verification for this workflow, use a UCSD-owned
Google Cloud Function or Cloud Run receiver instead; the Sheet schema and kiosk
lookups do not need to change.

## DocuSign administrator request

Ask the DocuSign administrator to send completed-envelope JSON for the Sandbox
Web Form/template to the private callback URL we provide, including recipient
and form-field data. Scope the configuration to the Sandbox template or form
when possible.

## Acceptance test

Verify all three cases before changing the public waiver link:

1. A legacy-only signer checks in successfully.
2. A new Scripps-form signer checks in successfully after a completed event
   creates one row in `Scripps Waivers`.
3. A person with neither waiver sees the waiver-required flow.

Also resend the same completed event and confirm it does not create a duplicate.
