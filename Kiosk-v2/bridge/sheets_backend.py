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
from threading import Lock, RLock, Thread
import time
from typing import Any, Callable, Protocol
from uuid import uuid4

from visit_outbox import VisitOutbox


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
    def activity_exists(self, visit_id: str) -> bool: ...
    def append_activity(self, row: list[Any]) -> None: ...
    def update_user_card(self, identifier: str, card_uid: str) -> dict[str, Any]: ...
    def update_user_card_by_person(self, person_id: str, card_uid: str) -> dict[str, Any]: ...
    def pending_group_link_request(self) -> dict[str, Any] | None: ...
    def mark_group_link_request(self, request_id: str, status: str, message: str) -> None: ...
    def update_profile(self, person_id: str, field: str, value: str) -> dict[str, str]: ...
    def card_digest(self, card_uid: str) -> str: ...


def normalize_person_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("+e?", "")[:9]
    return normalized[1:] if normalized.startswith("a") else normalized


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_card_uid(value: Any) -> str:
    return str(value or "").strip().upper()


def _sheet_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        pass
    for pattern in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


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
        scripps_waiver_tab_name: str = "Scripps Waivers",
    ) -> None:
        self.credentials_path = credentials_path
        self.database_id = database_id
        self.waiver_sheet_name = waiver_sheet_name
        self.card_hmac_secret = card_hmac_secret
        self.cache_seconds = cache_seconds
        self.activity_cache_seconds = activity_cache_seconds
        self.scripps_waiver_tab_name = scripps_waiver_tab_name
        self._lock = RLock()
        self._connect_lock = Lock()
        self._people_refresh_lock = Lock()
        self._activity_refresh_lock = Lock()
        self._group_link_lock = Lock()
        self._people_refresh_thread: Thread | None = None
        self._activity_refresh_thread: Thread | None = None
        self._last_people_refresh_error = ""
        self._last_activity_refresh_error = ""
        self._people_sheet: Any = None
        self._database: Any = None
        self._identifiers_sheet: Any = None
        self._cards_sheet: Any = None
        self._registrations_sheet: Any = None
        self._visits_sheet: Any = None
        self._waiver_sheet: Any = None
        self._scripps_waiver_sheet: Any = None
        self._kiosk_links_sheet: Any = None
        self._users: list[dict[str, Any]] | None = None
        self._waivers: list[dict[str, Any]] | None = None
        self._scripps_waivers: list[dict[str, Any]] | None = None
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
            scripps_waiver_tab_name=os.getenv("SCRIPPS_WAIVER_TAB_NAME", "Scripps Waivers").strip(),
        )

    def additional_waiver_found(self, user: dict[str, Any]) -> bool:
        self._refresh_people_if_needed()
        user_ids = normalized_user_identifiers(user)
        user_email = normalize_email(user.get("Email Address"))
        with self._lock:
            scripps_waivers = [dict(record) for record in self._scripps_waivers or []]
        return any(
            str(record.get("Status", "")).strip().lower() == "completed"
            and (
                normalize_person_id(record.get("Normalized Identifier") or record.get("Participant ID")) in user_ids
                or (bool(user_email) and normalize_email(record.get("Participant Email")) == user_email)
            )
            for record in scripps_waivers
        )

    def card_digest(self, card_uid: str) -> str:
        return hmac.new(
            self.card_hmac_secret.encode("utf-8"),
            normalize_card_uid(card_uid).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _connect(self) -> None:
        with self._connect_lock:
            if self._visits_sheet is not None:
                return
            import gspread

            client = gspread.service_account(filename=self.credentials_path)
            database = client.open_by_key(self.database_id)
            self._database = database
            self._people_sheet = database.worksheet("People")
            self._identifiers_sheet = database.worksheet("Identifiers")
            self._cards_sheet = database.worksheet("Cards")
            self._registrations_sheet = database.worksheet("Registrations")
            self._visits_sheet = database.worksheet("Visits")
            self._waiver_sheet = client.open(self.waiver_sheet_name).sheet1
            try:
                self._scripps_waiver_sheet = database.worksheet(self.scripps_waiver_tab_name)
            except gspread.WorksheetNotFound:
                self._scripps_waiver_sheet = None
            try:
                self._kiosk_links_sheet = database.worksheet("Kiosk Link Requests")
            except gspread.WorksheetNotFound:
                self._kiosk_links_sheet = None

    def _load_people_snapshot(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        self._connect()
        people = self._people_sheet.get_all_records(numericise_ignore=["all"])
        identifiers = self._identifiers_sheet.get_all_records(numericise_ignore=["all"])
        cards = self._cards_sheet.get_all_records(numericise_ignore=["all"])
        registrations = self._registrations_sheet.get_all_records(numericise_ignore=["all"])
        waivers = self._waiver_sheet.get_all_records(numericise_ignore=["all"])
        scripps_waivers = self._scripps_waiver_sheet.get_all_records(numericise_ignore=["all"]) if self._scripps_waiver_sheet else []
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
        return users, waivers, scripps_waivers

    def refresh_people_now(self) -> None:
        """Synchronously replace the people/waiver snapshot.

        Normal reads use the previous snapshot while this network work happens.
        This blocking entry point is reserved for startup and one explicit retry
        after an unknown card or identifier.
        """
        with self._people_refresh_lock:
            users, waivers, scripps_waivers = self._load_people_snapshot()
            with self._lock:
                self._users = users
                self._waivers = waivers
                self._scripps_waivers = scripps_waivers
                self._cache_expires_at = time.monotonic() + self.cache_seconds
                self._last_people_refresh_error = ""

    def _refresh_people_in_background(self) -> None:
        try:
            self.refresh_people_now()
            LOGGER.info("People and waiver snapshot refreshed in the background")
        except Exception as error:
            with self._lock:
                self._last_people_refresh_error = str(error)
            LOGGER.exception("Background people and waiver refresh failed; keeping the previous snapshot")
        finally:
            with self._lock:
                self._people_refresh_thread = None

    def _refresh_people_if_needed(self) -> None:
        now = time.monotonic()
        with self._lock:
            has_snapshot = self._users is not None
            fresh = has_snapshot and now < self._cache_expires_at
            refresh_running = self._people_refresh_thread is not None
        if fresh:
            return
        if not has_snapshot:
            self.refresh_people_now()
            return
        if refresh_running:
            return
        thread = Thread(target=self._refresh_people_in_background, name="sheets-people-refresh", daemon=True)
        with self._lock:
            if self._people_refresh_thread is not None:
                return
            self._people_refresh_thread = thread
        thread.start()

    def refresh_activity_now(self) -> None:
        with self._activity_refresh_lock:
            self._connect()
            rows = self._visits_sheet.get_all_values()
            with self._lock:
                self._activity_rows = rows
                self._activity_cache_expires_at = time.monotonic() + self.activity_cache_seconds
                self._last_activity_refresh_error = ""

    def _refresh_activity_in_background(self) -> None:
        try:
            self.refresh_activity_now()
            LOGGER.info("Visit history snapshot refreshed in the background")
        except Exception as error:
            with self._lock:
                self._last_activity_refresh_error = str(error)
            LOGGER.exception("Background visit history refresh failed; keeping the previous snapshot")
        finally:
            with self._lock:
                self._activity_refresh_thread = None

    def _refresh_activity_if_needed(self) -> None:
        now = time.monotonic()
        with self._lock:
            has_snapshot = self._activity_rows is not None
            fresh = has_snapshot and now < self._activity_cache_expires_at
            refresh_running = self._activity_refresh_thread is not None
        if fresh:
            return
        if not has_snapshot:
            self.refresh_activity_now()
            return
        if refresh_running:
            return
        thread = Thread(target=self._refresh_activity_in_background, name="sheets-activity-refresh", daemon=True)
        with self._lock:
            if self._activity_refresh_thread is not None:
                return
            self._activity_refresh_thread = thread
        thread.start()

    def user_records(self) -> list[dict[str, Any]]:
        self._refresh_people_if_needed()
        with self._lock:
            return [dict(record) for record in self._users or []]

    def waiver_records(self) -> list[dict[str, Any]]:
        self._refresh_people_if_needed()
        with self._lock:
            return [dict(record) for record in self._waivers or []]

    def activity_rows(self) -> list[list[Any]]:
        self._refresh_activity_if_needed()
        with self._lock:
            return [list(row) for row in self._activity_rows or []]

    def append_activity(self, row: list[Any]) -> None:
        with self._lock:
            self._connect()
            self._visits_sheet.append_row(row, value_input_option="USER_ENTERED")
            if self._activity_rows is not None:
                self._activity_rows.append(list(row))
                self._activity_cache_expires_at = time.monotonic() + self.activity_cache_seconds

    def activity_exists(self, visit_id: str) -> bool:
        """Confirm a Visit ID directly against Sheets after an ambiguous write.

        Normal first-attempt writes do not pay for this read. It is used only
        when a previous append raised and may have succeeded remotely.
        """
        target = str(visit_id).strip()
        if not target:
            return False
        with self._lock:
            self._connect()
            if self._activity_rows and any(row and str(row[0]).strip() == target for row in self._activity_rows[1:]):
                return True
            return target in {str(value).strip() for value in self._visits_sheet.col_values(1)[1:]}

    def _insert_verified_card(self, headers: list[str], card_values: dict[str, Any]) -> None:
        """Insert a card as a real sheet row and confirm it survived the write.

        Cards deliberately use ``insert_row`` instead of ``append_row``. Google
        Sheets' table-range detection can occasionally choose the final existing
        row as the append target when a sheet has formatting or partially blank
        columns. Inserting directly below the header has an unambiguous target and
        preserves every prior card-history row.

        A network error can be ambiguous: the remote insert may have completed
        even though the client did not receive the response. In either case we
        read the sheet back and accept the write only when the unique Card ID,
        person, digest, and Active status are all present together.
        """
        row = [card_values.get(header, "") for header in headers]
        write_error: Exception | None = None
        try:
            self._cards_sheet.insert_row(row, index=2, value_input_option="USER_ENTERED")
        except Exception as exc:  # The readback below resolves ambiguous remote writes.
            write_error = exc

        rows = self._cards_sheet.get_all_values()
        card_id_column = headers.index("Card ID")
        person_column = headers.index("Person ID")
        digest_column = headers.index("Card Digest")
        status_column = headers.index("Status")
        verified = any(
            len(existing) > max(card_id_column, person_column, digest_column, status_column)
            and str(existing[card_id_column]).strip() == str(card_values["Card ID"]).strip()
            and str(existing[person_column]).strip() == str(card_values["Person ID"]).strip()
            and str(existing[digest_column]).strip().lower() == str(card_values["Card Digest"]).strip().lower()
            and str(existing[status_column]).strip().lower() == "active"
            for existing in rows[1:]
        )
        if verified:
            if write_error is not None:
                LOGGER.warning("Card insert returned an error but readback verified Card ID %s", card_values["Card ID"])
            return
        if write_error is not None:
            LOGGER.error("Card insert failed and readback did not find Card ID %s: %s", card_values["Card ID"], write_error)
        raise ValueError("The card was not saved. Ask staff to select the member and try again.")

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
            card_id_column = headers.index("Card ID")
            replaced_card_ids = [
                str(row[card_id_column]).strip()
                for row in rows[1:]
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
                "Source System": "Kiosk v2 staff replacement",
                "Source Row": f"Replaced {len(replaced_card_ids)} previous active card(s)",
                "Notes": f"Replaced {len(replaced_card_ids)} previous active card(s)",
            }
            self._insert_verified_card(headers, card_values)
            current_rows = self._cards_sheet.get_all_values()
            replaced_card_id_set = set(replaced_card_ids)
            for row_number, row in enumerate(current_rows[1:], start=2):
                if len(row) > card_id_column and str(row[card_id_column]).strip() in replaced_card_id_set:
                    self._cards_sheet.update_cell(row_number, status_column + 1, "Replaced")
                    self._cards_sheet.update_cell(row_number, disabled_at_column + 1, changed_at)
            record["Card Digest"] = digest
            record["Card Digests"] = (digest,)
            record["Replaced Card Count"] = len(replaced_card_ids)
            self._cache_expires_at = time.monotonic() + self.cache_seconds
            return dict(record)

    def update_user_card_by_person(self, person_id: str, card_uid: str) -> dict[str, Any]:
        digest = self.card_digest(card_uid)
        normalized_uid = normalize_card_uid(card_uid)
        with self._lock:
            self._refresh_people_if_needed()
            users = self._users or []
            record = next((user for user in users if str(user.get("Person ID", "")).strip() == str(person_id).strip()), None)
            if record is None:
                raise ValueError("That active Sandbox account could not be found.")
            if normalized_card_digests(record):
                raise ValueError("This account already has an active card. Use the replacement-card workflow instead.")
            if any(user_has_card_digest(user, digest) for user in users):
                raise ValueError("That card is already connected to an account.")
            self._connect()
            headers = self._cards_sheet.row_values(1)
            changed_at = datetime.now().isoformat(timespec="seconds")
            card_values = {
                "Card ID": "card_" + uuid4().hex,
                "Person ID": record["Person ID"],
                "Card Digest": digest,
                "Last Four": normalized_uid[-4:],
                "Status": "Active",
                "Linked At": changed_at,
                "Disabled At": "",
                "Source": "Kiosk v2 group onboarding",
                "Source System": "Kiosk v2 group onboarding",
                "Source Row": "First card connected from Staff Desk queue",
                "Notes": "First card connected from Staff Desk queue",
            }
            self._insert_verified_card(headers, card_values)
            record["Card Digest"] = digest
            record["Card Digests"] = (digest,)
            self._cache_expires_at = time.monotonic() + self.cache_seconds
            return dict(record)

    def pending_group_link_request(self) -> dict[str, Any] | None:
        with self._group_link_lock:
            self._connect()
            sheet = self._kiosk_links_sheet
            if sheet is None:
                return None
            records = sheet.get_all_records(numericise_ignore=["all"])
            now = datetime.now()
            for record in reversed(records):
                if str(record.get("Status", "")).strip().lower() != "pending":
                    continue
                expires_at = _sheet_datetime(record.get("Expires At"))
                if expires_at is not None and expires_at <= now:
                    continue
                return {
                    "request_id": str(record.get("Request ID", "")).strip(),
                    "person_id": str(record.get("Person ID", "")).strip(),
                    "display_name": str(record.get("Display Name", "")).strip(),
                    "requested_by": str(record.get("Requested By", "")).strip(),
                    "expires_at": expires_at.isoformat(timespec="seconds") if expires_at else "",
                }
            return None

    def mark_group_link_request(self, request_id: str, status: str, message: str) -> None:
        with self._group_link_lock:
            self._connect()
            sheet = self._kiosk_links_sheet
            if sheet is None:
                raise ValueError("The kiosk request sheet could not be found.")
            headers = sheet.row_values(1)
            rows = sheet.get_all_values()
            id_column = headers.index("Request ID")
            row_number = next((index + 1 for index in range(len(rows) - 1, 0, -1) if len(rows[index]) > id_column and str(rows[index][id_column]).strip() == request_id), 0)
            if not row_number:
                raise ValueError("That kiosk request could not be found.")
            updates = {
                "Status": status,
                "Completed At": datetime.now().isoformat(timespec="seconds") if status.lower() != "pending" else "",
                "Message": message,
            }
            for header, value in updates.items():
                sheet.update_cell(row_number, headers.index(header) + 1, value)

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
    def __init__(
        self,
        provider: SheetsProvider,
        now: Callable[[], float] = time.time,
        local_datetime: Callable[[], datetime] = datetime.now,
        outbox: VisitOutbox | None = None,
    ) -> None:
        self.provider = provider
        self.now = now
        self.local_datetime = local_datetime
        self.outbox = outbox

    def record_activity(self, row: list[Any]) -> None:
        if self.outbox is None:
            self.provider.append_activity(row)
            return
        self.outbox.enqueue(row)

    def sync_pending_activity(self, limit: int = 25) -> dict[str, Any]:
        if self.outbox is None:
            return {"pending": 0, "synced": 0, "last_error": ""}
        synced = 0
        last_error = ""
        for pending in self.outbox.pending(limit=limit):
            try:
                if pending.attempts and self.provider.activity_exists(pending.visit_id):
                    self.outbox.mark_synced(pending.visit_id)
                    synced += 1
                    continue
                self.provider.append_activity(pending.row)
                self.outbox.mark_synced(pending.visit_id)
                synced += 1
            except Exception as error:
                last_error = str(error)
                self.outbox.mark_failed(pending.visit_id, error)
                LOGGER.exception("Activity outbox sync failed for %s; it will be retried", pending.visit_id)
                break
        return {**self.outbox.status(), "synced": synced, "last_error": last_error or self.outbox.status()["last_error"]}

    def activity_sync_status(self) -> dict[str, Any]:
        if self.outbox is None:
            return {"pending": 0, "oldest_pending_seconds": None, "last_synced_at": None, "last_error": "", "durable": False}
        return {**self.outbox.status(), "durable": True}

    def close(self) -> None:
        if self.outbox is not None:
            self.outbox.close()

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
            refresh = getattr(self.provider, "refresh_people_now", None)
            if callable(refresh):
                stage_started = time.monotonic()
                refresh()
                timings["unknown_card_refresh"] = elapsed_ms(stage_started)
                user = next((record for record in self.provider.user_records() if user_has_card_digest(record, digest)), None)
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
            refresh = getattr(self.provider, "refresh_people_now", None)
            if callable(refresh):
                stage_started = time.monotonic()
                refresh()
                timings["unknown_identifier_refresh"] = elapsed_ms(stage_started)
                matches = users_matching_identifier(self.provider.user_records(), normalized_identifier)
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

    def pending_group_link_request(self) -> dict[str, Any] | None:
        return self.provider.pending_group_link_request()

    def cancel_group_link_request(self, request_id: str) -> None:
        self.provider.mark_group_link_request(request_id, "Cancelled", "Cancelled at the kiosk")

    def complete_group_link(self, request: dict[str, Any], card_uid: str) -> CheckInResult:
        request_id = str(request.get("request_id", "")).strip()
        person_id = str(request.get("person_id", "")).strip()
        requested_by = str(request.get("requested_by", "")).strip() or "Authorized staff"
        current = self.provider.pending_group_link_request()
        if not request_id or not current or current.get("request_id") != request_id or current.get("person_id") != person_id:
            return CheckInResult(outcome="group_link_error", message="That card-connection request expired. Ask staff to select the account again.")
        target = next((user for user in self.provider.user_records() if str(user.get("Person ID", "")).strip() == person_id), None)
        if target is None:
            return CheckInResult(outcome="group_link_error", message="That active Sandbox account could not be found.")
        if normalized_card_digests(target):
            self.provider.mark_group_link_request(request_id, "Rejected", "Account already has an active card")
            return CheckInResult(outcome="group_link_error", message="This account already has an active card. Ask staff to use the replacement-card workflow.")
        if not self._waiver_found(target):
            self.provider.mark_group_link_request(request_id, "Rejected", "Waiver no longer verified")
            return CheckInResult(outcome="group_link_error", message="A signed waiver could not be verified. Please see staff.")
        try:
            linked = self.provider.update_user_card_by_person(person_id, card_uid)
        except ValueError as error:
            return CheckInResult(outcome="group_link_error", message=str(error))
        linked_at = self.local_datetime().isoformat(timespec="seconds")
        self.record_activity([
            "visit_" + uuid4().hex, person_id, linked_at, "Card Linked", requested_by, "Group onboarding",
            "First card connected from Staff Desk queue", "Kiosk v2", "",
        ])
        check_in = self._check_in_user(linked, time.monotonic(), {})
        if check_in.outcome != "success":
            self.provider.mark_group_link_request(request_id, "Error", check_in.message or "Check-in failed after card connection")
            return CheckInResult(outcome="group_link_error", display_name=check_in.display_name, message=check_in.message)
        self.provider.mark_group_link_request(request_id, "Completed", "Card connected and check-in recorded")
        return CheckInResult(
            outcome="group_card_linked",
            display_name=check_in.display_name,
            message="Card connected and check-in recorded.",
            visit_count=check_in.visit_count,
            person_id=check_in.person_id,
            profile=check_in.profile,
            timings_ms=check_in.timings_ms,
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
        self.record_activity([
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

    def _waiver_found(self, user: dict[str, Any]) -> bool:
        user_ids = normalized_user_identifiers(user)
        user_email = normalize_email(user.get("Email Address"))
        legacy_found = any(
            (normalize_person_id(waiver.get("A_Number")) in user_ids)
            or (bool(user_email) and normalize_email(waiver.get("Email")) == user_email)
            for waiver in self.provider.waiver_records()
        )
        if legacy_found:
            return True
        additional_checker = getattr(self.provider, "additional_waiver_found", None)
        return bool(additional_checker and additional_checker(user))

    def _check_in_user(self, user: dict[str, Any], total_started: float, timings: dict[str, int]) -> CheckInResult:
        stage_started = time.monotonic()
        waiver_found = self._waiver_found(user)
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
        if self.outbox is not None:
            visit_dates.update(self.outbox.visit_dates(person_id))
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
        self.record_activity(row)
        timings["activity_commit"] = elapsed_ms(stage_started)
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
