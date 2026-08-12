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
        self.calls = {"users": 0, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}

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

    def update_user_card(self, identifier, card_uid):
        self.calls["card_update"] += 1
        matches = [
            record
            for record in self.users
            if normalize_person_id(record.get("Student ID")) == normalize_person_id(identifier)
        ]
        if len(matches) != 1:
            raise ValueError("The account could not be identified uniquely.")
        if matches[0].get("Card UUID"):
            raise ValueError("That account already has a connected card.")
        if any(record.get("Card UUID") == card_uid for record in self.users):
            raise ValueError("That card is already connected to an account.")
        matches[0]["Card UUID"] = card_uid
        return matches[0]


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


class FakePeopleSheet:
    def __init__(self, records):
        self.records = records
        self.updated_cells = []

    def get_all_records(self, numericise_ignore=None):
        return self.records

    def row_values(self, row):
        assert row == 1
        return ["Name", "Student ID", "Card UUID"]

    def update_cell(self, row, column, value):
        self.updated_cells.append((row, column, value))


def test_activity_cache_avoids_full_sheet_read_after_append():
    sheet = FakeActivitySheet()
    provider = GoogleSheetsProvider("credentials", "users", "waivers", "activity")
    provider._activity_sheet = sheet

    assert len(provider.activity_rows()) == 1
    provider.append_activity(["08/11/2024 09:30:00", "", "Maker", "CARD", "User Checkin"])
    assert len(provider.activity_rows()) == 2
    assert sheet.reads == 1
    assert sheet.appends == 1


def test_google_sheets_provider_updates_only_the_target_card_cell():
    user_sheet = FakePeopleSheet([
        {"Name": "First Member", "Student ID": "A11111111", "Card UUID": ""},
        {"Name": "Target Member", "Student ID": "A12345678", "Card UUID": ""},
    ])
    waiver_sheet = FakePeopleSheet([])
    provider = GoogleSheetsProvider("credentials", "users", "waivers", "activity")
    provider._user_sheet = user_sheet
    provider._waiver_sheet = waiver_sheet
    provider._activity_sheet = FakeActivitySheet()

    updated = provider.update_user_card("12345678", "newcard123456")

    assert user_sheet.updated_cells == [(3, 3, "NEWCARD123456")]
    assert updated["Card UUID"] == "NEWCARD123456"


def test_warm_up_loads_all_read_heavy_sources():
    provider = FakeProvider()

    timings = backend_for(provider).warm_up()

    assert provider.calls == {"users": 1, "waivers": 1, "activity": 1, "append": 0, "card_update": 0}
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
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}
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
    assert provider.calls == {"users": 1, "waivers": 1, "activity": 0, "append": 0, "card_update": 0}
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
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}
    assert provider.appended_rows == []


def test_staff_assisted_card_link_requires_a_designated_staff_card():
    provider = FakeProvider(users=[
        {
            "Card UUID": "",
            "Student ID": "A12345678",
            "Email Address": "member@ucsd.edu",
            "Name": "Test Member",
        },
        {
            "Card UUID": "STAFF12345678",
            "Student ID": "A87654321",
            "Email Address": "staff@ucsd.edu",
            "Name": "Test Staff",
        },
    ])
    backend = backend_for(provider)

    denied = backend.link_card(
        "A12345678", "NEWCARD123456", "STAFF12345678", {"A11111111"}
    )
    assert denied.outcome == "staff_unauthorized"
    assert provider.users[0]["Card UUID"] == ""

    linked = backend.link_card(
        "A12345678", "NEWCARD123456", "STAFF12345678", {"A87654321"}
    )
    assert linked.outcome == "card_linked"
    assert linked.display_name == "Test Member"
    assert provider.users[0]["Card UUID"] == "NEWCARD123456"
    assert provider.appended_rows[-1][4] == "Card Linked"
    assert provider.appended_rows[-1][5] == "Test Staff"


def test_card_link_target_must_exist_and_have_no_existing_card():
    provider = FakeProvider(users=[{
        "Card UUID": "EXISTING1234",
        "Student ID": "A12345678",
        "Name": "Existing Member",
    }])
    backend = backend_for(provider)

    assert backend.prepare_card_link("A99999999").outcome == "unknown_identifier"
    assert backend.prepare_card_link("A12345678").outcome == "card_link_error"
