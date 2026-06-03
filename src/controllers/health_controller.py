from __future__ import annotations

import json
import logging
import socket
import threading
import time
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Callable, Any
import requests
from pyqttoast import ToastPreset

from misc.global_config import config
from misc.global_context import context

_HOSTNAME: str = socket.gethostname()
_lock = threading.Lock()
_last_title: str | None = None
_unresolved: bool = False


class _HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        body: dict[str, Any] = {
            "status": "ok",
        }
        self.wfile.write(json.dumps(body).encode())


def _start_health_server(port: int = 8001) -> None:
    logging.info("starting health server")
    srv = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    threading.Thread(target=srv.serve_forever, daemon=True, name="health-http").start()
    logging.info("health server listening on :%d", port)


def _send_embed(embed: dict[str, Any], content: str | None = None, *, blocking: bool) -> None:
    webhook_url: str = config().DISCORD_WEBHOOK_URL
    if not webhook_url:
        logging.warning("could not send embed because no embed url has been specified")
        return

    payload: dict[str, Any] = {
        "embeds": [embed],
        "allowed_mentions": {
            "parse": ["roles"]
        }
    }

    if content:
        payload["content"] = content

    def send() -> None:
        try:
            requests.post(webhook_url, json=payload, timeout=5)
        except Exception:
            logging.exception("failed to send discord notification")

    if blocking:
        send()
    else:
        threading.Thread(target=send, daemon=True, name="discord-notify").start()


class CriticalSystemType(Enum):
    SYSTEM_BOOT = "System Boot"
    API_CONNECTION = "Backend API Connection"
    RFID_READER = "RFID Reader"
    BARCODE_SCANNER = "Barcode Scanner"


class CriticalSystem:
    # DO NOT EVER INVOKE DIRECTLY
    def __init__(
            self,
            system_type: CriticalSystemType,
            monitor_health_check_func: Callable[[], bool] | None = None,
            period_seconds: int | None = None
    ):
        self.system_type = system_type
        self._is_healthy: bool = True
        self.monitor_health_check_func = monitor_health_check_func
        self.period_seconds = period_seconds
        self.last_run: float = 0

    @classmethod
    def with_monitoring(
            cls,
            system_type: CriticalSystemType,
            monitor_health_check_func: Callable[[], bool],
            *,
            period_seconds: int
    ) -> "CriticalSystem":
        return cls(system_type, monitor_health_check_func, period_seconds)

    @classmethod
    def without_monitoring(cls, system_type: CriticalSystemType) -> CriticalSystem:
        return cls(system_type)

    def is_healthy(self) -> bool:
        return self._is_healthy

    def mark_healthy(self) -> None:
        old = self._is_healthy
        self._is_healthy = True
        if not old:
            self._notify_resolved()

    def mark_unhealthy(
        self,
        retry_interval: float | None = None,
        retry_callback: Callable[[], bool] | None = None,
    ) -> None:
        old = self._is_healthy
        self._is_healthy = False
        if old:
            self._notify_critical()
        if retry_interval is not None and retry_callback is not None:
            def _retry_loop() -> None:
                retries = 1
                while True:
                    time.sleep(retry_interval)
                    if retry_callback():
                        self.mark_healthy()
                        return
                    logging.warning(f"retry failed for {self.system_type.value}")
                    context().main_window.show_toast_async(
                        f"System Error (Retry {retries}): {self.system_type.value}",
                        f"Trying again in {retry_interval}s",
                        ToastPreset.ERROR,
                    )
                    retries += 1
            Thread(target=_retry_loop, daemon=True, name=f"health-retry-{self.system_type.value}").start()

    def _notify_critical(self, *, blocking: bool = False) -> None:
        embed: dict[str, Any] = {
            "title": f":x: Critical System Failure: {self.system_type.value}",
            # "description": f"```\n{detail[:1800]}\n```",
            "color": 0xED4245,
            "footer": {"text": _HOSTNAME},
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        role_mention = f"<@&{config().DISCORD_CRITICAL_ALERT_ROLE_ID}>"
        _send_embed(embed, content=role_mention, blocking=blocking)

        context().main_window.show_toast_async(f"System Error: {self.system_type.value}",
                                               "Please mention this to a staff member", ToastPreset.ERROR)

    def _notify_resolved(self, *, blocking: bool = False) -> None:
        embed: dict[str, Any] = {
            "title": f":white_check_mark: Resolved: {self.system_type.value}",
            "color": 0x57F287,
            "footer": {"text": _HOSTNAME},
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _send_embed(embed, blocking=blocking)

        context().main_window.show_toast_async(f"System Error Resolved: {self.system_type.value}",
                                               "Thank you for your patience", ToastPreset.SUCCESS)


class HealthController:
    def __init__(self) -> None:
        self._systems: list[CriticalSystem] = []
        self._monitor_thread: Thread | None = None
        self._monitor_thread_running: bool = True

        _start_health_server(port=config().HEALTH_SERVER_PORT)

        logging.info("health controller initialized")

    def panic(self) -> None:
        pass

    def start_monitoring(self) -> None:
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._monitor_thread = threading.Thread(target=self._run, daemon=True)
        self._monitor_thread.start()

    def stop_monitoring(self) -> None:
        if self._monitor_thread:
            self._monitor_thread.join()
            self._monitor_thread = None

    def register(self, system: CriticalSystem) -> None:
        self._systems.append(system)

    def get_system(self, system_type: CriticalSystemType) -> CriticalSystem:
        for system in self._systems:
            if system.system_type == system_type:
                return system

        system = CriticalSystem.without_monitoring(system_type)
        self.register(system)
        return system

    def _run(self) -> None:
        while self._monitor_thread_running:
            now = time.time()
            for system in self._systems:
                if not system.monitor_health_check_func:
                    continue
                assert system.period_seconds is not None

                if now - system.last_run >= system.period_seconds:
                    try:
                        system.monitor_health_check_func()
                    except Exception:
                        pass
                    system.last_run = now
            time.sleep(0.5)
