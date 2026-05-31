import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


# TODO: revisit this and build out a more proper server
# start with: health_server.start(port=context().config.HEALTH_SERVER_PORT)
# class _Handler(BaseHTTPRequestHandler):
#     stall_threshold_s = 5.0
#
#     def do_GET(self) -> None:
#         if self.path != "/health":
#             self.send_response(404)
#             self.end_headers()
#             return
#         self.send_response(200)
#         self.send_header("Content-Type", "application/json")
#         self.end_headers()
#         body: dict[str, Any] = {
#             "status": "ok",
#             # "uptime_s": round(time.monotonic() - _state.started_at, 1),
#         }
#         self.wfile.write(json.dumps(body).encode())
#
#
# def start(port: int = 8001) -> None:
#     srv = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
#     threading.Thread(target=srv.serve_forever, daemon=True, name="health-http").start()
#     logging.info("health endpoint listening on :%d", port)
