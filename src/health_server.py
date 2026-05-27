import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import notifier


class _State:
    started_at = time.monotonic()
    ui_ready = False
    last_heartbeat = 0.0


_state = _State()


def mark_ui_ready() -> None:
    _state.ui_ready = True
    heartbeat()


def heartbeat() -> None:
    _state.last_heartbeat = time.monotonic()


def _status(stall_threshold_s: float):
    now = time.monotonic()
    if not _state.ui_ready:
        return False, "ui_not_ready", now - _state.started_at
    age = now - _state.last_heartbeat
    if age > stall_threshold_s:
        return False, "event_loop_stalled", age
    return True, "ok", age


class _Handler(BaseHTTPRequestHandler):
    stall_threshold_s = 5.0

    def log_message(self, *_a, **_kw):
        pass

    def do_GET(self):
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        ok, reason, age = _status(self.stall_threshold_s)
        self.send_response(200 if ok else 503)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        body = {
            "status": reason,
            "ui_ready": _state.ui_ready,
            "heartbeat_age_s": round(age, 2),
            "uptime_s": round(time.monotonic() - _state.started_at, 1),
        }
        self.wfile.write(json.dumps(body).encode())


def start(port: int = 8001) -> None:
    srv = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True, name="health-http").start()
    logging.info("health endpoint listening on :%d", port)


def start_watchdog(startup_grace_s: float = 60.0, stall_threshold_s: float = 15.0) -> None:
    def loop():
        while True:
            time.sleep(2)
            now = time.monotonic()
            if not _state.ui_ready:
                if now - _state.started_at > startup_grace_s:
                    logging.critical("UI not ready after %.0fs, exiting", startup_grace_s)
                    notifier.notify_critical(
                        "Kiosk UI failed to start",
                        f"UI not ready after {startup_grace_s:.0f}s; process exiting for restart.",
                        blocking=True,
                    )
                    os._exit(2)
                continue
            age = now - _state.last_heartbeat
            if age > stall_threshold_s:
                logging.critical("Qt event loop stalled for %.1fs, exiting", age)
                notifier.notify_critical(
                    "Kiosk event loop stalled",
                    f"Qt event loop stalled for {age:.1f}s; process exiting for restart.",
                    blocking=True,
                )
                os._exit(3)

    threading.Thread(target=loop, daemon=True, name="health-watchdog").start()
