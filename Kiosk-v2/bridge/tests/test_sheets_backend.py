from datetime import datetime
import hashlib
import hmac

from sheets_backend import GoogleSheetsProvider, SheetsCheckInBackend, normalize_person_id


SECRET = "test-card-secret"


def digest(uid):
    return hmac.new(SECRET.encode(), uid.strip().upper().encode(), hashlib.sha256).hexdigest()


class FakeProvider:
    def __init__(self, users=None, waivers=None, visits=None):
        self.users = users or []
        self.waivers = waivers or []
        self.visits = visits or [["Visit ID", "Person ID", "Check In At", "Event Type"]]
        self.appended_rows = []
        self.calls = {"users": 0, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}

    def card_digest(self, uid):
        return digest(uid)

    def user_records(self):
        self.calls["users"] += 1
        return self.users

    def waiver_records(self):
        self.calls["waivers"] += 1
        return self.waivers

    def activity_rows(self):
        self.calls["activity"] += 1
        return self.visits

    def append_activity(self, row):
        self.calls["append"] += 1
        self.appended_rows.append(row)

    def update_user_card(self, identifier, card_uid):
        self.calls["card_update"] += 1
        matches = [record for record in self.users if normalize_person_id(record.get("Student ID")) == normalize_person_id(identifier)]
        if len(matches) != 1:
            raise ValueError("The account could not be identified uniquely.")
        if matches[0].get("Card Digest"):
            raise ValueError("That account already has a connected card.")
        new_digest = self.card_digest(card_uid)
        if any(record.get("Card Digest") == new_digest for record in self.users):
            raise ValueError("That card is already connected to an account.")
        matches[0]["Card Digest"] = new_digest
        return matches[0]


def user(name="Test Maker", student_id="A12345678", email="maker@ucsd.edu", card_uid="ABCDEF12345678", person_id="person_test"):
    return {
        "Person ID": person_id,
        "Name": name,
        "Student ID": student_id,
        "Email Address": email,
        "Card Digest": digest(card_uid) if card_uid else "",
    }


def backend_for(provider):
    return SheetsCheckInBackend(
        provider,
        now=lambda: 1_723_377_600.9,
        local_datetime=lambda: datetime(2024, 8, 11, 9, 30, 0),
    )


class FakeRecordsSheet:
    def __init__(self, records=None, rows=None):
        self.records = records or []
        self.rows = rows or []
        self.appended = []

    def get_all_records(self, numericise_ignore=None):
        return [dict(record) for record in self.records]

    def get_all_values(self):
        return [list(row) for row in self.rows]

    def append_row(self, row, value_input_option=None):
        self.appended.append(list(row))
        self.rows.append(list(row))


def normalized_provider():
    provider = GoogleSheetsProvider("credentials", "database", "waivers", SECRET)
    provider._people_sheet = FakeRecordsSheet([{
        "Person ID": "person_test", "Status": "Active", "Display Name": "Test Maker", "Primary Email": "maker@ucsd.edu"
    }])
    provider._identifiers_sheet = FakeRecordsSheet([
        {"Person ID": "person_test", "Type": "UCSD ID", "Normalized Value": "A12345678", "Primary": True, "Active": True},
        {"Person ID": "person_test", "Type": "Email", "Normalized Value": "maker@ucsd.edu", "Primary": True, "Active": True},
    ])
    provider._cards_sheet = FakeRecordsSheet([{
        "Person ID": "person_test", "Card Digest": digest("ABCDEF12345678"), "Status": "Active"
    }])
    provider._visits_sheet = FakeRecordsSheet(rows=[["Visit ID", "Person ID", "Check In At", "Event Type"]])
    provider._waiver_sheet = FakeRecordsSheet([{"A_Number": "12345678", "Email": ""}])
    return provider


def test_google_provider_joins_normalized_people_identifiers_and_cards():
    record = normalized_provider().user_records()[0]
    assert record == {
        "Person ID": "person_test",
        "Name": "Test Maker",
        "Student ID": "A12345678",
        "Email Address": "maker@ucsd.edu",
        "Card Digest": digest("ABCDEF12345678"),
    }


def test_google_provider_links_card_by_appending_digest_not_raw_uid():
    provider = normalized_provider()
    provider._cards_sheet.records = []
    provider._users = None
    updated = provider.update_user_card("12345678", "NEWCARD123456")
    appended = provider._cards_sheet.appended[0]
    assert appended[1] == "person_test"
    assert appended[2] == digest("NEWCARD123456")
    assert appended[3] == "3456"
    assert "NEWCARD123456" not in appended
    assert updated["Card Digest"] == digest("NEWCARD123456")


def test_warm_up_loads_all_read_heavy_sources():
    provider = FakeProvider()
    timings = backend_for(provider).warm_up()
    assert provider.calls == {"users": 1, "waivers": 1, "activity": 1, "append": 0, "card_update": 0}
    assert set(timings) == {"users", "waivers", "activity", "total"}


def test_known_card_with_waiver_appends_normalized_visit():
    provider = FakeProvider(users=[user()], waivers=[{"A_Number": "12345678", "Email": ""}])
    result = backend_for(provider).check_in("abcdef12345678")
    assert result.outcome == "success"
    assert result.display_name == "Test Maker"
    assert result.visit_count == 1
    assert provider.appended_rows[0][1:4] == ["person_test", "2024-08-11T09:30:00", "User Checkin"]
    assert "ABCDEF12345678" not in provider.appended_rows[0]


def test_unknown_card_does_not_read_waivers_or_write():
    provider = FakeProvider(users=[user()])
    result = backend_for(provider).check_in("UNKNOWN")
    assert result.outcome == "unknown_card"
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}


def test_known_card_without_waiver_does_not_write():
    provider = FakeProvider(users=[user()])
    result = backend_for(provider).check_in("ABCDEF12345678")
    assert result.outcome == "waiver_required"
    assert provider.appended_rows == []


def test_email_waiver_match_is_case_insensitive():
    provider = FakeProvider(users=[user(student_id="")], waivers=[{"A_Number": "", "Email": "Maker@UCSD.EDU"}])
    assert backend_for(provider).check_in("ABCDEF12345678").outcome == "success"


def test_visit_count_uses_unique_person_calendar_days():
    provider = FakeProvider(
        users=[user()],
        waivers=[{"A_Number": "12345678", "Email": ""}],
        visits=[
            ["Visit ID", "Person ID", "Check In At", "Event Type"],
            ["v1", "person_test", "2024-08-10T09:00:00", "User Checkin"],
            ["v2", "person_test", "2024-08-11T08:00:00", "User Checkin"],
            ["v3", "person_other", "2024-08-09T08:00:00", "User Checkin"],
        ],
    )
    assert backend_for(provider).check_in("ABCDEF12345678").visit_count == 2


def test_identifier_checkin_supports_account_without_card():
    provider = FakeProvider(users=[user(card_uid="")], waivers=[{"A_Number": "12345678", "Email": ""}])
    assert backend_for(provider).check_in_identifier("12345678").outcome == "success"


def test_staff_assisted_card_link_requires_designated_staff_and_writes_audit():
    provider = FakeProvider(users=[
        user(name="Test Member", card_uid="", person_id="person_member"),
        user(name="Test Staff", student_id="A87654321", email="staff@ucsd.edu", card_uid="STAFF12345678", person_id="person_staff"),
    ])
    backend = backend_for(provider)
    denied = backend.link_card("A12345678", "NEWCARD123456", "STAFF12345678", {"A11111111"})
    assert denied.outcome == "staff_unauthorized"
    linked = backend.link_card("A12345678", "NEWCARD123456", "STAFF12345678", {"A87654321"})
    assert linked.outcome == "card_linked"
    assert provider.users[0]["Card Digest"] == digest("NEWCARD123456")
    assert provider.appended_rows[-1][1:5] == ["person_member", "2024-08-11T09:30:00", "Card Linked", "Test Staff"]


def test_card_link_target_must_exist_and_have_no_existing_card():
    backend = backend_for(FakeProvider(users=[user()]))
    assert backend.prepare_card_link("A99999999").outcome == "unknown_identifier"
    assert backend.prepare_card_link("A12345678").outcome == "card_link_error"


def test_person_id_normalization_preserves_legacy_behavior():
    assert normalize_person_id(" A12345678 ") == "12345678"
    assert normalize_person_id("12345678") == "12345678"
