from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING

from controllers.barcode_scanner_controller import BarcodeScannerController
from controllers.health_controller import HealthController
from hardware.usb_ports import USBPortController
from window import MainWindow

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController
    from controllers.check_in_controller import CheckInController
    from controllers.account_controller import AccountController
    from controllers.rfid_reader_controller import RFIDReaderController
    from dispatcher import MainThreadDispatcher
    from controllers.traffic_light_controller import TrafficLightController


@dataclass
class Env:
    KIOSK_NAME: str
    HAS_BARCODE_SCANNER: bool
    CHECK_IN_API_URL: str
    DISCORD_WEBHOOK_URL: str
    DEV_MODE: bool


@dataclass
class Config:
    API_RETRY_DELAY_SECONDS: int = 10
    API_MONITOR_INTERVAL_SECONDS: int = 15
    HARDWARE_RETRY_DELAY_SECONDS: int = 5
    HEALTH_SERVER_PORT: int = 8001
    DISCORD_CRITICAL_ALERT_ROLE_ID = "1509027158209859695"


def _from_env(key: str, required: bool) -> str:
    value = os.environ.get(key)
    if value is None:
        if required:
            raise RuntimeError(f"Missing environment variable: {key}")
        else:
            return ""

    return value


class GlobalContext:
    def __init__(
            self,
            health_controller: HealthController,
            navigation_controller: NavigationController,
            check_in_controller: CheckInController,
            account_controller: AccountController,
            rfid_reader_controller: RFIDReaderController,
            barcode_scanner_controller: BarcodeScannerController,
            traffic_light_controller: TrafficLightController,
            usb_port_controller: USBPortController,
            mainWindow: MainWindow
    ):
        self.health_controller = health_controller
        self.navigation_controller = navigation_controller
        self.check_in_controller = check_in_controller
        self.account_controller = account_controller
        self.barcode_scanner_controller = barcode_scanner_controller
        self.rfid_reader_controller = rfid_reader_controller
        self.traffic_light_controller = traffic_light_controller
        self.usb_port_controller = usb_port_controller

        self.env: Env = None  # type: ignore[assignment]
        self.config: Config = Config()

        self.mainWindow = mainWindow

        self.dispatcher: MainThreadDispatcher = MainThreadDispatcher()
        self.has_barcode_scanner: bool = False

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

    def load_env(self) -> None:
        self.env = Env(
            KIOSK_NAME=_from_env("KIOSK_NAME", required=True),
            HAS_BARCODE_SCANNER=_from_env("HAS_BARCODE_SCANNER", required=True).lower() == "true",
            CHECK_IN_API_URL=_from_env("CHECK_IN_API_URL", required=True),
            DISCORD_WEBHOOK_URL=_from_env("DISCORD_WEBHOOK_URL", required=False),
            DEV_MODE=_from_env("DEV_MODE", required=False).lower() == "true"
        )
