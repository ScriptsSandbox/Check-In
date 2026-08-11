from datetime import datetime

from sheets_backend import (
    GoogleSheetsProvider,
    SheetsCheckInBackend,
    normalize_person_id,
)


class FakeProvider:
    def __init__(self, users=None, waivers=None, existing_activity=None):
        self.users = users or []
        self.waivers = waivers or []
        self.existing_activity = existing_activity or [
            ["Timestamp", "Epoch", "Name", "Card UUID", "Action"]
        ]
        self.appended_rows = []
        self.calls = {"users": 0, "waivers": 0, "activity": 0, "append": 0}

    def user_records(self):
        self.calls["users"] += 1
        return self.users

    def waiver_records(self):
        self.calls["waivers"] += 1
        return self.waivers

    def activity_rows(self):
        self.calls["activity"] += 1
        return self.existing_activity

    def append_activity(self, row):
        self.calls["append"] += 1
        self.appended_rows.append(row)


def backend_for(provider):
    return SheetsCheckInBackend(
        provider,
        now=lambda: 1_723_377_600.9,
        local_datetime=lambda: datetime(2024, 8, 11, 9, 30, 0),
    )


class FakeActivitySheet:
    def __init__(self):
        self.rows = [["Timestamp", "Epoch", "Name", "Card UUID", "Action"]]
        self.reads = 0
        self.appends = 0

    def get_all_values(self):
        self.reads += 1
        return [list(row) for row in self.rows]

    def append_row(self, row):
        self.appends += 1
        self.rows.append(list(row))


def test_activity_cache_avoids_full_sheet_read_after_append():
    sheet = FakeActivitySheet()
    provider = GoogleSheetsProvider("credentials", "users", "waivers", "activity")
    provider._activity_sheet = sheet

    assert len(provider.activity_rows()) == 1
    provider.append_activity(["08/11/2024 09:30:00", "", "Maker", "CARD", "User Checkin"])
    assert len(provider.activity_rows()) == 2
    assert sheet.reads == 1
    assert sheet.appends == 1


def test_warm_up_loads_all_read_heavy_sources():
    provider = FakeProvider()

    timings = backend_for(provider).warm_up()

    assert provider.calls == {"users": 1, "waivers": 1, "activity": 1, "append": 0}
    assert set(timings) == {"users", "waivers", "activity", "total"}


def test_known_card_with_waiver_appends_existing_activity_shape():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "ABCDEF12345678",
                "Student ID": "A12345678",
                "Email Address": "maker@ucsd.edu",
                "Name": "Test Maker",
            }
        ],
        waivers=[{"A_Number": "12345678", "Email": ""}],
    )

    result = backend_for(provider).check_in("abcdef12345678")

    assert result.outcome == "success"
    assert result.display_name == "Test Maker"
    assert result.visit_count == 1
    assert set(result.timings_ms) == {
        "user_lookup",
        "waiver_lookup",
        "activity_lookup",
        "activity_append",
        "total",
    }
    assert provider.appended_rows == [
        [
            "08/11/2024 09:30:00",
            1_723_377_600,
            "Test Maker",
            "ABCDEF12345678",
            "User Checkin",
            "",
            "",
            "",
        ]
    ]


def test_unknown_card_does_not_read_waivers_or_activity_or_write():
    provider = FakeProvider()

    result = backend_for(provider).check_in("ABCDEF12345678")

    assert result.outcome == "unknown_card"
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0}
    assert provider.appended_rows == []


def test_known_card_without_waiver_does_not_read_activity_or_write():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "ABCDEF12345678",
                "Student ID": "A12345678",
                "Email Address": "maker@ucsd.edu",
                "Name": "Test Maker",
            }
        ],
        waivers=[],
    )

    result = backend_for(provider).check_in("ABCDEF12345678")

    assert result.outcome == "waiver_required"
    assert provider.calls == {"users": 1, "waivers": 1, "activity": 0, "append": 0}
    assert provider.appended_rows == []


def test_email_match_is_case_insensitive():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "ABCDEF12345678",
                "Student ID": "",
                "Email Address": "Maker@UCSD.edu ",
                "Name": "Email Maker",
            }
        ],
        waivers=[{"A_Number": "", "Email": "maker@ucsd.EDU"}],
    )

    result = backend_for(provider).check_in("ABCDEF12345678")

    assert result.outcome == "success"
    assert len(provider.appended_rows) == 1


def test_person_id_normalization_preserves_legacy_sheet_behavior():
    assert normalize_person_id(" A12345678 ") == "12345678"
    assert normalize_person_id("12345678") == "12345678"
    assert normalize_person_id("") == ""


def test_visit_count_uses_unique_calendar_days_while_recording_each_checkin():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "ABCDEF12345678",
                "Student ID": "A12345678",
                "Email Address": "maker@ucsd.edu",
                "Name": "Test Maker",
            }
        ],
        waivers=[{"A_Number": "12345678", "Email": ""}],
        existing_activity=[
            ["Timestamp", "Epoch", "Name", "Card UUID", "Action"],
            ["08/10/2024 09:00:00", "", "Test Maker", "ABCDEF12345678", "User Checkin"],
            ["08/11/2024 08:00:00", "", "Test Maker", "ABCDEF12345678", "User Checkin"],
            ["08/11/2024 08:01:00", "", "Test Maker", "ABCDEF12345678", "User Checkin"],
            ["08/09/2024 08:00:00", "", "Someone Else", "1111222233334444", "User Checkin"],
        ],
    )

    result = backend_for(provider).check_in("ABCDEF12345678")

    assert result.outcome == "success"
    assert result.visit_count == 2
    assert len(provider.appended_rows) == 1

def test_identifier_checkin_uses_the_existing_card_activity_key():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "ABCDEF12345678",
                "Student ID": "A12345678",
                "Email Address": "maker@ucsd.edu",
                "Name": "Test Maker",
            }
        ],
        waivers=[{"A_Number": "12345678", "Email": ""}],
    )

    result = backend_for(provider).check_in_identifier("a12345678")

    assert result.outcome == "success"
    assert result.display_name == "Test Maker"
    assert provider.appended_rows[0][3] == "ABCDEF12345678"


def test_identifier_checkin_supports_accounts_without_cards():
    provider = FakeProvider(
        users=[
            {
                "Card UUID": "",
                "Student ID": "A12345678",
                "Email Address": "maker@ucsd.edu",
                "Name": "Test Maker",
            }
        ],
        waivers=[{"A_Number": "12345678", "Email": ""}],
    )

    result = backend_for(provider).check_in_identifier("12345678")

    assert result.outcome == "success"
    assert provider.appended_rows[0][3] == "12345678"


def test_unknown_identifier_does_not_read_waivers_or_write():
    provider = FakeProvider()

    result = backend_for(provider).check_in_identifier("A99999999")

    assert result.outcome == "unknown_identifier"
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0}
    assert provider.appended_rows == []
