from __future__ import annotations

import logging
import time
from typing import Any

import requests

from misc.global_config import config

SILENT_PATHS = frozenset(["/health", "/traffic-light"])


class ExternalApiError(Exception):
    def __init__(self, api: str) -> None:
        self.api = api
        super().__init__(f"External API error: {api}")\


class APIController:
    def __init__(self) -> None:
        if not self.ping():
            raise RuntimeError("Could not connect to the API")
        logging.info("api controller initialized")

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = f"{config().CHECK_IN_API_URL}{path}"
        start: float = time.time()
        response = requests.request(method, url, timeout=3, **kwargs)
        req_duration = (time.time() - start) * 1000
        # 502 is the error code used by the api server to signal that the server error was upstream
        # and not directly caused by a failure of the check-in api
        if response.status_code == 502:
            raise ExternalApiError(response.json().get("api", "unknown"))
        if path not in SILENT_PATHS:
            logging.info(f"[CLIENT] {method.upper()} {url} -> {response.status_code} ({req_duration:.0f}ms)")
        return response

    def ping(self) -> bool:
        try:
            response = self.request("GET", "/health")
            return response.ok
        except Exception:
            return False
