#!/usr/bin/env python3
"""Temporary, non-persistent PN532/ESP32 serial diagnostic for the kiosk Pi."""

from __future__ import annotations

import argparse
import glob
import hashlib
import hmac
import json
import os
import secrets
import select
import signal
import sys
import termios
import time
from datetime import datetime, timezone


DEVICE_PATTERNS = ("/dev/ttyACM*", "/dev/ttyUSB*")


def discover_devices() -> list[str]:
    return sorted({path for pattern in DEVICE_PATTERNS for path in glob.glob(pattern)})


def card_uid_from_line(line: str) -> str | None:
    value = line.strip().upper()
    if len(value) < 8 or len(value) > 20 or len(value) % 2:
        return None
    if any(character not in "0123456789ABCDEF" for character in value):
        return None
    return value


def fingerprint(session_key: bytes, card_uid: str) -> str:
    digest = hmac.new(session_key, card_uid.encode("ascii"), hashlib.sha256).hexdigest()
    return digest[:12]


def configure_serial(file_descriptor: int) -> None:
    attributes = termios.tcgetattr(file_descriptor)
    attributes[0] = 0
    attributes[1] = 0
    attributes[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    attributes[3] = 0
    attributes[4] = termios.B115200
    attributes[5] = termios.B115200
    attributes[6][termios.VMIN] = 0
    attributes[6][termios.VTIME] = 10
    termios.tcsetattr(file_descriptor, termios.TCSANOW, attributes)


def emit(event: dict[str, object]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="Serial device; auto-detected when exactly one is present")
    parser.add_argument("--duration", type=int, default=180, help="Maximum runtime in seconds")
    parser.add_argument("--debounce", type=float, default=1.25, help="Seconds to suppress a repeated card")
    parser.add_argument("--list-devices", action="store_true")
    arguments = parser.parse_args()

    devices = discover_devices()
    if arguments.list_devices:
        for device in devices:
            print(device)
        return 0

    device = arguments.device
    if not device:
        if len(devices) != 1:
            emit({"type": "reader_error", "reason": "choose_device", "deviceCount": len(devices)})
            return 2
        device = devices[0]

    session_key = secrets.token_bytes(32)
    stop = False

    def request_stop(_signal_number: int, _frame: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        file_descriptor = os.open(device, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
        configure_serial(file_descriptor)
    except (PermissionError, FileNotFoundError, OSError) as error:
        emit({"type": "reader_error", "reason": "open_failed", "errorType": type(error).__name__})
        return 3

    emit({"type": "reader_ready", "device": device, "persistentLogging": False})
    deadline = time.monotonic() + max(1, arguments.duration)
    buffer = b""
    last_seen: dict[str, float] = {}

    try:
        while not stop and time.monotonic() < deadline:
            readable, _, _ = select.select([file_descriptor], [], [], 0.25)
            if not readable:
                continue
            chunk = os.read(file_descriptor, 4096)
            if not chunk:
                continue
            buffer += chunk
            while b"\n" in buffer:
                raw_line, buffer = buffer.split(b"\n", 1)
                card_uid = card_uid_from_line(raw_line.decode("ascii", errors="ignore"))
                if not card_uid:
                    continue
                card_fingerprint = fingerprint(session_key, card_uid)
                now = time.monotonic()
                if now - last_seen.get(card_fingerprint, 0) < arguments.debounce:
                    emit({"type": "card_suppressed", "fingerprint": card_fingerprint})
                    continue
                last_seen[card_fingerprint] = now
                emit({
                    "type": "card_read",
                    "fingerprint": card_fingerprint,
                    "at": datetime.now(timezone.utc).isoformat(),
                })
    finally:
        os.close(file_descriptor)
        emit({"type": "reader_stopped", "reason": "requested" if stop else "duration_elapsed"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
