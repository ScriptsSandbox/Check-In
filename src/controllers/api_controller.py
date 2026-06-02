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
        super().__init__(f"External API error: {api}")


class ApiUnreachableError(Exception):
    pass


class APIController:
    def __init__(self) -> None:
        self.ping()

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = f"{config().CHECK_IN_API_URL}{path}"
        start: float = time.time()
        resp = requests.request(method, url, timeout=3, **kwargs)
        ms = (time.time() - start) * 1000
        if resp.status_code == 502:
            raise ExternalApiError(resp.json().get("api", "unknown"))
        if path not in SILENT_PATHS:
            logging.info(f"[CLIENT] {method.upper()} {url} -> {resp.status_code} ({ms:.0f}ms)")
        return resp

    def ping(self) -> bool:
        try:
            resp = self.request("GET", "/health")
            return resp.ok
        except Exception:
            return False
