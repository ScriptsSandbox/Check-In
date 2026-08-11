"""Small, dependency-free helpers for validating and de-duplicating card reads."""

from __future__ import annotations

import re
import time


UID_PATTERN = re.compile(r"^[0-9A-F]{8,28}$")


def normalize_uid(raw_line: str | bytes) -> str | None:
    """Return a normalized UID, ignoring firmware status and diagnostic lines."""
    if isinstance(raw_line, bytes):
        raw_line = raw_line.decode("ascii", errors="ignore")
    candidate = re.sub(r"[\s:-]", "", raw_line).upper()
    return candidate if UID_PATTERN.fullmatch(candidate) else None


class DuplicateGuard:
    """Suppress repeated reads of the same card inside a short time window."""

    def __init__(self, window_seconds: float = 2.0) -> None:
        self.window_seconds = window_seconds
        self._last_uid: str | None = None
        self._last_seen = 0.0

    def accept(self, uid: str, now: float | None = None) -> bool:
        observed_at = time.monotonic() if now is None else now
        is_duplicate = (
            uid == self._last_uid
            and observed_at - self._last_seen < self.window_seconds
        )
        self._last_uid = uid
        self._last_seen = observed_at
        return not is_duplicate
