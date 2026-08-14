# Raspberry Pi scanner bridge

This service turns the ESP32 reader's USB serial output into live browser events. It is intentionally local-only: the ESP32 holds no credentials, and the bridge binds to `127.0.0.1`.

## Install on the Pi

1. Connect and flash the existing ESP32/PN532 reader. Its firmware should print one hexadecimal card UID per line at 115200 baud.
2. Create a Python virtual environment and install `requirements.txt`.
3. Copy `systemd/sandbox-scanner-bridge.service` to `/etc/systemd/system/`, adjusting the user and paths if needed.
4. If automatic port detection is ambiguous, set `SCANNER_SERIAL_PORT=/dev/ttyACM0` in `/etc/sandbox-kiosk/scanner.env`.
5. Enable and start the service. Confirm `http://127.0.0.1:8765/health` reports a connected reader and `backend_ready: true` before displaying the kiosk.

When the kiosk UI is served from `localhost`, it automatically connects to `ws://127.0.0.1:8765/ws`. A different endpoint can be supplied at build time with `NEXT_PUBLIC_SCANNER_WS_URL`.

The Sheets backend warms its user, waiver, and activity caches at startup. The user and waiver cache defaults to five minutes; the activity cache defaults to one hour and is updated after every successful append. Override these with `SHEETS_CACHE_SECONDS` and `SHEETS_ACTIVITY_CACHE_SECONDS` when needed.

## Designated-staff card linking

When an unrecognized member card is scanned, the bridge keeps its UID in memory for five minutes. A staff member verifies the member's physical ID, enters the matching PID, TSN, or employee ID in the kiosk, and approves the link by tapping their own already-linked card. The member's UID is never sent to the browser. Successful links update `Card UUID` in the user database and append a `Card Linked` audit row to the activity sheet.

Add the identifiers of the staff allowed to approve links to `/etc/sandbox-kiosk/scanner.env`:

```sh
SCANNER_CHECKIN_BACKEND=sheets
SHEETS_CREDENTIALS_PATH=/etc/sandbox-kiosk/google-service-account.json
SHEETS_ACTIVITY_URL=https://docs.google.com/spreadsheets/d/REPLACE_ME/edit
CARD_LINK_STAFF_IDS=A12345678,123456789
CARD_LINK_SESSION_SECONDS=300
```

`CARD_LINK_STAFF_IDS` contains PIDs, TSNs, or employee IDs, not card UIDs. Each designated staff account must already have a card in the user database. Restart the bridge after changing the allowlist. A member may have multiple active cards; adding a new card does not disable their existing cards. A card already assigned to any account cannot be assigned again.

## Test without hardware

Start the bridge with `SCANNER_SIMULATE=true`, then send a simulated read:

```sh
curl -X POST http://127.0.0.1:8765/simulate \
  -H 'content-type: application/json' \
  -d '{"uid":"04A1B2C3"}'
```

The simulation route does not exist unless simulation is explicitly enabled. The bridge suppresses repeated reads of the same card for 15 seconds by default—long enough to outlast a slow Sheets request—and never writes full UIDs to its logs. Set `SCANNER_DUPLICATE_SECONDS` to adjust the window.

## Run the tests

From the `bridge` directory:

```sh
PYTHONPATH=. python3 -m pytest -q
```
