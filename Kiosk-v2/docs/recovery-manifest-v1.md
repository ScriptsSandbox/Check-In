# Recovery manifest v1

Recorded: 2026-08-13

This manifest identifies the first institutional recovery point for the Scripps
Sandbox check-in system. It contains no credentials, raw card values, student
records, or private spreadsheet identifiers.

## Ownership

- Source code: `ScriptsSandbox/Check-In` on GitHub.
- Google recovery assets: `Scripps Sandbox Web & Data Infrastructure` shared
  drive, under `04 SOPs and Runbooks/Check-In Kiosk Recovery`.
- Operational Google identity: `scripps-sandbox@ucsd.edu`.
- Credential values: institutional credential register only; never GitHub.

## Version boundary

- Pi kiosk, scanner bridge, and ESP32 display deployed on 2026-08-13 from
  commit `242abcf256851f47dfec35ce27b075e821937c59`.
- The Pi worktree has a modified private `.env.production` and local pre-change
  backup files. Those are intentionally not part of the release.
- The normalized Apps Script registration source and staff desk source were
  preserved after the Pi commit because they deploy independently of the Pi.
- The recovery release branch must point at the commit containing this manifest,
  the preserved Apps Script sources, and the captured Pi unit files.

## Repositories and components

| Component | Recovery source |
| --- | --- |
| Kiosk web UI | `Kiosk-v2/app` |
| Scanner/Sheets bridge | `Kiosk-v2/bridge` |
| Pi service definitions | `Kiosk-v2/deploy/pi/systemd` |
| Pi Chromium launcher | `Kiosk-v2/deploy/pi/bin/sandbox-kiosk-display` |
| ESP32 firmware | `ESP-32/src/scanner.ino` |
| Registration Apps Script | `Kiosk-v2/apps-script-registration` |
| Staff desk Apps Script | `Kiosk-v2/apps-script-staff` |
| Data migration and crosswalk controls | `Kiosk-v2/lib/sync` and `Kiosk-v2/docs` |

## Live Pi inventory

- Raspberry Pi Connect name: `Check-In Computer v2`.
- Checkout path: `/home/sandbox/Check-In-v2`.
- Pi deployed commit: `242abcf256851f47dfec35ce27b075e821937c59`.
- Enabled user services:
  - `sandbox-kiosk-bridge.service`
  - `sandbox-kiosk-web.service`
  - `sandbox-kiosk-display.service`
- Bridge health: `http://127.0.0.1:8765/health`.
- Kiosk web endpoint: `http://127.0.0.1:3000`.

## Data recovery point

Dated 2026-08-13 copies of the normalized production database and the waiver
spreadsheet are stored in the institutional recovery folder and clearly marked
`DO NOT USE AS LIVE`. The original production database remains live and was not
moved or renamed.

## Validation at capture

- Apps Script registration tests: 12 passed.
- Staff desk tests: 9 passed.
- Kiosk/data unit tests: 28 passed.
- Pi tests: 2 passed.
- Production web build: passed.
- Pi commit and enabled service inventory: verified remotely.

## Known continuity gap

The live production spreadsheet was personally owned at capture time, with
`scripps-sandbox@ucsd.edu` as an editor. Schedule a controlled ownership move to
an appropriate UCSD shared drive after checking service-account and Apps Script
access. Do not change ownership during an incident.
