"""Local-only serial-to-WebSocket bridge for the Scripps Sandbox kiosk."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import serial
from serial.tools import list_ports

from scanner_protocol import DuplicateGuard, normalize_uid


logging.basicConfig(level=os.getenv("SCANNER_LOG_LEVEL", "INFO"))
LOGGER = logging.getLogger("sandbox-scanner")
BAUD_RATE = int(os.getenv("SCANNER_BAUD", "115200"))
SERIAL_PORT = os.getenv("SCANNER_SERIAL_PORT", "").strip()
SIMULATION_ENABLED = os.getenv("SCANNER_SIMULATE", "false").lower() == "true"


class BridgeState:
    def __init__(self) -> None:
        self.reader_status = "simulation" if SIMULATION_ENABLED else "searching"
        self.reader_port: str | None = None
        self.sequence = 0
        self.clients: set[asyncio.Queue[dict[str, Any]]] = set()
        self.guard = DuplicateGuard()

    async def publish(self, uid: str) -> bool:
        if not self.guard.accept(uid):
            return False
        self.sequence += 1
        event = {
            "type": "card_read",
            "uid": uid,
            "read_at": datetime.now(timezone.utc).isoformat(),
            "sequence": self.sequence,
        }
        for client in tuple(self.clients):
            if client.full():
                client.get_nowait()
            client.put_nowait(event)
        LOGGER.info("Card read accepted (UID ending %s)", uid[-4:])
        return True


STATE = BridgeState()


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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(serial_reader())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Scripps Sandbox Scanner Bridge", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "reader": STATE.reader_status,
        "port": STATE.reader_port,
        "clients": len(STATE.clients),
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


@app.post("/simulate")
async def simulate_card_read(read: SimulatedRead) -> dict[str, bool]:
    if not SIMULATION_ENABLED:
        raise HTTPException(status_code=404)
    uid = normalize_uid(read.uid)
    if not uid:
        raise HTTPException(status_code=422, detail="UID must contain 8–28 hexadecimal characters")
    return {"accepted": await STATE.publish(uid)}
