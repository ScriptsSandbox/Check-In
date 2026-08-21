"""Read the Sandbox Access calendar and derive the public access state."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import math
import os
from pathlib import Path
import re
from typing import Any, Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo


CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
DEFAULT_OPEN_MARKERS = ("door open", "independent access", "open access")
DEFAULT_CLOSED_MARKERS = ("makerspace closed", "sandbox closed", "closed")


@dataclass(frozen=True)
class CalendarEvent:
    title: str
    start: datetime
    end: datetime
    kind: str


@dataclass(frozen=True)
class AccessStatus:
    mode: str
    minutes_until_close: int | None
    closes_at: datetime | None
    checked_at: datetime
    source: str = "sandbox_access_calendar"
    stale: bool = False
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "minutes_until_close": self.minutes_until_close,
            "closes_at": self.closes_at.isoformat() if self.closes_at else None,
            "checked_at": self.checked_at.isoformat(),
            "source": self.source,
            "stale": self.stale,
            "reason": self.reason,
        }


def _markers(environment_name: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
    configured = os.getenv(environment_name, "").strip()
    if not configured:
        return defaults
    return tuple(value.strip().lower() for value in configured.split(",") if value.strip())


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.replace("\u00a0", " ")).strip().lower()


def classify_title(
    title: str,
    open_markers: tuple[str, ...] = DEFAULT_OPEN_MARKERS,
    closed_markers: tuple[str, ...] = DEFAULT_CLOSED_MARKERS,
) -> str:
    normalized = normalize_title(title)
    if any(marker in normalized for marker in closed_markers):
        return "closed"
    if normalized == "open" or any(marker in normalized for marker in open_markers):
        return "open"
    return "restricted"


def _event_datetime(value: dict[str, str], local_zone: ZoneInfo) -> datetime:
    if value.get("dateTime"):
        raw = value["dateTime"].replace("Z", "+00:00")
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=local_zone)
        return parsed.astimezone(local_zone)
    parsed_date = date.fromisoformat(value["date"])
    return datetime.combine(parsed_date, time.min, tzinfo=local_zone)


def parse_google_event(
    item: dict[str, Any],
    local_zone: ZoneInfo,
    open_markers: tuple[str, ...] = DEFAULT_OPEN_MARKERS,
    closed_markers: tuple[str, ...] = DEFAULT_CLOSED_MARKERS,
) -> CalendarEvent | None:
    if item.get("status") == "cancelled" or not item.get("start") or not item.get("end"):
        return None
    start = _event_datetime(item["start"], local_zone)
    end = _event_datetime(item["end"], local_zone)
    if end <= start:
        return None
    title = str(item.get("summary") or "Reserved")
    return CalendarEvent(
        title=title,
        start=start,
        end=end,
        kind=classify_title(title, open_markers, closed_markers),
    )


def determine_access_status(
    events: Iterable[CalendarEvent],
    now: datetime,
    warning_minutes: int = 30,
) -> AccessStatus:
    ordered = sorted(events, key=lambda event: (event.start, event.end))
    active = [event for event in ordered if event.start <= now < event.end]

    if any(event.kind == "closed" for event in active):
        return AccessStatus("closed", 0, None, now, reason="closed_event")
    if any(event.kind == "restricted" for event in active):
        return AccessStatus("closed", 0, None, now, reason="restricted_event")

    active_open = [event for event in active if event.kind == "open"]
    if not active_open:
        return AccessStatus("closed", 0, None, now, reason="no_open_event")

    access_end = max(event.end for event in active_open)
    changed = True
    while changed:
        changed = False
        for event in ordered:
            if event.kind == "open" and event.start <= access_end and event.end > access_end:
                access_end = event.end
                changed = True

    barriers = [
        event.start
        for event in ordered
        if event.kind in {"closed", "restricted"} and now < event.start < access_end
    ]
    if barriers:
        access_end = min(access_end, min(barriers))

    minutes = max(0, math.ceil((access_end - now).total_seconds() / 60))
    if minutes <= 0:
        return AccessStatus("closed", 0, access_end, now, reason="open_event_ended")
    mode = "closing-soon" if minutes <= warning_minutes else "open"
    return AccessStatus(mode, minutes, access_end, now, reason="open_event")


class CalendarAccessProvider:
    def __init__(
        self,
        credentials_path: Path,
        calendar_id: str,
        timezone_name: str = "America/Los_Angeles",
        open_markers: tuple[str, ...] = DEFAULT_OPEN_MARKERS,
        closed_markers: tuple[str, ...] = DEFAULT_CLOSED_MARKERS,
    ) -> None:
        self.credentials_path = credentials_path
        self.calendar_id = calendar_id
        self.local_zone = ZoneInfo(timezone_name)
        self.open_markers = open_markers
        self.closed_markers = closed_markers
        self._session: Any | None = None

    @classmethod
    def from_environment(cls) -> "CalendarAccessProvider | None":
        calendar_id = os.getenv("SANDBOX_ACCESS_CALENDAR_ID", "").strip()
        credentials = os.getenv("SHEETS_CREDENTIALS_PATH", "").strip()
        if not calendar_id or not credentials:
            return None
        return cls(
            Path(credentials).expanduser(),
            calendar_id,
            os.getenv("SANDBOX_TIMEZONE", "America/Los_Angeles").strip(),
            _markers("SANDBOX_CALENDAR_OPEN_MARKERS", DEFAULT_OPEN_MARKERS),
            _markers("SANDBOX_CALENDAR_CLOSED_MARKERS", DEFAULT_CLOSED_MARKERS),
        )

    def _authorized_session(self) -> Any:
        if self._session is None:
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                str(self.credentials_path), scopes=[CALENDAR_SCOPE]
            )
            self._session = AuthorizedSession(credentials)
        return self._session

    def _fetch_items(self, now: datetime) -> list[dict[str, Any]]:
        start = (now.astimezone(self.local_zone) - timedelta(days=1)).astimezone(timezone.utc)
        end = (now.astimezone(self.local_zone) + timedelta(days=2)).astimezone(timezone.utc)
        url = (
            "https://www.googleapis.com/calendar/v3/calendars/"
            f"{quote(self.calendar_id, safe='')}/events"
        )
        response = self._authorized_session().get(
            url,
            params={
                "singleEvents": "true",
                "orderBy": "startTime",
                "timeMin": start.isoformat().replace("+00:00", "Z"),
                "timeMax": end.isoformat().replace("+00:00", "Z"),
                "maxResults": "250",
            },
            timeout=15,
        )
        response.raise_for_status()
        return list(response.json().get("items", []))

    def refresh(self, now: datetime | None = None) -> AccessStatus:
        checked_at = (now or datetime.now(timezone.utc)).astimezone(self.local_zone)
        events = [
            parsed
            for item in self._fetch_items(checked_at)
            if (parsed := parse_google_event(
                item, self.local_zone, self.open_markers, self.closed_markers
            )) is not None
        ]
        return determine_access_status(events, checked_at)
