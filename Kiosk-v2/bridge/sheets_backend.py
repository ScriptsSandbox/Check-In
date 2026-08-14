"""Normalized Google Sheets check-in backend for the local kiosk bridge.

Raw card UIDs stay inside this local process. The production database stores
only keyed card digests and short display suffixes. Waivers remain read-only in
the existing Waiver Signatures SIO spreadsheet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import hmac
import logging
import os
from pathlib import Path
from threading import Lock
import time
from typing import Any, Callable, Protocol
from uuid import uuid4


LOGGER = logging.getLogger("sandbox-scanner.sheets")


@dataclass(frozen=True)
class CheckInResult:
    outcome: str
    display_name: str | None = None
    message: str = ""
    visit_count: int | None = None
    person_id: str | None = None
    profile: dict[str, str] = field(default_factory=dict)
    timings_ms: dict[str, int] = field(default_factory=dict)


class SheetsProvider(Protocol):
    def user_records(self) -> list[dict[str, Any]]: ...
    def waiver_records(self) -> list[dict[str, Any]]: ...
    def activity_rows(self) -> list[list[Any]]: ...
    def append_activity(self, row: list[Any]) -> None: ...
    def update_user_card(self, identifier: str, card_uid: str) -> dict[str, Any]: ...
    def update_profile(self, person_id: str, field: str, value: str) -> dict[str, str]: ...
    def card_digest(self, card_uid: str) -> str: ...


def normalize_person_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("+e?", "")[:9]
    return normalized[1:] if normalized.startswith("a") else normalized


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_card_uid(value: Any) -> str:
    return str(value or "").strip().upper()


def normalized_user_identifiers(record: dict[str, Any]) -> set[str]:
    values = record.get("Identifiers") or [record.get("Student ID")]
    if isinstance(values, str):
        values = [values]
    return {normalized for value in values if (normalized := normalize_person_id(value))}


def normalized_card_digests(record: dict[str, Any]) -> set[str]:
    values = record.get("Card Digests") or [record.get("Card Digest")]
    if isinstance(values, str):
        values = [values]
    return {str(value).strip().lower() for value in values if str(value).strip()}


def user_has_card_digest(record: dict[str, Any], digest: str) -> bool:
    return str(digest).strip().lower() in normalized_card_digests(record)


def users_matching_identifier(users: list[dict[str, Any]], identifier: Any) -> list[dict[str, Any]]:
    normalized = normalize_person_id(identifier)
    if not normalized:
        return []
    return [record for record in users if normalized in normalized_user_identifiers(record)]


def elapsed_ms(started_at: float) -> int:
    return round((time.monotonic() - started_at) * 1000)


def required_secret() -> str:
    inline = os.getenv("CARD_HMAC_SECRET", "").strip()
    secret_file = os.getenv("CARD_HMAC_SECRET_FILE", "").strip()
    if inline:
        return inline
    if secret_file:
        return Path(secret_file).read_text(encoding="utf-8").strip()
    raise RuntimeError("CARD_HMAC_SECRET or CARD_HMAC_SECRET_FILE is required")


class GoogleSheetsProvider:
    """Lazy, thread-safe access to the normalized database and waiver source."""

    def __init__(
        self,
        credentials_path: str,
        database_id: str,
        waiver_sheet_name: str,
        card_hmac_secret: str,
        cache_seconds: int = 300,
        activity_cache_seconds: int = 3600,
    ) -> None:
        self.credentials_path = credentials_path
        self.database_id = database_id
        self.waiver_sheet_name = waiver_sheet_name
        self.card_hmac_secret = card_hmac_secret
        self.cache_seconds = cache_seconds
        self.activity_cache_seconds = activity_cache_seconds
        self._lock = Lock()
        self._people_sheet: Any = None
        self._identifiers_sheet: Any = None
        self._cards_sheet: Any = None
        self._registrations_sheet: Any = None
        self._visits_sheet: Any = None
        self._waiver_sheet: Any = None
        self._users: list[dict[str, Any]] | None = None
        self._waivers: list[dict[str, Any]] | None = None
        self._activity_rows: list[list[Any]] | None = None
        self._cache_expires_at = 0.0
        self._activity_cache_expires_at = 0.0

    @classmethod
    def from_environment(cls) -> "GoogleSheetsProvider":
        credentials_path = os.getenv("SHEETS_CREDENTIALS_PATH", "").strip()
        database_id = os.getenv("SHEETS_DATABASE_ID", "").strip()
        if not credentials_path or not database_id:
            raise RuntimeError("SHEETS_CREDENTIALS_PATH and SHEETS_DATABASE_ID are required")
        return cls(
            credentials_path=credentials_path,
            database_id=database_id,
            waiver_sheet_name=os.getenv("SHEETS_WAIVER_DB_NAME", "Waiver Signatures SIO"),
            card_hmac_secret=required_secret(),
            cache_seconds=int(os.getenv("SHEETS_CACHE_SECONDS", "300")),
            activity_cache_seconds=int(os.getenv("SHEETS_ACTIVITY_CACHE_SECONDS", "3600")),
        )

    def card_digest(self, card_uid: str) -> str:
        return hmac.new(
            self.card_hmac_secret.encode("utf-8"),
            normalize_card_uid(card_uid).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _connect(self) -> None:
        if self._visits_sheet is not None:
            return
        import gspread

        client = gspread.service_account(filename=self.credentials_path)
        database = client.open_by_key(self.database_id)
        self._people_sheet = database.worksheet("People")
        self._identifiers_sheet = database.worksheet("Identifiers")
        self._cards_sheet = database.worksheet("Cards")
        self._registrations_sheet = database.worksheet("Registrations")
        self._visits_sheet = database.worksheet("Visits")
        self._waiver_sheet = client.open(self.waiver_sheet_name).sheet1

    def _refresh_people_if_needed(self) -> None:
        now = time.monotonic()
        if self._users is not None and now < self._cache_expires_at:
            return
        self._connect()
        people = self._people_sheet.get_all_records(numericise_ignore=["all"])
        identifiers = self._identifiers_sheet.get_all_records(numericise_ignore=["all"])
        cards = self._cards_sheet.get_all_records(numericise_ignore=["all"])
        registrations = self._registrations_sheet.get_all_records(numericise_ignore=["all"])
        self._waivers = self._waiver_sheet.get_all_records(numericise_ignore=["all"])
        identifiers_by_person: dict[str, list[dict[str, Any]]] = {}
        cards_by_person: dict[str, list[dict[str, Any]]] = {}
        for record in identifiers:
            if str(record.get("Active", "")).lower() not in {"true", "1"}:
                continue
            identifiers_by_person.setdefault(str(record.get("Person ID", "")), []).append(record)
        for record in cards:
            if str(record.get("Status", "")).strip().lower() != "active":
                continue
            cards_by_person.setdefault(str(record.get("Person ID", "")), []).append(record)
        users = []
        for person in people:
            if str(person.get("Status", "")).strip().lower() != "active":
                continue
            person_id = str(person.get("Person ID", "")).strip()
            person_identifiers = identifiers_by_person.get(person_id, [])
            identity = next((r for r in person_identifiers if str(r.get("Type", "")).lower() != "email" and bool(r.get("Primary"))), None)
            if identity is None:
                identity = next((r for r in person_identifiers if str(r.get("Type", "")).lower() != "email"), None)
            email_record = next((r for r in person_identifiers if str(r.get("Type", "")).lower() == "email" and bool(r.get("Primary"))), None)
            aliases = [
                str(record.get("Normalized Value", "")).strip()
                for record in person_identifiers
                if str(record.get("Type", "")).strip().lower() != "email"
                and str(record.get("Normalized Value", "")).strip()
            ]
            person_cards = cards_by_person.get(person_id, [])
            card = person_cards[-1] if person_cards else {}
            card_digests = tuple(dict.fromkeys(
                str(record.get("Card Digest", "")).strip().lower()
                for record in person_cards
                if str(record.get("Card Digest", "")).strip()
            ))
            registration = next((record for record in reversed(registrations) if str(record.get("Person ID", "")).strip() == person_id), {})
            users.append({
                "Person ID": person_id,
                "Name": str(person.get("Display Name", "")).strip(),
                "Student ID": str((identity or {}).get("Normalized Value", "")).strip(),
                "Identifiers": tuple(dict.fromkeys(aliases)),
                "Email Address": str(person.get("Primary Email", "") or (email_record or {}).get("Normalized Value", "")).strip(),
                "Card Digest": str(card.get("Card Digest", "")).strip().lower(),
                "Card Digests": card_digests,
                "Role": str(person.get("Role", "")).strip(),
                "Profile": {
                    "role": str(person.get("Role", "")).strip(),
                    "affiliation": str(registration.get("Program / Department", "")).strip(),
                    "anticipatedGraduation": str(registration.get("Anticipated Graduation", "")).strip(),
                },
            })
        self._users = users
        self._cache_expires_at = now + self.cache_seconds

    def _refresh_activity_if_needed(self) -> None:
        now = time.monotonic()
        if self._activity_rows is not None and now < self._activity_cache_expires_at:
            return
        self._connect()
        self._activity_rows = self._visits_sheet.get_all_values()
        self._activity_cache_expires_at = now + self.activity_cache_seconds

    def user_records(self) -> list[dict[str, Any]]:
        with self._lock:
            self._refresh_people_if_needed()
            return [dict(record) for record in self._users or []]

    def waiver_records(self) -> list[dict[str, Any]]:
        with self._lock:
            self._refresh_people_if_needed()
            return [dict(record) for record in self._waivers or []]

    def activity_rows(self) -> list[list[Any]]:
        with self._lock:
            self._refresh_activity_if_needed()
            return [list(row) for row in self._activity_rows or []]

    def append_activity(self, row: list[Any]) -> None:
        with self._lock:
            self._connect()
            self._visits_sheet.append_row(row, value_input_option="USER_ENTERED")
            if self._activity_rows is not None:
                self._activity_rows.append(list(row))
                self._activity_cache_expires_at = time.monotonic() + self.activity_cache_seconds

    def update_user_card(self, identifier: str, card_uid: str) -> dict[str, Any]:
        normalized_identifier = normalize_person_id(identifier)
        digest = self.card_digest(card_uid)
        normalized_uid = normalize_card_uid(card_uid)
        with self._lock:
            self._refresh_people_if_needed()
            users = self._users or []
            matches = users_matching_identifier(users, normalized_identifier)
            if len(matches) != 1:
                raise ValueError("The account could not be identified uniquely.")
            if any(user_has_card_digest(record, digest) for record in users):
                raise ValueError("That card is already connected to an account.")
            record = matches[0]
            self._connect()
            headers = self._cards_sheet.row_values(1)
            if "Disabled At" not in headers:
                self._cards_sheet.update_cell(1, len(headers) + 1, "Disabled At")
                headers.append("Disabled At")
            person_column = headers.index("Person ID")
            status_column = headers.index("Status")
            disabled_at_column = headers.index("Disabled At")
            rows = self._cards_sheet.get_all_values()
            replaced_rows = [
                row_number
                for row_number, row in enumerate(rows[1:], start=2)
                if len(row) > max(person_column, status_column)
                and str(row[person_column]).strip() == str(record["Person ID"]).strip()
                and str(row[status_column]).strip().lower() == "active"
            ]
            changed_at = datetime.now().isoformat(timespec="seconds")
            card_values = {
                "Card ID": "card_" + uuid4().hex,
                "Person ID": record["Person ID"],
                "Card Digest": digest,
                "Last Four": normalized_uid[-4:],
                "Status": "Active",
                "Linked At": changed_at,
                "Disabled At": "",
                "Source": "Kiosk v2 staff replacement",
                "Notes": f"Replaced {len(replaced_rows)} previous active card(s)",
            }
            self._cards_sheet.append_row(
                [card_values.get(header, "") for header in headers],
                value_input_option="USER_ENTERED",
            )
            for row_number in replaced_rows:
                self._cards_sheet.update_cell(row_number, status_column + 1, "Replaced")
                self._cards_sheet.update_cell(row_number, disabled_at_column + 1, changed_at)
            record["Card Digest"] = digest
            record["Card Digests"] = (digest,)
            record["Replaced Card Count"] = len(replaced_rows)
            self._cache_expires_at = time.monotonic() + self.cache_seconds
            return dict(record)

    def update_profile(self, person_id: str, field: str, value: str) -> dict[str, str]:
        field_headers = {
            "role": ("people", "Role"),
            "affiliation": ("registrations", "Program / Department"),
            "anticipatedGraduation": ("registrations", "Anticipated Graduation"),
        }
        if field not in field_headers:
            raise ValueError("That profile field cannot be updated.")
        safe_value = str(value).strip()
        if not safe_value or len(safe_value) > 120:
            raise ValueError("That profile answer is not valid.")
        if safe_value.startswith(("=", "+", "-", "@")):
            safe_value = "'" + safe_value

        with self._lock:
            self._refresh_people_if_needed()
            user = next((record for record in self._users or [] if record.get("Person ID") == person_id), None)
            if user is None:
                raise ValueError("That active Sandbox account could not be found.")
            profile = dict(user.get("Profile") or {})
            current = str(profile.get(field, "")).strip()
            if current == value:
                return profile

            sheet_name, header = field_headers[field]
            sheet = self._people_sheet if sheet_name == "people" else self._registrations_sheet
            headers = sheet.row_values(1)
            person_column = headers.index("Person ID")
            target_column = headers.index(header)
            rows = sheet.get_all_values()
            row_number = next((index + 1 for index in range(len(rows) - 1, 0, -1) if str(rows[index][person_column]).strip() == person_id), 0)
            if not row_number and sheet_name == "registrations":
                now = datetime.now().isoformat(timespec="seconds")
                named = {
                    "Registration ID": "registration_" + uuid4().hex,
                    "Person ID": person_id,
                    "Status": "Profile enrichment",
                    "Submitted At": now,
                    "Consent Version": "2026-08-11",
                    "Source": "Kiosk profile enrichment",
                }
                sheet.append_row([named.get(column, "") for column in headers], value_input_option="USER_ENTERED")
                row_number = len(rows) + 1
            if not row_number:
                raise ValueError("That active Sandbox account could not be found.")
            sheet.update_cell(row_number, target_column + 1, safe_value)
            if field == "role":
                updated_at = headers.index("Updated At")
                sheet.update_cell(row_number, updated_at + 1, datetime.now().isoformat(timespec="seconds"))
                user["Role"] = value
                if current and current != value:
                    registration_headers = self._registrations_sheet.row_values(1)
                    registration_rows = self._registrations_sheet.get_all_values()
                    registration_person_column = registration_headers.index("Person ID")
                    registration_row = next((index + 1 for index in range(len(registration_rows) - 1, 0, -1) if str(registration_rows[index][registration_person_column]).strip() == person_id), 0)
                    if registration_row:
                        for dependent_header in ("Program / Department", "Anticipated Graduation"):
                            self._registrations_sheet.update_cell(registration_row, registration_headers.index(dependent_header) + 1, "")
                    profile["affiliation"] = ""
                    profile["anticipatedGraduation"] = ""
            profile[field] = value
            user["Profile"] = profile
            self._cache_expires_at = time.monotonic() + self.cache_seconds
            return dict(profile)


class SheetsCheckInBackend:
    def __init__(self, provider: SheetsProvider, now: Callable[[], float] = time.time, local_datetime: Callable[[], datetime] = datetime.now) -> None:
        self.provider = provider
        self.now = now
        self.local_datetime = local_datetime

    def warm_up(self) -> dict[str, int]:
        total_started = time.monotonic()
        timings: dict[str, int] = {}
        for label, operation in (("users", self.provider.user_records), ("waivers", self.provider.waiver_records), ("activity", self.provider.activity_rows)):
            stage_started = time.monotonic()
            operation()
            timings[label] = elapsed_ms(stage_started)
        timings["total"] = elapsed_ms(total_started)
        return timings

    def check_in(self, uid: str) -> CheckInResult:
        total_started = time.monotonic()
        timings: dict[str, int] = {}
        digest = self.provider.card_digest(uid)
        stage_started = time.monotonic()
        user = next((record for record in self.provider.user_records() if user_has_card_digest(record, digest)), None)
        timings["user_lookup"] = elapsed_ms(stage_started)
        if user is None:
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="unknown_card", message="This card is not connected to a Sandbox account.", timings_ms=timings)
        return self._check_in_user(user, total_started, timings)

    def check_in_identifier(self, identifier: str) -> CheckInResult:
        total_started = time.monotonic()
        timings: dict[str, int] = {}
        normalized_identifier = normalize_person_id(identifier)
        stage_started = time.monotonic()
        matches = users_matching_identifier(self.provider.user_records(), normalized_identifier)
        timings["user_lookup"] = elapsed_ms(stage_started)
        if not matches:
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="unknown_identifier", message="We could not find that PID, TSN, or employee ID.", timings_ms=timings)
        if len(matches) > 1:
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="backend_error", message="More than one account uses that identifier. Please see staff.", timings_ms=timings)
        return self._check_in_user(matches[0], total_started, timings)

    def prepare_card_link(self, identifier: str) -> CheckInResult:
        normalized_identifier = normalize_person_id(identifier)
        matches = users_matching_identifier(self.provider.user_records(), normalized_identifier)
        if not matches:
            return CheckInResult(outcome="unknown_identifier", message="We could not find that PID, TSN, or employee ID.")
        if len(matches) > 1:
            return CheckInResult(outcome="card_link_error", message="More than one account uses that identifier. Please see an administrator.")
        target = matches[0]
        return CheckInResult(outcome="link_ready", display_name=str(target.get("Name", "")).strip() or "Sandbox member", message="Ask designated staff to tap their own card.")

    def update_profile(self, person_id: str, field: str, value: str) -> CheckInResult:
        try:
            profile = self.provider.update_profile(person_id, field, value)
        except ValueError as error:
            return CheckInResult(outcome="profile_error", person_id=person_id, message=str(error))
        return CheckInResult(
            outcome="profile_updated",
            person_id=person_id,
            profile=profile,
            message="Profile updated.",
        )

    def link_card(self, identifier: str, card_uid: str, staff_card_uid: str, designated_staff_ids: set[str]) -> CheckInResult:
        total_started = time.monotonic()
        timings: dict[str, int] = {}
        normalized_identifier = normalize_person_id(identifier)
        member_digest = self.provider.card_digest(card_uid)
        staff_digest = self.provider.card_digest(staff_card_uid)
        stage_started = time.monotonic()
        users = self.provider.user_records()
        staff = next((record for record in users if user_has_card_digest(record, staff_digest)), None)
        staff_ids = normalized_user_identifiers(staff) if staff else set()
        allowed_staff = {normalize_person_id(value) for value in designated_staff_ids}
        timings["staff_lookup"] = elapsed_ms(stage_started)
        if not staff or not staff_ids.intersection(allowed_staff) or staff_digest == member_digest:
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="staff_unauthorized", message="That card is not authorized to connect member cards.", timings_ms=timings)
        stage_started = time.monotonic()
        try:
            target = self.provider.update_user_card(normalized_identifier, card_uid)
        except ValueError as error:
            timings["card_update"] = elapsed_ms(stage_started)
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="card_link_error", message=str(error), timings_ms=timings)
        timings["card_update"] = elapsed_ms(stage_started)
        display_name = str(target.get("Name", "")).strip() or "Sandbox member"
        staff_name = str(staff.get("Name", "")).strip() or "Designated staff"
        replaced_count = int(target.get("Replaced Card Count", 0) or 0)
        self.provider.append_activity([
            "visit_" + uuid4().hex,
            target.get("Person ID", ""),
            self.local_datetime().isoformat(timespec="seconds"),
            "Card Replaced" if replaced_count else "Card Linked",
            staff_name,
            "",
            f"Disabled {replaced_count} previous active card(s)." if replaced_count else "",
            "Kiosk v2",
            "",
        ])
        timings["total"] = elapsed_ms(total_started)
        return CheckInResult(outcome="card_linked", display_name=display_name, message="Card connected. The member can now check in.", timings_ms=timings)

    def _check_in_user(self, user: dict[str, Any], total_started: float, timings: dict[str, int]) -> CheckInResult:
        user_ids = normalized_user_identifiers(user)
        user_email = normalize_email(user.get("Email Address"))
        stage_started = time.monotonic()
        waivers = self.provider.waiver_records()
        waiver_found = any((normalize_person_id(waiver.get("A_Number")) in user_ids) or (bool(user_email) and normalize_email(waiver.get("Email")) == user_email) for waiver in waivers)
        timings["waiver_lookup"] = elapsed_ms(stage_started)
        if not waiver_found:
            timings["total"] = elapsed_ms(total_started)
            return CheckInResult(outcome="waiver_required", message="A current waiver is required before check-in.", timings_ms=timings)
        display_name = str(user.get("Name", "")).strip() or "Sandbox member"
        person_id = str(user.get("Person ID", "")).strip()
        local_now = self.local_datetime()
        today = local_now.date().isoformat()
        stage_started = time.monotonic()
        activity_rows = self.provider.activity_rows()
        visit_dates = {
            str(row[2]).split("T")[0].split()[0]
            for row in activity_rows[1:]
            if len(row) >= 4 and str(row[1]).strip() == person_id and str(row[3]).strip() == "User Checkin" and str(row[2]).strip()
        }
        timings["activity_lookup"] = elapsed_ms(stage_started)
        visit_count = len(visit_dates | {today})
        row = [
            "visit_" + uuid4().hex,
            person_id,
            local_now.isoformat(timespec="seconds"),
            "User Checkin",
            "",
            "",
            "",
            "Kiosk v2",
            "",
        ]
        stage_started = time.monotonic()
        self.provider.append_activity(row)
        timings["activity_append"] = elapsed_ms(stage_started)
        timings["total"] = elapsed_ms(total_started)
        return CheckInResult(
            outcome="success",
            display_name=display_name,
            message="Check-in recorded.",
            visit_count=visit_count,
            person_id=person_id,
            profile=dict(user.get("Profile") or {}),
            timings_ms=timings,
        )
