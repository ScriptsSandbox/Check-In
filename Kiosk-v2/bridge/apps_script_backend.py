"""Private Apps Script API backend for the kiosk bridge.

Raw card UIDs never leave the Raspberry Pi. They are converted to keyed HMAC
digests before this client contacts the UCSD-owned Apps Script deployment.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import time
from typing import Any
from urllib.request import Request, urlopen

from sheets_backend import CheckInResult, normalize_card_uid, required_secret


def _required_value(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _required_file_secret(env_name: str) -> str:
    path = _required_value(env_name)
    value = Path(path).read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"{env_name} points to an empty file")
    return value


class AppsScriptCheckInBackend:
    def __init__(
        self,
        url: str,
        api_key: str,
        card_hmac_secret: str,
        timeout_seconds: float = 20,
    ) -> None:
        self.url = url
        self.api_key = api_key
        self.card_hmac_secret = card_hmac_secret
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> "AppsScriptCheckInBackend":
        return cls(
            url=_required_value("KIOSK_APPS_SCRIPT_URL"),
            api_key=_required_file_secret("KIOSK_API_KEY_FILE"),
            card_hmac_secret=required_secret(),
            timeout_seconds=float(os.getenv("KIOSK_APPS_SCRIPT_TIMEOUT_SECONDS", "20")),
        )

    def card_digest(self, card_uid: str) -> str:
        return hmac.new(
            self.card_hmac_secret.encode("utf-8"),
            normalize_card_uid(card_uid).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _request(self, action: str, **values: Any) -> tuple[dict[str, Any], int]:
        started_at = time.monotonic()
        body = json.dumps({"apiKey": self.api_key, "action": action, **values}).encode("utf-8")
        request = Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("Apps Script returned an invalid response")
        return payload, round((time.monotonic() - started_at) * 1000)

    @staticmethod
    def _result(payload: dict[str, Any], request_ms: int) -> CheckInResult:
        return CheckInResult(
            outcome=str(payload.get("outcome") or "backend_error"),
            display_name=payload.get("displayName"),
            message=str(payload.get("message") or ""),
            visit_count=payload.get("visitCount"),
            timings_ms={"apps_script": request_ms},
        )

    def warm_up(self) -> dict[str, int]:
        payload, request_ms = self._request("status")
        if not payload.get("ok") or payload.get("outcome") != "ready":
            raise RuntimeError("Apps Script kiosk API is not ready")
        return {"apps_script": request_ms}

    def check_in(self, card_uid: str) -> CheckInResult:
        payload, request_ms = self._request("check_in_card", cardDigest=self.card_digest(card_uid))
        return self._result(payload, request_ms)

    def _identifier_request(self, action: str, identifier: str) -> tuple[dict[str, Any], int]:
        payload, request_ms = self._request(action, identifier=identifier)
        # Google Sheets may store an employee ID such as 000023 as 23.
        # Try the exact ID first, then retry only a numeric leading-zero variant.
        if (
            payload.get("outcome") == "unknown_identifier"
            and identifier.isdigit()
            and len(identifier) > 1
            and identifier.startswith("0")
        ):
            normalized = identifier.lstrip("0") or "0"
            retry_payload, retry_ms = self._request(action, identifier=normalized)
            if retry_payload.get("outcome") != "unknown_identifier":
                return retry_payload, request_ms + retry_ms
        return payload, request_ms

    def check_in_identifier(self, identifier: str) -> CheckInResult:
        payload, request_ms = self._identifier_request("check_in_identifier", identifier)
        return self._result(payload, request_ms)

    def prepare_card_link(self, identifier: str) -> CheckInResult:
        payload, request_ms = self._identifier_request("prepare_card_link", identifier)
        return self._result(payload, request_ms)

    def link_card(
        self,
        identifier: str,
        member_uid: str,
        staff_uid: str,
        designated_ids: set[str],
    ) -> CheckInResult:
        del designated_ids  # Authorization is maintained centrally in Staff Access.
        payload, request_ms = self._request(
            "link_card",
            identifier=identifier,
            memberDigest=self.card_digest(member_uid),
            memberLastFour=normalize_card_uid(member_uid)[-4:],
            staffDigest=self.card_digest(staff_uid),
        )
        return self._result(payload, request_ms)
