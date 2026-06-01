from __future__ import annotations

import logging
import time
from typing import Any

import requests
from PyQt6.QtCore import QTimer

from global_config import config
from global_context import context
from hardware.traffic_light import TrafficLightState

SILENT_PATHS = frozenset(["/health", "/traffic-light"])


class ExternalApiError(Exception):
    def __init__(self, api: str) -> None:
        self.api = api
        super().__init__(f"External API error: {api}")


class ApiUnreachableError(Exception):
    pass


class ApiController:
    def __init__(self) -> None:
        QTimer.singleShot(config().API_MONITOR_INTERVAL_SECONDS * 1000, self.monitor_api)

    def monitor_api(self) -> None:
        try:
            ApiController.ping()
        except ApiUnreachableError as e:
            context().main_window.show_error(
                "Lost connection to API",
                str(e),
                retry_in=config().API_RETRY_DELAY_SECONDS,
                on_retry=self.monitor_api,
            )
            return
        if context().main_window.is_error_visible():
            context().main_window.hide_error()
        QTimer.singleShot(config().API_MONITOR_INTERVAL_SECONDS * 1000, self.monitor_api)

    @staticmethod
    def _req(method: str, path: str, **kwargs: Any) -> requests.Response:
        url = f"{config().CHECK_IN_API_URL}{path}"
        start: float = time.time()
        resp = requests.request(method, url, timeout=3, **kwargs)
        ms = (time.time() - start) * 1000
        if resp.status_code == 502:
            raise ExternalApiError(resp.json().get("api", "unknown"))
        if path not in SILENT_PATHS:
            logging.info(f"[CLIENT] {method.upper()} {url} -> {resp.status_code} ({ms:.0f}ms)")
        return resp

    @staticmethod
    def ping() -> None:
        try:
            resp = ApiController._req("GET", "/health")
        except Exception as e:
            raise ApiUnreachableError(str(e)) from e
        if not resp.ok:
            raise ApiUnreachableError(f"status {resp.status_code}")

    @staticmethod
    def checkin_by_uuid(uuid: str) -> dict[str, Any]:
        try:
            resp = ApiController._req("GET", f"/check-in/uuid/{uuid}")
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except Exception as e:
            logging.error(f"error during check-in for uuid {uuid}: {e}")
            return {"status": "api_error"}

    @staticmethod
    def checkin_by_pid(pid: str) -> dict[str, Any]:
        try:
            resp = ApiController._req("GET", f"/check-in/pid/{pid}")
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except Exception as e:
            logging.error(f"error during check-in for pid {pid}: {e}")
            return {"status": "api_error"}

    @staticmethod
    def set_traffic_light(state: TrafficLightState) -> None:
        data: dict[str, TrafficLightState] = {
            "state": state
        }
        try:
            ApiController._req("POST", "/traffic-light", json=data)
        except Exception as e:
            logging.error(f"error setting traffic light: {e}")

    @staticmethod
    def get_traffic_light() -> TrafficLightState:
        try:
            resp = ApiController._req("GET", "/traffic-light")
            return TrafficLightState(resp.json().get("state"))
        except Exception as e:
            logging.error(f"error getting traffic light: {e}")
            return TrafficLightState.OFF

    @staticmethod
    def lookup_by_pid(pid: str) -> dict[str, Any] | None:
        try:
            resp = ApiController._req("GET", f"/accounts/lookup/pid/{pid}")
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except Exception as e:
            logging.error(f"error looking up student by pid {pid}: {e}")
            return None

    @staticmethod
    def lookup_by_barcode(barcode: str) -> dict[str, Any] | None:
        try:
            resp = ApiController._req("GET", f"/accounts/lookup/barcode/{barcode}")
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except Exception as e:
            logging.error(f"error looking up student by barcode: {e}")
            return None

    @staticmethod
    def create_account(
        rfid: str,
        *,
        barcode: str | None,
        pid: str | None,
        first_name: str | None,
        last_name: str | None,
        email: str | None,
    ) -> dict[str, Any] | None:
        try:
            raw_payload: dict[str, str | None] = {
                "rfid": rfid,
                "barcode": barcode,
                "pid": pid,
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
            }

            payload: dict[str, str] = {k: v for k, v in raw_payload.items() if v is not None}

            resp = ApiController._req("POST", "/accounts", json=payload)
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except Exception as e:
            logging.error(f"error creating account: {e}")
            return None
