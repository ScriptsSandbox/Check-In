from datetime import datetime

from sheets_backend import SheetsCheckInBackend, normalize_person_id


class FakeProvider:
    def __init__(self, users=None, waivers=None, existing_activity=None):
        self.users = users or []
        self.waivers = waivers or []
        self.existing_activity = existing_activity or [
            ["Timestamp", "Epoch", "Name", "Card UUID", "Action"]
        ]
        self.appended_rows = []

    def user_records(self):
        return self.users

    def waiver_records(self):
        return self.waivers

    def activity_rows(self):
        return self.existing_activity

    def append_activity(self, row):
        self.appended_rows.append(row)


def backend_for(provider):
    return SheetsCheckInBackend(
        provider,
        now=lambda: 1_723_377_600.9,
        local_datetime=lambda: datetime(2024, 8, 11, 9, 30, 0),
    )


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


def test_unknown_card_does_not_write_activity():
    provider = FakeProvider()

    result = backend_for(provider).check_in("ABCDEF12345678")

    assert result.outcome == "unknown_card"
    assert provider.appended_rows == []


def test_known_card_without_waiver_does_not_write_activity():
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


def test_visit_count_uses_unique_calendar_days():
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
