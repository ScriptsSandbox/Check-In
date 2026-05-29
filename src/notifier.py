import logging
import os
import socket
import threading

import requests

DISCORD_PING_ROLE_ID = "1509027158209859695"

_WEBHOOK: str | None = os.environ.get("DISCORD_WEBHOOK_URL")
_HOSTNAME: str = socket.gethostname()
_lock = threading.Lock()
_last_title: str | None = None
_unresolved: bool = False


def _post(content: str, blocking: bool, timeout: float = 5) -> None:
    if not _WEBHOOK:
        return
    payload = {"content": content, "allowed_mentions": {"parse": ["roles"]}}

    def send() -> None:
        try:
            requests.post(_WEBHOOK, json=payload, timeout=timeout)
        except Exception:
            logging.exception("failed to send Discord notification")

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
    content = (
        f"<@&{DISCORD_PING_ROLE_ID}> ❌ **{title}** — `{_HOSTNAME}`\n"
        f"```\n{detail[:1800]}\n```"
    )
    _post(content, blocking=blocking)


def notify_resolved() -> None:
    global _last_title, _unresolved
    with _lock:
        if not _unresolved:
            return
        _unresolved = False
        title = _last_title
        _last_title = None
    _post(f"✅ Resolved: **{title}** — `{_HOSTNAME}`", blocking=False)
