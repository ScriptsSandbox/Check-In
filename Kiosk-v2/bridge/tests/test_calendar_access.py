from datetime import datetime
from zoneinfo import ZoneInfo

from calendar_access import (
    CalendarEvent,
    classify_title,
    determine_access_status,
    parse_google_event,
)


ZONE = ZoneInfo("America/Los_Angeles")


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, 20, hour, minute, tzinfo=ZONE)


def event(title: str, start: datetime, end: datetime, kind: str | None = None) -> CalendarEvent:
    return CalendarEvent(title, start, end, kind or classify_title(title))


def test_real_open_title_with_nonbreaking_space_is_open() -> None:
    assert classify_title("Door Open –\u00a0Independent Access") == "open"


def test_final_thirty_minutes_are_closing_soon() -> None:
    result = determine_access_status(
        [event("Door Open – Independent Access", at(12), at(14))], at(13, 31)
    )
    assert result.mode == "closing-soon"
    assert result.minutes_until_close == 29
    assert result.closes_at == at(14)


def test_outside_an_open_block_is_closed() -> None:
    result = determine_access_status(
        [event("Door Open – Independent Access", at(12), at(14))], at(14, 1)
    )
    assert result.mode == "closed"
    assert result.reason == "no_open_event"


def test_reserved_event_overrides_an_overlapping_open_block() -> None:
    result = determine_access_status(
        [
            event("Door Open – Independent Access", at(12), at(16)),
            event("Reserved for MAS CSP Workshops", at(13), at(15)),
        ],
        at(13, 30),
    )
    assert result.mode == "closed"
    assert result.reason == "restricted_event"


def test_makerspace_closed_event_overrides_open() -> None:
    result = determine_access_status(
        [
            event("Door Open – Independent Access", at(9), at(17)),
            event("Makerspace Closed", at(0), at(23, 59)),
        ],
        at(10),
    )
    assert result.mode == "closed"
    assert result.reason == "closed_event"


def test_adjacent_open_blocks_are_one_continuous_period() -> None:
    result = determine_access_status(
        [
            event("Door Open – Independent Access", at(9), at(11)),
            event("Door Open – Independent Access", at(11), at(13)),
        ],
        at(10, 45),
    )
    assert result.mode == "open"
    assert result.minutes_until_close == 135
    assert result.closes_at == at(13)


def test_upcoming_reservation_becomes_the_effective_close() -> None:
    result = determine_access_status(
        [
            event("Door Open – Independent Access", at(12), at(16)),
            event("Reserved for workshop", at(14), at(15)),
        ],
        at(13, 40),
    )
    assert result.mode == "closing-soon"
    assert result.minutes_until_close == 20
    assert result.closes_at == at(14)


def test_all_day_event_uses_calendar_timezone() -> None:
    parsed = parse_google_event(
        {
            "summary": "Makerspace Closed",
            "start": {"date": "2026-09-04"},
            "end": {"date": "2026-09-08"},
        },
        ZONE,
    )
    assert parsed is not None
    assert parsed.start == datetime(2026, 9, 4, tzinfo=ZONE)
    assert parsed.end == datetime(2026, 9, 8, tzinfo=ZONE)
    assert parsed.kind == "closed"
