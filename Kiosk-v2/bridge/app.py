"""Local-only serial-to-WebSocket bridge for the Scripps Sandbox kiosk."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os
import time
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import serial
from serial.tools import list_ports

from scanner_protocol import DuplicateGuard, normalize_uid
from apps_script_backend import AppsScriptCheckInBackend
from sheets_backend import CheckInResult, GoogleSheetsProvider, SheetsCheckInBackend


logging.basicConfig(level=os.getenv("SCANNER_LOG_LEVEL", "INFO"))
LOGGER = logging.getLogger("sandbox-scanner")
BAUD_RATE = int(os.getenv("SCANNER_BAUD", "115200"))
SERIAL_PORT = os.getenv("SCANNER_SERIAL_PORT", "").strip()
SIMULATION_ENABLED = os.getenv("SCANNER_SIMULATE", "false").lower() == "true"
BACKEND_MODE = os.getenv("SCANNER_CHECKIN_BACKEND", "demo").strip().lower()
DUPLICATE_WINDOW_SECONDS = float(os.getenv("SCANNER_DUPLICATE_SECONDS", "15"))
CARD_LINK_SESSION_SECONDS = float(os.getenv("CARD_LINK_SESSION_SECONDS", "300"))
DESIGNATED_CARD_LINK_STAFF_IDS = {
    value.strip()
    for value in os.getenv("CARD_LINK_STAFF_IDS", "").split(",")
    if value.strip()
}
if BACKEND_MODE not in {"demo", "sheets", "apps-script"}:
    raise RuntimeError("SCANNER_CHECKIN_BACKEND must be 'demo', 'sheets', or 'apps-script'")


def build_checkin_backend() -> SheetsCheckInBackend | AppsScriptCheckInBackend | None:
    # Simulation is deliberately write-free, even if a stale environment file
    # also asks for the Sheets backend.
    if SIMULATION_ENABLED or BACKEND_MODE == "demo":
        return None
    if BACKEND_MODE == "apps-script":
        return AppsScriptCheckInBackend.from_environment()
    return SheetsCheckInBackend(GoogleSheetsProvider.from_environment())


class BridgeState:
    def __init__(
        self,
        backend: SheetsCheckInBackend | AppsScriptCheckInBackend | None = None,
        designated_card_link_staff_ids: set[str] | None = None,
    ) -> None:
        self.reader_status = "simulation" if SIMULATION_ENABLED else "searching"
        self.reader_port: str | None = None
        self.sequence = 0
        self.clients: set[asyncio.Queue[dict[str, Any]]] = set()
        self.guard = DuplicateGuard(window_seconds=DUPLICATE_WINDOW_SECONDS)
        self.backend = backend
        self.backend_ready = backend is None
        self.pending_card_uid: str | None = None
        self.pending_card_expires_at = 0.0
        self.card_link_identifier: str | None = None
        self.designated_card_link_staff_ids = (
            DESIGNATED_CARD_LINK_STAFF_IDS
            if designated_card_link_staff_ids is None
            else designated_card_link_staff_ids
        )

    def clear_card_link(self) -> None:
        if self.pending_card_uid:
            self.guard.forget(self.pending_card_uid)
        self.pending_card_uid = None
        self.pending_card_expires_at = 0.0
        self.card_link_identifier = None

    def card_link_is_active(self) -> bool:
        if not self.pending_card_uid or time.monotonic() >= self.pending_card_expires_at:
            self.clear_card_link()
            return False
        return True

    def broadcast(self, event: dict[str, Any]) -> None:
        for client in tuple(self.clients):
            if client.full():
                client.get_nowait()
            client.put_nowait(event)

    async def publish(self, uid: str) -> bool:
        if not self.guard.accept(uid):
            LOGGER.info(
                "Suppressed repeated card read inside the %.1fs duplicate window",
                self.guard.window_seconds,
            )
            return False

        self.sequence += 1
        sequence = self.sequence
        read_at = datetime.now(timezone.utc).isoformat()
        started_at = asyncio.get_running_loop().time()
        self.broadcast(
            {
                "type": "card_detected",
                "read_at": read_at,
                "sequence": sequence,
            }
        )
        LOGGER.info(
            "Card detected; notified %s kiosk client(s) before backend processing",
            len(self.clients),
        )

        expired_card_link = (
            self.backend is not None
            and self.card_link_identifier is not None
            and not self.card_link_is_active()
        )
        authorizing_card_link = (
            self.backend is not None
            and self.card_link_identifier is not None
            and self.card_link_is_active()
        )
        if expired_card_link:
            result = CheckInResult(
                outcome="card_link_error",
                message="The card-link session expired. Scan the member card again.",
            )
            self.guard.forget(uid)
        elif authorizing_card_link:
            try:
                result = await asyncio.to_thread(
                    self.backend.link_card,
                    self.card_link_identifier,
                    self.pending_card_uid,
                    uid,
                    self.designated_card_link_staff_ids,
                )
            except Exception:
                LOGGER.exception("Card-link backend failed during staff authorization")
                result = CheckInResult(
                    outcome="card_link_error",
                    message="The card could not be connected. Please try again.",
                )
            if result.outcome == "card_linked":
                self.clear_card_link()
            else:
                self.guard.forget(uid)
        elif self.backend is None:
            result = CheckInResult(
                outcome="demo",
                display_name="Sandbox member",
                message="Demo read accepted without writing a check-in.",
            )
        else:
            try:
                result = await asyncio.to_thread(self.backend.check_in, uid)
            except Exception:
                LOGGER.exception("Check-in backend failed while processing a card")
                result = CheckInResult(
                    outcome="backend_error",
                    message="The check-in could not be recorded. Please see staff.",
                )

        if result.outcome == "unknown_card":
            self.pending_card_uid = uid
            self.pending_card_expires_at = (
                time.monotonic() + CARD_LINK_SESSION_SECONDS
            )
            self.card_link_identifier = None

        if result.outcome == "backend_error":
            self.guard.forget(uid)
        elif self.backend is not None:
            self.backend_ready = True

        processing_ms = round(
            (asyncio.get_running_loop().time() - started_at) * 1000
        )
        event = {
            "type": "card_read",
            "outcome": result.outcome,
            "display_name": result.display_name,
            "message": result.message,
            "visit_count": result.visit_count,
            "read_at": read_at,
            "sequence": sequence,
            "processing_ms": processing_ms,
            "backend_timings_ms": result.timings_ms,
        }
        self.broadcast(event)
        LOGGER.info(
            "Card read processed with outcome %s in %sms; backend stages=%s",
            result.outcome,
            processing_ms,
            result.timings_ms,
        )
        return True


STATE = BridgeState(build_checkin_backend())


def choose_serial_port() -> str | None:
    if SERIAL_PORT:
        return SERIAL_PORT
    candidates = [
        port.device
        for port in list_ports.comports()
        if any(marker in port.device.lower() for marker in ("ttyusb", "ttyacm", "usbserial", "usbmodem"))
    ]
    return candidates[0] if len(candidates) == 1 else None


async def serial_reader() -> None:
    if SIMULATION_ENABLED:
        return
    while True:
        port = choose_serial_port()
        if not port:
            STATE.reader_status = "searching"
            STATE.reader_port = None
            await asyncio.sleep(3)
            continue
        try:
            STATE.reader_status = "connecting"
            with serial.Serial(port, BAUD_RATE, timeout=1) as reader:
                STATE.reader_status = "connected"
                STATE.reader_port = port
                LOGGER.info("Reader connected on %s at %s baud", port, BAUD_RATE)
                while True:
                    line = await asyncio.to_thread(reader.readline)
                    uid = normalize_uid(line)
                    if uid:
                        await STATE.publish(uid)
        except (OSError, serial.SerialException) as error:
            STATE.reader_status = "disconnected"
            STATE.reader_port = None
            LOGGER.warning("Reader unavailable: %s", error)
            await asyncio.sleep(3)


async def warm_backend() -> None:
    if STATE.backend is None:
        return
    try:
        timings = await asyncio.to_thread(STATE.backend.warm_up)
    except Exception:
        STATE.backend_ready = False
        LOGGER.exception("Check-in backend warm-up failed; the first scan will retry")
        return
    STATE.backend_ready = True
    LOGGER.info("Check-in backend warm-up complete; stages=%s", timings)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    reader_task = asyncio.create_task(serial_reader())
    warm_task = asyncio.create_task(warm_backend())
    yield
    for task in (reader_task, warm_task):
        task.cancel()
    await asyncio.gather(reader_task, warm_task, return_exceptions=True)


app = FastAPI(title="Scripps Sandbox Scanner Bridge", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "reader": STATE.reader_status,
        "port": STATE.reader_port,
        "clients": len(STATE.clients),
        "backend": "demo" if STATE.backend is None else BACKEND_MODE,
        "backend_ready": STATE.backend_ready,
    }


@app.websocket("/ws")
async def scanner_events(websocket: WebSocket) -> None:
    await websocket.accept()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=20)
    STATE.clients.add(queue)
    try:
        while True:
            queued_event = asyncio.create_task(queue.get())
            client_message = asyncio.create_task(websocket.receive())
            completed, pending = await asyncio.wait(
                {queued_event, client_message},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

            if client_message in completed:
                message = client_message.result()
                if message["type"] == "websocket.disconnect":
                    break
            if queued_event in completed:
                await websocket.send_json(queued_event.result())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        STATE.clients.discard(queue)


class SimulatedRead(BaseModel):
    uid: str


class IdentifierCheckIn(BaseModel):
    identifier: str


class CardLinkStart(BaseModel):
    identifier: str


@app.post("/card-link/start")
async def start_card_link(request: CardLinkStart) -> dict[str, Any]:
    identifier = request.identifier.strip()
    if not identifier or len(identifier) > 64:
        raise HTTPException(status_code=422, detail="Enter a valid PID or employee ID")
    if STATE.backend is None:
        raise HTTPException(status_code=409, detail="Card linking is unavailable in demo mode")
    if not STATE.designated_card_link_staff_ids:
        raise HTTPException(status_code=503, detail="No designated card-linking staff are configured")
    if not STATE.card_link_is_active():
        raise HTTPException(status_code=409, detail="The unknown-card session expired. Scan the member card again.")

    try:
        result = await asyncio.to_thread(STATE.backend.prepare_card_link, identifier)
    except Exception:
        LOGGER.exception("Card-link backend failed while identifying the member")
        raise HTTPException(status_code=503, detail="The account could not be checked")
    if result.outcome != "link_ready":
        return {
            "ok": False,
            "outcome": result.outcome,
            "message": result.message,
        }
    STATE.card_link_identifier = identifier
    return {
        "ok": True,
        "outcome": result.outcome,
        "display_name": result.display_name,
        "message": result.message,
        "expires_in_seconds": round(
            max(0, STATE.pending_card_expires_at - time.monotonic())
        ),
    }


@app.post("/card-link/cancel")
async def cancel_card_link() -> dict[str, bool]:
    STATE.clear_card_link()
    return {"ok": True}


@app.post("/check-in/identifier")
async def check_in_with_identifier(read: IdentifierCheckIn) -> dict[str, Any]:
    identifier = read.identifier.strip()
    if not identifier or len(identifier) > 64:
        raise HTTPException(status_code=422, detail="Enter a valid PID or employee ID")

    read_at = datetime.now(timezone.utc).isoformat()
    started_at = asyncio.get_running_loop().time()
    STATE.sequence += 1
    sequence = STATE.sequence
    if STATE.backend is None:
        result = CheckInResult(
            outcome="demo",
            display_name="Sandbox member",
            message="Demo check-in accepted without writing to Sheets.",
        )
    else:
        try:
            result = await asyncio.to_thread(
                STATE.backend.check_in_identifier,
                identifier,
            )
            STATE.backend_ready = True
        except Exception:
            LOGGER.exception("Check-in backend failed while processing an identifier")
            result = CheckInResult(
                outcome="backend_error",
                message="The check-in could not be recorded. Please see staff.",
            )

    processing_ms = round(
        (asyncio.get_running_loop().time() - started_at) * 1000
    )
    LOGGER.info(
        "Identifier check-in processed with outcome %s in %sms; backend stages=%s",
        result.outcome,
        processing_ms,
        result.timings_ms,
    )
    return {
        "type": "card_read",
        "outcome": result.outcome,
        "display_name": result.display_name,
        "message": result.message,
        "visit_count": result.visit_count,
        "read_at": read_at,
        "sequence": sequence,
        "processing_ms": processing_ms,
        "backend_timings_ms": result.timings_ms,
    }


@app.post("/simulate")
async def simulate_card_read(read: SimulatedRead) -> dict[str, bool]:
    if not SIMULATION_ENABLED:
        raise HTTPException(status_code=404)
    uid = normalize_uid(read.uid)
    if not uid:
        raise HTTPException(status_code=422, detail="UID must contain 8–28 hexadecimal characters")
    return {"accepted": await STATE.publish(uid)}
