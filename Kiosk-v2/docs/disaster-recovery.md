# Check-in kiosk disaster recovery

Use this procedure when the Pi, SD card, ESP32, or kiosk software must be
replaced. Work from institutional accounts. Do not restore from an employee's
personal computer when the GitHub release and shared-drive package are
available.

## Before an incident

1. Keep `scripps-sandbox@ucsd.edu` able to access the production database,
   waiver sheet, Apps Script projects, DocuSign configuration, shared drive, and
   Raspberry Pi Connect.
2. Keep the `ScriptsSandbox` GitHub account and at least one second institutional
   administrator recoverable through UCSD-controlled contact methods.
3. Store credential values only in `07 Credentials Register`. The repository and
   this runbook contain names and locations, not values.
4. After a material release, create dated database and waiver snapshots in the
   recovery folder and record the source commit here.
5. Test a spare SD card at least once per quarter and after changing startup,
   authentication, or storage.

## Fresh Pi rebuild

1. Image a known-good microSD card with the supported Raspberry Pi OS Desktop.
2. Create the `sandbox` user and enable desktop autologin. Confirm its UID is
   `1000`, or update the launcher DBus path before installation.
3. Enroll the device in the institutional Raspberry Pi Connect account as
   `Check-In Computer v2` or a clearly documented replacement name.
4. Install Git, Node.js 22.13 or newer, npm, Python 3, `python3-venv`, Chromium,
   and curl.
5. Clone `https://github.com/ScriptsSandbox/Check-In.git` to
   `/home/sandbox/Check-In-v2` and check out the recorded recovery release
   branch or commit.
6. In `Kiosk-v2`, run `npm ci`, `npm run test:unit`, `npm run test:pi`, and
   `npm run build`.
7. In `Kiosk-v2/bridge`, create `.venv`, install `requirements.txt`, and run the
   bridge test suite.
8. Recreate `Kiosk-v2/.env.production` from `.env.example` and the credential
   register. Recreate `~/.config/sandbox-kiosk/scanner.env` from
   `deploy/pi/scanner.env.example`. Copy the service-account JSON to the path
   named there. Restrict all three files to the `sandbox` user.
9. Copy the three unit files from `deploy/pi/systemd` to
   `~/.config/systemd/user/`. Copy `deploy/pi/bin/sandbox-kiosk-display` to
   `~/.local/bin/` and make it executable.
10. Run `systemctl --user daemon-reload`, enable the bridge, web, and display
    units, and start them. Confirm all three are active.
11. Confirm bridge health reports a connected reader and `backend_ready: true`.
    Confirm Chromium opens the kiosk automatically without browser chrome.

## ESP32 recovery

1. Build `ESP-32/src/scanner.ino` with the board and library versions recorded
   in the institutional credentials/inventory folder.
2. Flash the connected ESP32 over USB.
3. Confirm it prints exactly one uppercase hexadecimal UID per scan at 115200
   baud and displays the Sandbox-colored tap/look-up sequence.
4. Never place Google credentials, person data, or authorization rules on the
   ESP32.

## Apps Script recovery

1. Sign in as `scripps-sandbox@ucsd.edu`.
2. Restore registration from `apps-script-registration` and staff desk from
   `apps-script-staff`. Preserve the existing project when possible so approved
   URLs remain stable.
3. Re-enter Script Properties from the credential register. Do not paste them
   into GitHub issues, documentation, or source files.
4. Deploy registration with the approved public access policy. Deploy the staff
   desk only to UC San Diego users and retain server-side `Staff Access`
   enforcement.
5. Verify a fictional registration against a test database before reconnecting
   production. Remove the fictional record after verification.

## Data restore

1. Prefer the live Google file and revision history when the problem is an
   accidental edit.
2. Use the dated institutional snapshots only when the live file is unavailable
   or irreparably damaged.
3. Make a new copy of the selected snapshot; never turn the archival snapshot
   itself into the live file.
4. Grant only the production Apps Scripts, service accounts, and approved staff
   the access they require.
5. Update spreadsheet references in the Pi and Apps Script properties during a
   scheduled outage. Restart the bridge and verify its warm-up before reopening.

## Acceptance test

Do not reopen until all of these pass:

- Cold boot reaches the home screen automatically.
- Raspberry Pi Connect screen sharing and remote shell work.
- A known waived card creates exactly one successful visit.
- Rapid repeated taps create no duplicate visit.
- PID, TSN, and employee-ID manual check-in resolve correctly.
- A missing waiver blocks the visit and shows the waiver QR.
- Unknown-card staff linking requires an authorized staff card.
- Disconnecting and reconnecting the reader recovers without rebooting.
- A brief network failure never produces a false success.
- Registration and staff desk open under their intended access policies.

Record the restore date, release commit, operator, results, and any exceptions in
the institutional recovery folder.
