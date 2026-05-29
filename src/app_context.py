from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from controllers.traffic_light_controller import TrafficLightController
from hardware.traffic_light import TrafficLight

if TYPE_CHECKING:
    from window import CheckInWindow
    from controllers.navigation_controller import NavigationController
    from controllers.check_in_controller import CheckInController
    from controllers.account_controller import AccountController
    from controllers.rfid_reader_controller import RfidReaderController
    from dispatcher import MainThreadDispatcher


class AppContext:
    def __init__(self, traffic_light: TrafficLightController) -> None:
        self.traffic_light = traffic_light
        self.window: CheckInWindow = None  # type: ignore[assignment]
        self.nav: NavigationController = None  # type: ignore[assignment]
        self.check_in: CheckInController = None  # type: ignore[assignment]
        self.account: AccountController = None  # type: ignore[assignment]
        self.dispatcher: MainThreadDispatcher = None  # type: ignore[assignment]
        self.card_reader: RfidReaderController | None = None
        self.has_barcode_scanner: bool = False
        self._rfid_lock = threading.Lock()
        self._rfid: str = ""

    @property
    def rfid(self) -> str:
        with self._rfid_lock:
            return self._rfid

    @rfid.setter
    def rfid(self, value: str) -> None:
        with self._rfid_lock:
            self._rfid = value

    @classmethod
    def create(cls, traffic_usb_id: str | None = None) -> "AppContext":
        light = TrafficLight(traffic_usb_id)
        traffic = TrafficLightController(light)
        return cls(traffic)
