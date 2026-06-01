from __future__ import annotations

import threading
from collections.abc import Callable

from hardware.traffic_light import TrafficLightState
from misc.global_context import context


class Session:
    def __init__(self) -> None:
        self._rfid = ""
        self._rfid_lock = threading.Lock()
        self._continuations: list[Callable[[], None] | None] = []

    @property
    def rfid(self) -> str:
        with self._rfid_lock:
            return self._rfid

    @rfid.setter
    def rfid(self, value: str) -> None:
        with self._rfid_lock:
            self._rfid = value

    def push_continuation(self, on_done: Callable[[], None] | None) -> None:
        self._continuations.append(on_done)

    def pop_continuation(self) -> Callable[[], None] | None:
        return self._continuations.pop() if self._continuations else None

    def reset(self) -> None:
        self.rfid = ""
        self._continuations.clear()
        context().traffic_light_controller.request_state(TrafficLightState.OFF)
