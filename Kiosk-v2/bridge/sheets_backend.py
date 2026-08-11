"""Transitional Google Sheets check-in backend for the local kiosk bridge.

The browser receives display-safe outcomes only. Raw card UIDs stay inside this
local process and the existing activity Sheet.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import os
from threading import Lock
import time
from typing import Any, Callable, Protocol


@dataclass(frozen=True)
class CheckInResult:
    outcome: str
    display_name: str | None = None
    message: str = ""
    visit_count: int | None = None


class SheetsProvider(Protocol):
    def user_records(self) -> list[dict[str, Any]]: ...

    def waiver_records(self) -> list[dict[str, Any]]: ...

    def activity_rows(self) -> list[list[Any]]: ...

    def append_activity(self, row: list[Any]) -> None: ...


def normalize_person_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("+e?", "")[:9]
    return normalized[1:] if normalized.startswith("a") else normalized


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


class GoogleSheetsProvider:
    """Lazy, thread-safe access to the three existing Scripps Sheets."""

    def __init__(
        self,
        credentials_path: str,
        user_sheet_name: str,
        waiver_sheet_name: str,
        activity_sheet_url: str,
        cache_seconds: int = 300,
    ) -> None:
        self.credentials_path = credentials_path
        self.user_sheet_name = user_sheet_name
        self.waiver_sheet_name = waiver_sheet_name
        self.activity_sheet_url = activity_sheet_url
        self.cache_seconds = cache_seconds
        self._lock = Lock()
        self._user_sheet: Any = None
        self._waiver_sheet: Any = None
        self._activity_sheet: Any = None
        self._users: list[dict[str, Any]] | None = None
        self._waivers: list[dict[str, Any]] | None = None
        self._cache_expires_at = 0.0

    @classmethod
    def from_environment(cls) -> "GoogleSheetsProvider":
        credentials_path = os.getenv("SHEETS_CREDENTIALS_PATH", "").strip()
        activity_sheet_url = os.getenv("SHEETS_ACTIVITY_URL", "").strip()
        if not credentials_path or not activity_sheet_url:
            raise RuntimeError(
                "SHEETS_CREDENTIALS_PATH and SHEETS_ACTIVITY_URL are required"
            )
        return cls(
            credentials_path=credentials_path,
            user_sheet_name=os.getenv("SHEETS_USER_DB_NAME", "User Database SIO"),
            waiver_sheet_name=os.getenv(
                "SHEETS_WAIVER_DB_NAME", "Waiver Signatures SIO"
            ),
            activity_sheet_url=activity_sheet_url,
            cache_seconds=int(os.getenv("SHEETS_CACHE_SECONDS", "300")),
        )

    def _connect(self) -> None:
        if self._activity_sheet is not None:
            return
        import gspread

        client = gspread.service_account(filename=self.credentials_path)
        self._user_sheet = client.open(self.user_sheet_name).sheet1
        self._waiver_sheet = client.open(self.waiver_sheet_name).sheet1
        self._activity_sheet = client.open_by_url(self.activity_sheet_url).sheet1

    def _refresh_if_needed(self) -> None:
        now = time.monotonic()
        if self._users is not None and now < self._cache_expires_at:
            return
        self._connect()
        self._users = self._user_sheet.get_all_records(numericise_ignore=["all"])
        self._waivers = self._waiver_sheet.get_all_records(
            numericise_ignore=["all"]
        )
        self._cache_expires_at = now + self.cache_seconds

    def user_records(self) -> list[dict[str, Any]]:
        with self._lock:
            self._refresh_if_needed()
            return list(self._users or [])

    def waiver_records(self) -> list[dict[str, Any]]:
        with self._lock:
            self._refresh_if_needed()
            return list(self._waivers or [])

    def activity_rows(self) -> list[list[Any]]:
        with self._lock:
            self._connect()
            return self._activity_sheet.get_all_values()

    def append_activity(self, row: list[Any]) -> None:
        with self._lock:
            self._connect()
            self._activity_sheet.append_row(row)


class SheetsCheckInBackend:
    def __init__(
        self,
        provider: SheetsProvider,
        now: Callable[[], float] = time.time,
        local_datetime: Callable[[], datetime] = datetime.now,
    ) -> None:
        self.provider = provider
        self.now = now
        self.local_datetime = local_datetime

    def check_in(self, uid: str) -> CheckInResult:
        normalized_uid = uid.strip().upper()
        user = next(
            (
                record
                for record in self.provider.user_records()
                if str(record.get("Card UUID", "")).strip().upper()
                == normalized_uid
            ),
            None,
        )
        if user is None:
            return CheckInResult(
                outcome="unknown_card",
                message="This card is not connected to a Sandbox account.",
            )

        user_id = normalize_person_id(user.get("Student ID"))
        user_email = normalize_email(user.get("Email Address"))
        waiver_found = any(
            (
                bool(user_id)
                and normalize_person_id(waiver.get("A_Number")) == user_id
            )
            or (
                bool(user_email)
                and normalize_email(waiver.get("Email")) == user_email
            )
            for waiver in self.provider.waiver_records()
        )
        if not waiver_found:
            return CheckInResult(
                outcome="waiver_required",
                message="A current waiver is required before check-in.",
            )

        display_name = str(user.get("Name", "")).strip() or "Sandbox member"
        local_now = self.local_datetime()
        today = local_now.strftime("%m/%d/%Y")
        visit_dates = {
            str(row[0]).split()[0]
            for row in self.provider.activity_rows()[1:]
            if len(row) >= 5
            and str(row[3]).strip().upper() == normalized_uid
            and str(row[4]).strip() == "User Checkin"
            and str(row[0]).strip()
        }
        visit_count = len(visit_dates | {today})
        row = [
            local_now.strftime("%m/%d/%Y %H:%M:%S"),
            int(self.now()),
            display_name,
            normalized_uid,
            "User Checkin",
            "",
            "",
            "",
        ]
        self.provider.append_activity(row)
        return CheckInResult(
            outcome="success",
            display_name=display_name,
            message="Check-in recorded.",
            visit_count=visit_count,
        )
