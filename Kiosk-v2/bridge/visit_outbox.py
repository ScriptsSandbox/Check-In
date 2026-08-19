"""Durable local queue for kiosk activity rows.

The kiosk acknowledges a check-in only after its visit row is committed to this
SQLite database. A background worker later copies queued rows to Google Sheets.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
import sqlite3
from threading import RLock
import time
from typing import Any, Callable


@dataclass(frozen=True)
class PendingActivity:
    visit_id: str
    row: list[Any]
    attempts: int


class VisitOutbox:
    """Small WAL-mode SQLite ledger shared by check-ins and the sync worker."""

    def __init__(self, path: str | Path, now: Callable[[], float] = time.time) -> None:
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.now = now
        self._lock = RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=FULL")
        self._connection.execute("PRAGMA busy_timeout=10000")
        self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS activity_outbox (
                visit_id TEXT PRIMARY KEY,
                row_json TEXT NOT NULL,
                person_id TEXT NOT NULL DEFAULT '',
                check_in_at TEXT NOT NULL DEFAULT '',
                event_type TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'synced')),
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at REAL NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                synced_at REAL,
                last_error TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS activity_outbox_pending
                ON activity_outbox (state, next_attempt_at, created_at);
            CREATE INDEX IF NOT EXISTS activity_outbox_person
                ON activity_outbox (person_id, event_type, check_in_at);
            """
        )
        self._connection.commit()

    def enqueue(self, row: list[Any]) -> str:
        if not row or not str(row[0]).strip():
            raise ValueError("An activity row requires a Visit ID.")
        visit_id = str(row[0]).strip()
        now = self.now()
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT OR IGNORE INTO activity_outbox (
                    visit_id, row_json, person_id, check_in_at, event_type,
                    state, attempts, next_attempt_at, created_at
                ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
                """,
                (
                    visit_id,
                    json.dumps(list(row), ensure_ascii=False, separators=(",", ":"), default=str),
                    str(row[1]).strip() if len(row) > 1 else "",
                    str(row[2]).strip() if len(row) > 2 else "",
                    str(row[3]).strip() if len(row) > 3 else "",
                    now,
                    now,
                ),
            )
        return visit_id

    def pending(self, limit: int = 25) -> list[PendingActivity]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT visit_id, row_json, attempts
                FROM activity_outbox
                WHERE state = 'pending' AND next_attempt_at <= ?
                ORDER BY created_at, visit_id
                LIMIT ?
                """,
                (self.now(), max(1, int(limit))),
            ).fetchall()
        return [PendingActivity(visit_id=row[0], row=json.loads(row[1]), attempts=int(row[2])) for row in rows]

    def mark_synced(self, visit_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                UPDATE activity_outbox
                SET state = 'synced', synced_at = ?, next_attempt_at = 0, last_error = ''
                WHERE visit_id = ?
                """,
                (self.now(), visit_id),
            )

    def mark_failed(self, visit_id: str, error: Exception | str) -> None:
        with self._lock, self._connection:
            current = self._connection.execute(
                "SELECT attempts FROM activity_outbox WHERE visit_id = ?",
                (visit_id,),
            ).fetchone()
            attempts = (int(current[0]) if current else 0) + 1
            delay = min(60.0, float(2 ** min(attempts - 1, 6)))
            self._connection.execute(
                """
                UPDATE activity_outbox
                SET attempts = ?, next_attempt_at = ?, last_error = ?
                WHERE visit_id = ? AND state = 'pending'
                """,
                (attempts, self.now() + delay, str(error)[:500], visit_id),
            )

    def visit_dates(self, person_id: str) -> set[str]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT check_in_at
                FROM activity_outbox
                WHERE person_id = ? AND event_type = 'User Checkin' AND check_in_at <> ''
                """,
                (person_id,),
            ).fetchall()
        return {str(row[0]).split("T")[0].split()[0] for row in rows if str(row[0]).strip()}

    def status(self) -> dict[str, Any]:
        with self._lock:
            pending = int(self._connection.execute(
                "SELECT COUNT(*) FROM activity_outbox WHERE state = 'pending'"
            ).fetchone()[0])
            oldest = self._connection.execute(
                "SELECT MIN(created_at) FROM activity_outbox WHERE state = 'pending'"
            ).fetchone()[0]
            last_synced = self._connection.execute(
                "SELECT MAX(synced_at) FROM activity_outbox WHERE state = 'synced'"
            ).fetchone()[0]
            last_error = self._connection.execute(
                """
                SELECT last_error FROM activity_outbox
                WHERE last_error <> '' ORDER BY created_at DESC LIMIT 1
                """
            ).fetchone()
        now = self.now()
        return {
            "pending": pending,
            "oldest_pending_seconds": round(max(0.0, now - float(oldest)), 1) if oldest else None,
            "last_synced_at": datetime.fromtimestamp(float(last_synced)).isoformat(timespec="seconds") if last_synced else None,
            "last_error": str(last_error[0]) if last_error else "",
            "database_path": str(self.path),
        }

    def close(self) -> None:
        with self._lock:
            self._connection.close()
