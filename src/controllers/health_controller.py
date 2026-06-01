import logging
import socket
import threading
import time
from enum import Enum
from threading import Thread
from typing import Callable, Any
import requests

from global_config import config
from global_context import context

_HOSTNAME: str = socket.gethostname()
_lock = threading.Lock()
_last_title: str | None = None
_unresolved: bool = False


def _send_embed(embed: dict[str, Any], content: str | None = None, *, blocking: bool) -> None:
    webhook_url: str = config().DISCORD_WEBHOOK_URL
    if not webhook_url:
        return

    payload: dict[str, Any] = {"embeds": [embed]}
    if content:
        payload["content"] = content
    payload["allowed_mentions"] = {"parse": ["roles"]}

    def send() -> None:
        try:
            requests.post(webhook_url, json=payload, timeout=5)
        except Exception:
            logging.exception("failed to send discord notification")

    if blocking:
        send()
    else:
        threading.Thread(target=send, daemon=True, name="discord-notify").start()


def notify_critical(title: str, detail: str, *, blocking: bool = False) -> None:
    global _last_title, _unresolved
    with _lock:
        if title == _last_title:
            return
        _last_title = title
        _unresolved = True

    embed: dict[str, Any] = {
        "title": f":x:  {title}",
        "description": f"```\n{detail[:1800]}\n```",
        "color": 0xED4245,  # discord red
        "footer": {"text": _HOSTNAME},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    role_mention = f"<@&{config().DISCORD_CRITICAL_ALERT_ROLE_ID}>"
    _send_embed(embed, content=role_mention, blocking=blocking)


def notify_resolved() -> None:
    global _last_title, _unresolved
    with _lock:
        if not _unresolved:
            return
        _unresolved = False
        title = _last_title
        _last_title = None

    embed: dict[str, Any] = {
        "title": f":white_check_mark:  Resolved: {title}",
        "color": 0x57F287,  # discord green
        "footer": {"text": _HOSTNAME},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _send_embed(embed, blocking=False)


class CriticalSystemType(Enum):
    API_CONNECTION = "Backend API Connection"


class CriticalSystem:
    # DO NOT EVER INVOKE DIRECTLY
    def __init__(
            self,
            systemType: CriticalSystemType,
            monitor_health_check_func: Callable[[], bool] | None = None,
            period_seconds: int | None = None
    ):
        self.systemType = systemType
        self.is_healthy: bool = True
        self.monitor_health_check_func = monitor_health_check_func
        self.period_seconds = period_seconds
        self.last_run: float = 0

    @classmethod
    def with_monitoring(
            cls,
            systemType: CriticalSystemType,
            monitor_health_check_func: Callable[[], bool] | None = None,
            period_seconds: int | None = None
    ) -> "CriticalSystem":
        return cls(systemType, monitor_health_check_func, period_seconds)

    @classmethod
    def without_monitoring(cls, systemType: CriticalSystemType) -> "CriticalSystem":
        return cls(systemType)


class HealthController:
    def __init__(self) -> None:
        self._systems: list[CriticalSystem] = []
        self._monitor_thread: Thread | None = None
        self._monitor_thread_running: bool = True

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

    def register(self, check: CriticalSystem) -> None:
        self._systems.append(check)

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