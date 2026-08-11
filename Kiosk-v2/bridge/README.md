# Raspberry Pi scanner bridge

This service turns the ESP32 reader's USB serial output into live browser events. It is intentionally local-only: the ESP32 holds no credentials, and the bridge binds to `127.0.0.1`.

## Install on the Pi

1. Connect and flash the existing ESP32/PN532 reader. Its firmware should print one hexadecimal card UID per line at 115200 baud.
2. Create a Python virtual environment and install `requirements.txt`.
3. Copy `systemd/sandbox-scanner-bridge.service` to `/etc/systemd/system/`, adjusting the user and paths if needed.
4. If automatic port detection is ambiguous, set `SCANNER_SERIAL_PORT=/dev/ttyACM0` in `/etc/sandbox-kiosk/scanner.env`.
5. Enable and start the service. Confirm `http://127.0.0.1:8765/health` reports a connected reader.

When the kiosk UI is served from `localhost`, it automatically connects to `ws://127.0.0.1:8765/ws`. A different endpoint can be supplied at build time with `NEXT_PUBLIC_SCANNER_WS_URL`.

## Test without hardware

Start the bridge with `SCANNER_SIMULATE=true`, then send a simulated read:

```sh
curl -X POST http://127.0.0.1:8765/simulate \
  -H 'content-type: application/json' \
  -d '{"uid":"04A1B2C3"}'
```

The simulation route does not exist unless simulation is explicitly enabled. The bridge suppresses repeated reads of the same card for two seconds and never writes full UIDs to its logs.

## Run the dependency-free tests

From the `bridge` directory:

```sh
PYTHONPATH=. python3 -m unittest discover -s tests
```
