# Scripps DocuSign waiver transition

## Acceptance policy

The transition is additive. A completed waiver from either source is sufficient:

1. the existing `Waiver Signatures SIO` Google Sheet; or
2. the Scripps-owned DocuSign Web Form sync service.

The kiosk checks the legacy sheet first. Legacy completions do not expire merely
because the Scripps form is introduced, and the new service never writes to or
invalidates the old sheet. If the new service is unavailable, legacy matches
continue to work and new-only records fail closed until service returns.

## Data flow

DocuSign Connect sends a completed-envelope event to the dedicated public sync
service. The service verifies DocuSign's HMAC signature and stores only the
minimum matching record: source envelope ID, status, participant name and email,
optional UC San Diego identifier, signed date, receipt date, and a payload hash.
It does not expose a participant browser.

The Raspberry Pi and Staff Desk app call an API-key-protected status endpoint.
Matching uses an exact normalized UC San Diego identifier first. When an
identifier was not supplied, it accepts a unique exact email-and-name match. An
ambiguous fallback does not verify the waiver.

## Required production configuration

- Public sync URL: `https://scripps-sandbox-waiver-sync.rjatplay.chatgpt.site`
- DocuSign Connect webhook: `/api/docusign`
- Kiosk and Staff Desk lookup: `/api/status`
- Sync-service secret: `DOCUSIGN_CONNECT_HMAC_SECRET`
- Shared kiosk/Staff Desk secret: `WAIVER_STATUS_API_KEY`
- Raspberry Pi settings: `SCRIPPS_WAIVER_STATUS_URL` and
  `SCRIPPS_WAIVER_API_KEY_FILE`
- Staff Apps Script properties: `SCRIPPS_WAIVER_STATUS_URL` and
  `SCRIPPS_WAIVER_API_KEY`

Do not switch the registration or kiosk waiver link until the public service,
DocuSign Connect event delivery, and at least one end-to-end completion test all
succeed.

## DocuSign administrator request

Ask the DocuSign administrator to enable Connect for completed envelope events
from the Sandbox Web Form/template, deliver JSON including recipient and tab
data, use the webhook URL above, and enable HMAC signing with the shared secret.
If account-wide Connect is inappropriate, request the narrowest available
configuration scoped to the Sandbox template or integration user.

## Acceptance test

Verify all three cases before changing the public waiver link:

1. A legacy-only signer checks in successfully.
2. A new Scripps-form signer checks in successfully after the Connect event.
3. A person with neither waiver sees the waiver-required flow.

Also stop the new service temporarily and confirm case 1 still succeeds.
