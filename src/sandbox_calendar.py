from __future__ import annotations

import datetime as dt
import html
import json
import re
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


CALENDAR_ID = "c_94eac8524a54a3479a3862875a17bb13113918876e4fa8c8c484231a5aed8106@group.calendar.google.com"
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "calendar_creds.json"
TOKEN_FILE = BASE_DIR / "token.json"
CACHE_FILE = BASE_DIR / "upcoming_events.json"

LOOKAHEAD_DAYS = 10
MAX_DISPLAY_EVENTS = 3


def get_calendar_service():
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif not creds or not creds.valid:
        if not CREDENTIALS_FILE.exists():
            raise FileNotFoundError(
                f"Missing {CREDENTIALS_FILE.name}. Put your Google OAuth desktop-app credentials "
                f"in {CREDENTIALS_FILE}"
            )

        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def fetch_raw_events(service) -> list[dict[str, Any]]:
    now = dt.datetime.now().astimezone()
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_window = now + dt.timedelta(days=LOOKAHEAD_DAYS)

    events: list[dict[str, Any]] = []
    page_token = None

    while True:
        response = (
            service.events()
            .list(
                calendarId=CALENDAR_ID,
                timeMin=start_of_today.isoformat(),
                timeMax=end_of_window.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                pageToken=page_token,
                maxResults=250,
                fields="items(id,summary,start,end,location,description),nextPageToken",
            )
            .execute()
        )

        events.extend(response.get("items", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return events


def event_is_all_day(event: dict[str, Any]) -> bool:
    return "date" in event.get("start", {})


def parse_start(event: dict[str, Any]) -> dt.datetime:
    start = event.get("start", {})
    if "dateTime" in start:
        return dt.datetime.fromisoformat(start["dateTime"])

    date_value = dt.date.fromisoformat(start["date"])
    local_tz = dt.datetime.now().astimezone().tzinfo
    return dt.datetime.combine(date_value, dt.time.min, tzinfo=local_tz)


def parse_end(event: dict[str, Any]) -> dt.datetime:
    end = event.get("end", {})
    if "dateTime" in end:
        return dt.datetime.fromisoformat(end["dateTime"])

    date_value = dt.date.fromisoformat(end["date"])
    local_tz = dt.datetime.now().astimezone().tzinfo
    return dt.datetime.combine(date_value, dt.time.min, tzinfo=local_tz)


def is_future_or_ongoing(event: dict[str, Any], now: dt.datetime) -> bool:
    try:
        return parse_end(event) >= now
    except Exception:
        return False


def clean_summary(summary: str | None) -> str:
    if not summary:
        return ""
    return html.unescape(summary).strip()


def is_one_word_name(summary: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]+", summary))


def is_public_kiosk_event(event: dict[str, Any]) -> bool:
    summary = clean_summary(event.get("summary"))
    if not summary:
        return False

    upper = summary.upper()

    if upper.startswith("CLOSED"):
        return True

    if upper.startswith("[") and "OUT" in upper:
        return False

    if is_one_word_name(summary):
        return False

    include_keywords = (
        "BOOKED",
        "RESERVED",
        "CLASSROOM",
        "MEZZANINE",
        "3D PRINTER",
    )

    return any(keyword in upper for keyword in include_keywords)


def tidy_resource_label(label: str) -> str:
    label = clean_summary(label)
    label = re.sub(r"(?i)\bbooked\b", "reserved", label)
    label = re.sub(r"\s+", " ", label).strip()

    replacements = {
        "3D Printers": "3D printers",
        "3D Printer": "3D printer",
        "Mezzanine Conference Table": "Mezzanine conference table",
        "Classroom Booked": "Classroom reserved",
    }

    for old, new in replacements.items():
        label = label.replace(old, new)

    return label


def normalize_display_text(summary: str) -> str:
    summary = clean_summary(summary)

    if not summary:
        return ""

    if summary.upper().startswith("CLOSED"):
        rest = re.sub(r"(?i)^CLOSED\b[\s:—-]*", "", summary).strip()
        return f"CLOSED — {rest}" if rest else "CLOSED"

    bracket_match = re.match(r"^\[(.+?)\]\s*(.*)$", summary)
    if bracket_match:
        bracket_label, tail = bracket_match.groups()
        bracket_label = tidy_resource_label(bracket_label)
        tail = tail.strip()

        if tail:
            if re.search(r"(?i)\bfor\b", bracket_label):
                return f"{bracket_label} {tail}"
            return f"{bracket_label} for {tail}"

        return bracket_label

    return tidy_resource_label(summary)


def format_date_label(start_dt: dt.datetime) -> str:
    return start_dt.strftime("%b") + f" {start_dt.day}"


def format_time_label(event: dict[str, Any]) -> str:
    if event_is_all_day(event):
        return "ALL DAY"

    start_dt = parse_start(event)
    end_dt = parse_end(event)

    start_str = start_dt.strftime("%I:%M %p").lstrip("0")
    end_str = end_dt.strftime("%I:%M %p").lstrip("0")
    return f"{start_str}–{end_str}"


def build_display_items(raw_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = dt.datetime.now().astimezone()
    items: list[dict[str, Any]] = []

    for event in raw_events:
        if not is_future_or_ongoing(event, now):
            continue

        if not is_public_kiosk_event(event):
            continue

        summary = clean_summary(event.get("summary"))
        if not summary:
            continue

        start_dt = parse_start(event)
        items.append(
            {
                "date_label": format_date_label(start_dt),
                "time_label": format_time_label(event),
                "text": normalize_display_text(summary),
                "sort_start": start_dt.isoformat(),
            }
        )

    items.sort(key=lambda item: item["sort_start"])
    return items[:MAX_DISPLAY_EVENTS]


def write_cache_file(items: list[dict[str, Any]]) -> None:
    payload = {
        "generated_at": dt.datetime.now().astimezone().isoformat(),
        "calendar_id": CALENDAR_ID,
        "lookahead_days": LOOKAHEAD_DAYS,
        "items": items,
    }

    CACHE_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> None:
    try:
        service = get_calendar_service()
        raw_events = fetch_raw_events(service)
        items = build_display_items(raw_events)
        write_cache_file(items)
        print(f"Wrote {len(items)} display event(s) to {CACHE_FILE}")
    except Exception as exc:
        if CACHE_FILE.exists():
            print(f"Calendar refresh failed, keeping existing cache: {exc}")
            return
        raise


if __name__ == "__main__":
    main()
