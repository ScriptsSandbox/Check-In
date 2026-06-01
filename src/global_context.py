from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING

from dispatcher import MainThreadDispatcher

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController
    from controllers.check_in_controller import CheckInController
    from controllers.account_controller import AccountController
    from controllers.rfid_reader_controller import RFIDReaderController
    from controllers.traffic_light_controller import TrafficLightController
    from controllers.barcode_scanner_controller import BarcodeScannerController
    from controllers.health_controller import HealthController
    from hardware.usb_ports import USBPortController
    from window import MainWindow


_context: GlobalContext

def context() -> GlobalContext:
    return _context

def set_context(new_context: GlobalContext) -> None:
    global _context
    _context = new_context


class GlobalContext:
    def __init__(
            self,
            *,
            health_controller: HealthController,
            navigation_controller: NavigationController,
            check_in_controller: CheckInController,
            account_controller: AccountController,
            rfid_reader_controller: RFIDReaderController,
            barcode_scanner_controller: BarcodeScannerController,
            traffic_light_controller: TrafficLightController,
            usb_port_controller: USBPortController,
            main_window: MainWindow
    ):
        self.health_controller = health_controller
        self.navigation_controller = navigation_controller
        self.check_in_controller = check_in_controller
        self.account_controller = account_controller
        self.barcode_scanner_controller = barcode_scanner_controller
        self.rfid_reader_controller = rfid_reader_controller
        self.traffic_light_controller = traffic_light_controller
        self.usb_port_controller = usb_port_controller

        self.main_window = main_window

        self.dispatcher: MainThreadDispatcher = MainThreadDispatcher()

        self._rfid: str = ""
        self._rfid_lock = threading.Lock()

    @property
    def rfid(self) -> str:
        with self._rfid_lock:
            return self._rfid

    @rfid.setter
    def rfid(self, value: str) -> None:
        with self._rfid_lock:
            self._rfid = value