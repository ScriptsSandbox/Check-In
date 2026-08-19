from datetime import datetime
from threading import Event
import time

from sheets_backend import (
    GoogleSheetsProvider,
    SheetsCheckInBackend,
    normalize_person_id,
    user_has_card_digest,
    users_matching_identifier,
)
from visit_outbox import VisitOutbox


def test_google_provider_matches_completed_scripps_waiver_from_production_tab():
    provider = GoogleSheetsProvider("unused.json", "database-id", "Waiver Signatures SIO", "secret")
    provider._users = []
    provider._cache_expires_at = time.monotonic() + 60
    provider._scripps_waivers = [
        {"Status": "completed", "Participant Email": "member@ucsd.edu", "Participant ID": "A12345678", "Normalized Identifier": "12345678"},
        {"Status": "voided", "Participant Email": "voided@ucsd.edu", "Participant ID": "A87654321", "Normalized Identifier": "87654321"},
    ]
    assert provider.additional_waiver_found({"Identifiers": ["A12345678"], "Email Address": ""})
    assert provider.additional_waiver_found({"Identifiers": [], "Email Address": "MEMBER@UCSD.EDU"})
    assert not provider.additional_waiver_found({"Identifiers": ["A87654321"], "Email Address": "voided@ucsd.edu"})


def test_expired_people_snapshot_is_returned_while_refresh_runs_in_background():
    provider = GoogleSheetsProvider("unused.json", "database-id", "Waiver Signatures SIO", "secret")
    provider._users = [{"Person ID": "old", "Name": "Ready now"}]
    provider._waivers = []
    provider._scripps_waivers = []
    provider._cache_expires_at = 0
    refresh_started = Event()
    release_refresh = Event()

    def delayed_refresh():
        refresh_started.set()
        assert release_refresh.wait(timeout=2)
        with provider._lock:
            provider._users = [{"Person ID": "new", "Name": "Fresh copy"}]
            provider._cache_expires_at = time.monotonic() + 60

    provider.refresh_people_now = delayed_refresh
    assert provider.user_records()[0]["Person ID"] == "old"
    assert refresh_started.wait(timeout=1)
    refresh_thread = provider._people_refresh_thread
    assert refresh_thread is not None
    release_refresh.set()
    refresh_thread.join(timeout=2)
    assert provider.user_records()[0]["Person ID"] == "new"


class FakeProvider:
    def __init__(self, users=None, waivers=None, existing_activity=None):
        self.users = [dict(row) for row in (users or [])]
        self.waivers = [dict(row) for row in (waivers or [])]
        self.existing_activity = existing_activity or [[
            "Visit ID", "Person ID", "Check In At", "Event Type",
            "Authorizing Entity", "Flags", "Notes", "Source System", "Source Row",
        ]]
        self.appended_rows = []
        self.calls = {"users": 0, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}
        self.group_request = None
        self.group_updates = []
        self.additional_waiver = False

    @staticmethod
    def card_digest(card_uid):
        return "digest:" + str(card_uid).strip().lower()

    def user_records(self):
        self.calls["users"] += 1
        return [dict(row) for row in self.users]

    def waiver_records(self):
        self.calls["waivers"] += 1
        return [dict(row) for row in self.waivers]

    def additional_waiver_found(self, user):
        del user
        return self.additional_waiver

    def activity_rows(self):
        self.calls["activity"] += 1
        return [list(row) for row in self.existing_activity]

    def append_activity(self, row):
        self.calls["append"] += 1
        self.appended_rows.append(list(row))
        self.existing_activity.append(list(row))

    def activity_exists(self, visit_id):
        return any(row and str(row[0]) == str(visit_id) for row in self.existing_activity[1:])

    def update_user_card(self, identifier, card_uid):
        self.calls["card_update"] += 1
        normalized = normalize_person_id(identifier)
        matches = users_matching_identifier(self.users, normalized)
        if len(matches) != 1:
            raise ValueError("The account could not be identified uniquely.")
        digest = self.card_digest(card_uid)
        if any(user_has_card_digest(row, digest) for row in self.users):
            raise ValueError("That card is already connected to an account.")
        replaced_count = len(matches[0].get("Card Digests") or [])
        matches[0]["Card Digest"] = digest
        matches[0]["Card Digests"] = (digest,)
        matches[0]["Replaced Card Count"] = replaced_count
        return dict(matches[0])

    def update_user_card_by_person(self, person_id, card_uid):
        target = next((row for row in self.users if row.get("Person ID") == person_id), None)
        if not target:
            raise ValueError("That active Sandbox account could not be found.")
        if target.get("Card Digests"):
            raise ValueError("This account already has an active card. Use the replacement-card workflow instead.")
        digest = self.card_digest(card_uid)
        if any(user_has_card_digest(row, digest) for row in self.users):
            raise ValueError("That card is already connected to an account.")
        target["Card Digest"] = digest
        target["Card Digests"] = (digest,)
        return dict(target)

    def pending_group_link_request(self):
        return dict(self.group_request) if self.group_request else None

    def mark_group_link_request(self, request_id, status, message):
        self.group_updates.append((request_id, status, message))
        if status.lower() != "pending":
            self.group_request = None

    def update_profile(self, person_id, field, value):
        user = next((row for row in self.users if row.get("Person ID") == person_id), None)
        if not user:
            raise ValueError("That active Sandbox account could not be found.")
        profile = dict(user.get("Profile") or {})
        if field == "role" and profile.get("role") and profile["role"] != value:
            profile["affiliation"] = ""
            profile["anticipatedGraduation"] = ""
        profile[field] = value
        user["Profile"] = profile
        return profile


def backend_for(provider):
    return SheetsCheckInBackend(
        provider,
        now=lambda: 1_723_377_600.9,
        local_datetime=lambda: datetime(2024, 8, 11, 9, 30, 0),
    )


def member(card="CARD123", person_id="person_1", student_id="A12345678", email="maker@example.com", identifiers=None):
    card_digest = FakeProvider.card_digest(card) if card else ""
    return {
        "Person ID": person_id,
        "Name": "Test Maker",
        "Student ID": student_id,
        "Identifiers": identifiers or [student_id],
        "Email Address": email,
        "Card Digest": card_digest,
        "Card Digests": (card_digest,) if card_digest else (),
        "Profile": {"role": "", "affiliation": "", "anticipatedGraduation": ""},
    }


def signed_waiver(student_id="A12345678", email="maker@example.com"):
    return {"A_Number": student_id, "Email": email}


class FakeVisitsSheet:
    def __init__(self):
        self.rows = [["Visit ID", "Person ID", "Check In At", "Event Type"]]
        self.reads = 0
        self.appends = []

    def get_all_values(self):
        self.reads += 1
        return [list(row) for row in self.rows]

    def append_row(self, row, value_input_option=None):
        self.appends.append((list(row), value_input_option))
        self.rows.append(list(row))

    def col_values(self, column_number):
        return [row[column_number - 1] for row in self.rows if len(row) >= column_number]


class FakeCardsSheet:
    HEADERS = ["Card ID", "Person ID", "Card Digest", "Last Four", "Status", "Linked At", "Disabled At", "Source", "Notes"]

    def __init__(self, rows=None, headers=None):
        self.appends = []
        self.rows = [list(headers or self.HEADERS), *(list(row) for row in (rows or []))]

    def row_values(self, row_number):
        return list(self.rows[row_number - 1])

    def get_all_values(self):
        return [list(row) for row in self.rows]

    def append_row(self, row, value_input_option=None):
        self.appends.append((list(row), value_input_option))
        self.rows.append(list(row))

    def update_cell(self, row_number, column_number, value):
        while len(self.rows[row_number - 1]) < column_number:
            self.rows[row_number - 1].append("")
        self.rows[row_number - 1][column_number - 1] = value


def test_activity_cache_avoids_full_sheet_read_after_append():
    sheet = FakeVisitsSheet()
    provider = GoogleSheetsProvider("credentials", "database", "waivers", "long-enough-test-secret")
    provider._visits_sheet = sheet
    assert len(provider.activity_rows()) == 1
    provider.append_activity(["visit_1", "person_1", "2024-08-11T09:30:00", "User Checkin", "", "", "", "Kiosk v2", ""])
    assert len(provider.activity_rows()) == 2
    assert sheet.reads == 1
    assert len(sheet.appends) == 1


def test_google_sheets_provider_replaces_the_previous_active_card():
    provider = GoogleSheetsProvider("credentials", "database", "waivers", "long-enough-test-secret")
    provider._visits_sheet = FakeVisitsSheet()
    existing = member(card="", person_id="person_2")
    existing_digest = provider.card_digest("OLDCARD")
    existing["Card Digest"] = existing_digest
    existing["Card Digests"] = (existing_digest,)
    provider._cards_sheet = FakeCardsSheet([[
        "card_old", "person_2", existing_digest, "1234", "Active",
        "2026-08-13T09:00:00", "", "Registration", "",
    ]])
    provider._users = [existing]
    provider._cache_expires_at = float("inf")
    updated = provider.update_user_card("12345678", "ABCDEF12345678")
    row, option = provider._cards_sheet.appends[0]
    assert updated["Card Digest"] == provider.card_digest("ABCDEF12345678")
    assert updated["Card Digests"] == (provider.card_digest("ABCDEF12345678"),)
    assert updated["Replaced Card Count"] == 1
    assert provider._cards_sheet.rows[1][4] == "Replaced"
    assert provider._cards_sheet.rows[1][6]
    assert row[1] == "person_2"
    assert row[2] == provider.card_digest("ABCDEF12345678")
    assert row[3] == "5678"
    assert "ABCDEF12345678" not in row
    assert option == "USER_ENTERED"


def test_google_sheets_provider_upgrades_legacy_cards_sheet_before_replacement():
    legacy_headers = ["Card ID", "Person ID", "Card Digest", "Last Four", "Status", "Linked At", "Source", "Notes"]
    provider = GoogleSheetsProvider("credentials", "database", "waivers", "long-enough-test-secret")
    existing = member(card="", person_id="person_2")
    existing_digest = provider.card_digest("OLDCARD")
    existing["Card Digest"] = existing_digest
    existing["Card Digests"] = (existing_digest,)
    provider._cards_sheet = FakeCardsSheet([[
        "card_old", "person_2", existing_digest, "1234", "Active",
        "2026-08-13T09:00:00", "Registration", "",
    ]], headers=legacy_headers)
    provider._visits_sheet = FakeVisitsSheet()
    provider._users = [existing]
    provider._cache_expires_at = float("inf")

    updated = provider.update_user_card("12345678", "ABCDEF12345678")

    headers = provider._cards_sheet.rows[0]
    appended, _ = provider._cards_sheet.appends[0]
    assert headers[-1] == "Disabled At"
    assert provider._cards_sheet.rows[1][headers.index("Status")] == "Replaced"
    assert provider._cards_sheet.rows[1][headers.index("Disabled At")]
    assert appended[headers.index("Source")] == "Kiosk v2 staff replacement"
    assert appended[headers.index("Notes")] == "Replaced 1 previous active card(s)"
    assert updated["Replaced Card Count"] == 1


def test_warm_up_loads_all_read_heavy_sources():
    provider = FakeProvider()
    timings = backend_for(provider).warm_up()
    assert provider.calls == {"users": 1, "waivers": 1, "activity": 1, "append": 0, "card_update": 0}
    assert set(timings) == {"users", "waivers", "activity", "total"}


def test_known_card_with_waiver_appends_normalized_visit_shape():
    provider = FakeProvider(users=[member()], waivers=[signed_waiver()])
    result = backend_for(provider).check_in("CARD123")
    assert result.outcome == "success"
    assert result.display_name == "Test Maker"
    assert result.visit_count == 1
    assert result.person_id == "person_1"
    assert result.profile == {"role": "", "affiliation": "", "anticipatedGraduation": ""}
    assert provider.calls["append"] == 1
    row = provider.appended_rows[0]
    assert len(row) == 9
    assert row[0].startswith("visit_")
    assert row[1] == "person_1"
    assert row[2] == "2024-08-11T09:30:00"
    assert row[3] == "User Checkin"
    assert row[7] == "Kiosk v2"
    assert "CARD123" not in row


def test_known_card_commits_to_durable_outbox_before_google_sync(tmp_path):
    provider = FakeProvider(users=[member()], waivers=[signed_waiver()])
    outbox = VisitOutbox(tmp_path / "checkins.sqlite3")
    backend = SheetsCheckInBackend(
        provider,
        now=lambda: 1_723_377_600.9,
        local_datetime=lambda: datetime(2024, 8, 11, 9, 30, 0),
        outbox=outbox,
    )

    result = backend.check_in("CARD123")

    assert result.outcome == "success"
    assert provider.calls["append"] == 0
    assert result.timings_ms["activity_commit"] >= 0
    assert backend.activity_sync_status()["pending"] == 1
    synced = backend.sync_pending_activity()
    assert synced["synced"] == 1
    assert synced["pending"] == 0
    assert provider.calls["append"] == 1
    backend.close()


def test_retry_does_not_duplicate_an_ambiguous_google_append(tmp_path):
    class AmbiguousProvider(FakeProvider):
        def append_activity(self, row):
            super().append_activity(row)
            if self.calls["append"] == 1:
                raise ConnectionError("response lost after append")

    clock = [1000.0]
    provider = AmbiguousProvider()
    outbox = VisitOutbox(tmp_path / "checkins.sqlite3", now=lambda: clock[0])
    backend = SheetsCheckInBackend(provider, outbox=outbox)
    outbox.enqueue([
        "visit_ambiguous", "person_1", "2026-08-19T10:00:00", "User Checkin",
        "", "", "", "Kiosk v2", "",
    ])

    first = backend.sync_pending_activity()
    assert first["pending"] == 1
    assert provider.calls["append"] == 1

    clock[0] += 1.1
    second = backend.sync_pending_activity()
    assert second["pending"] == 0
    assert second["synced"] == 1
    assert provider.calls["append"] == 1
    assert len([row for row in provider.existing_activity if row and row[0] == "visit_ambiguous"]) == 1
    backend.close()


def test_profile_answers_can_be_corrected_during_the_active_session():
    provider = FakeProvider(users=[member()])
    backend = backend_for(provider)
    first = backend.update_profile("person_1", "role", "Undergraduate Student (UG)")
    assert first.outcome == "profile_updated"
    assert first.profile["role"] == "Undergraduate Student (UG)"
    corrected = backend.update_profile("person_1", "role", "Staff")
    assert corrected.outcome == "profile_updated"
    assert corrected.profile == {"role": "Staff", "affiliation": "", "anticipatedGraduation": ""}


def test_unknown_card_does_not_read_waivers_or_activity_or_write():
    provider = FakeProvider()
    result = backend_for(provider).check_in("UNKNOWN")
    assert result.outcome == "unknown_card"
    assert provider.calls == {"users": 1, "waivers": 0, "activity": 0, "append": 0, "card_update": 0}


def test_known_card_without_waiver_does_not_read_activity_or_write():
    provider = FakeProvider(users=[member()], waivers=[])
    result = backend_for(provider).check_in("CARD123")
    assert result.outcome == "waiver_required"
    assert provider.calls["activity"] == 0
    assert provider.calls["append"] == 0


def test_new_scripps_waiver_is_accepted_when_legacy_sheet_has_no_match():
    provider = FakeProvider(users=[member()], waivers=[])
    provider.additional_waiver = True
    result = backend_for(provider).check_in("CARD123")
    assert result.outcome == "success"
    assert provider.calls["append"] == 1


def test_legacy_waiver_still_succeeds_without_calling_new_source():
    provider = FakeProvider(users=[member()], waivers=[signed_waiver()])
    provider.additional_waiver = True
    calls = {"new": 0}
    def new_source(user):
        del user
        calls["new"] += 1
        return True
    provider.additional_waiver_found = new_source
    assert backend_for(provider).check_in("CARD123").outcome == "success"
    assert calls["new"] == 0


def test_email_waiver_match_is_case_insensitive():
    provider = FakeProvider(
        users=[member(student_id="", email="Maker@Example.com")],
        waivers=[signed_waiver(student_id="", email="maker@example.COM")],
    )
    assert backend_for(provider).check_in("CARD123").outcome == "success"


def test_person_id_normalization_preserves_leading_a_behavior():
    assert normalize_person_id(" A12345678 ") == "12345678"
    assert normalize_person_id("12345678") == "12345678"


def test_visit_count_uses_unique_calendar_days_while_recording_each_checkin():
    rows = [
        ["Visit ID", "Person ID", "Check In At", "Event Type"],
        ["visit_old_1", "person_1", "2024-08-10T10:00:00", "User Checkin"],
        ["visit_old_2", "person_1", "2024-08-10T12:00:00", "User Checkin"],
        ["visit_other", "person_2", "2024-08-09T10:00:00", "User Checkin"],
    ]
    provider = FakeProvider(users=[member()], waivers=[signed_waiver()], existing_activity=rows)
    result = backend_for(provider).check_in("CARD123")
    assert result.outcome == "success"
    assert result.visit_count == 2
    assert len(provider.appended_rows) == 1


def test_identifier_checkin_uses_person_id_without_requiring_a_card():
    provider = FakeProvider(users=[member(card="")], waivers=[signed_waiver()])
    result = backend_for(provider).check_in_identifier("A12345678")
    assert result.outcome == "success"
    assert provider.appended_rows[0][1] == "person_1"
    assert all("CARD123" not in str(value) for value in provider.appended_rows[0])


def test_pid_and_tsn_aliases_resolve_to_the_same_person():
    maker = member(card="", identifiers=["A12345678", "200010746"])
    provider = FakeProvider(users=[maker], waivers=[signed_waiver()])
    pid_result = backend_for(provider).check_in_identifier("A12345678")
    tsn_result = backend_for(provider).check_in_identifier("200010746")
    assert pid_result.outcome == "success"
    assert tsn_result.outcome == "success"
    assert {row[1] for row in provider.appended_rows} == {"person_1"}


def test_tsn_alias_can_link_a_card_to_an_existing_pid_account():
    maker = member(card="", identifiers=["A12345678", "200010746"])
    staff = member(card="STAFFCARD", person_id="person_staff", student_id="A87654321")
    provider = FakeProvider(users=[maker, staff])
    result = backend_for(provider).link_card("200010746", "NEWCARD", "STAFFCARD", {"A87654321"})
    assert result.outcome == "card_linked"
    assert provider.calls["card_update"] == 1


def test_waiver_on_pid_allows_checkin_through_tsn_alias():
    maker = member(card="", identifiers=["A12345678", "200010746"])
    provider = FakeProvider(users=[maker], waivers=[signed_waiver(student_id="A12345678")])
    assert backend_for(provider).check_in_identifier("200010746").outcome == "success"


def test_unknown_identifier_does_not_read_waivers_or_write():
    provider = FakeProvider(users=[member()])
    result = backend_for(provider).check_in_identifier("A99999999")
    assert result.outcome == "unknown_identifier"
    assert provider.calls["waivers"] == 0
    assert provider.calls["append"] == 0


def test_staff_assisted_card_link_requires_a_designated_staff_card():
    target = member(card="", person_id="person_member", student_id="A12345678")
    staff = member(card="STAFFCARD", person_id="person_staff", student_id="A87654321")
    provider = FakeProvider(users=[target, staff])
    backend = backend_for(provider)
    rejected = backend.link_card("A12345678", "NEWCARD", "NOTSTAFF", {"A87654321"})
    assert rejected.outcome == "staff_unauthorized"
    assert provider.calls["card_update"] == 0
    accepted = backend.link_card("A12345678", "NEWCARD", "STAFFCARD", {"A87654321"})
    assert accepted.outcome == "card_linked"
    assert provider.calls["card_update"] == 1
    assert provider.appended_rows[0][3] == "Card Linked"
    assert all("NEWCARD" not in str(value) for value in provider.appended_rows[0])


def test_card_link_replaces_the_existing_card_and_disables_the_first():
    target = member(card="OLDCARD", person_id="person_member", student_id="A12345678")
    staff = member(card="STAFFCARD", person_id="person_staff", student_id="A87654321")
    provider = FakeProvider(users=[target, staff])
    backend = backend_for(provider)
    result = backend.link_card("A12345678", "NEWCARD", "STAFFCARD", {"A87654321"})
    assert result.outcome == "card_linked"
    assert backend.check_in("OLDCARD").outcome == "unknown_card"
    assert backend.check_in("NEWCARD").outcome == "waiver_required"
    assert provider.calls["append"] == 1
    assert provider.appended_rows[0][3] == "Card Replaced"
    assert "Disabled 1 previous active card" in provider.appended_rows[0][6]


def test_prepare_card_link_allows_an_account_with_an_existing_card():
    target = member(card="OLDCARD", person_id="person_member", student_id="999222")
    provider = FakeProvider(users=[target])
    result = backend_for(provider).prepare_card_link("999222")
    assert result.outcome == "link_ready"
    assert result.display_name == "Test Maker"


def test_duplicate_member_card_is_rejected():
    target = member(card="", person_id="person_member", student_id="A12345678")
    other = member(card="NEWCARD", person_id="person_other", student_id="A11111111")
    staff = member(card="STAFFCARD", person_id="person_staff", student_id="A87654321")
    provider = FakeProvider(users=[target, other, staff])
    result = backend_for(provider).link_card("A12345678", "NEWCARD", "STAFFCARD", {"A87654321"})
    assert result.outcome == "card_link_error"
    assert provider.calls["append"] == 0


def test_group_onboarding_connects_first_card_and_checks_member_in():
    target = member(card="", person_id="person_member", student_id="A12345678")
    provider = FakeProvider(users=[target], waivers=[signed_waiver()])
    provider.group_request = {
        "request_id": "link_1", "person_id": "person_member", "display_name": "Test Maker",
        "requested_by": "staff@example.edu", "expires_at": "2026-08-14T15:00:00",
    }
    result = backend_for(provider).complete_group_link(provider.group_request, "NEWCARD")
    assert result.outcome == "group_card_linked"
    assert result.display_name == "Test Maker"
    assert [row[3] for row in provider.appended_rows] == ["Card Linked", "User Checkin"]
    assert provider.group_updates[-1][1] == "Completed"
    assert user_has_card_digest(provider.users[0], provider.card_digest("NEWCARD"))


def test_group_onboarding_refuses_an_account_with_an_active_card():
    target = member(card="OLDCARD", person_id="person_member", student_id="A12345678")
    provider = FakeProvider(users=[target], waivers=[signed_waiver()])
    provider.group_request = {
        "request_id": "link_1", "person_id": "person_member", "display_name": "Test Maker",
        "requested_by": "staff@example.edu", "expires_at": "2026-08-14T15:00:00",
    }
    result = backend_for(provider).complete_group_link(provider.group_request, "NEWCARD")
    assert result.outcome == "group_link_error"
    assert "already has an active card" in result.message
    assert provider.appended_rows == []
    assert provider.group_updates[-1][1] == "Rejected"
