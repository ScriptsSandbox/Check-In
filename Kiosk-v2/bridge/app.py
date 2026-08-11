"""Local-only serial-to-WebSocket bridge for the Scripps Sandbox kiosk."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import serial
from serial.tools import list_ports

from scanner_protocol import DuplicateGuard, normalize_uid
from sheets_backend import CheckInResult, GoogleSheetsProvider, SheetsCheckInBackend


logging.basicConfig(level=os.getenv("SCANNER_LOG_LEVEL", "INFO"))
LOGGER = logging.getLogger("sandbox-scanner")
BAUD_RATE = int(os.getenv("SCANNER_BAUD", "115200"))
SERIAL_PORT = os.getenv("SCANNER_SERIAL_PORT", "").strip()
SIMULATION_ENABLED = os.getenv("SCANNER_SIMULATE", "false").lower() == "true"
BACKEND_MODE = os.getenv("SCANNER_CHECKIN_BACKEND", "demo").strip().lower()
DUPLICATE_WINDOW_SECONDS = float(os.getenv("SCANNER_DUPLICATE_SECONDS", "15"))
if BACKEND_MODE not in {"demo", "sheets"}:
    raise RuntimeError("SCANNER_CHECKIN_BACKEND must be 'demo' or 'sheets'")


def build_checkin_backend() -> SheetsCheckInBackend | None:
    # Simulation is deliberately write-free, even if a stale environment file
    # also asks for the Sheets backend.
    if SIMULATION_ENABLED or BACKEND_MODE == "demo":
        return None
    return SheetsCheckInBackend(GoogleSheetsProvider.from_environment())


class BridgeState:
    def __init__(self, backend: SheetsCheckInBackend | None = None) -> None:
        self.reader_status = "simulation" if SIMULATION_ENABLED else "searching"
        self.reader_port: str | None = None
        self.sequence = 0
        self.clients: set[asyncio.Queue[dict[str, Any]]] = set()
        self.guard = DuplicateGuard(window_seconds=DUPLICATE_WINDOW_SECONDS)
        self.backend = backend
        self.backend_ready = backend is None

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

        if self.backend is None:
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
        LOGGER.exception("Sheets cache warm-up failed; the first scan will retry")
        return
    STATE.backend_ready = True
    LOGGER.info("Sheets cache warm-up complete; stages=%s", timings)


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
        "backend": "demo" if STATE.backend is None else "sheets",
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
