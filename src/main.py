from __future__ import annotations

import sys
import logging
import argparse
import os
from sys import stdout

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer

import health_server
from controllers.health_controller import HealthController
from controllers.traffic_light_controller import TrafficLightController
from controllers.navigation_controller import NavigationController
from controllers.barcode_scanner_controller import BarcodeScannerController
from controllers.check_in_controller import CheckInController
from controllers.account_controller import AccountController
from controllers.rfid_reader_controller import RFIDReaderController
from global_context import GlobalContext
from controllers.api_controller import ApiController, ApiUnreachableError
from hardware.usb_ports import USBPortController
from window import MainWindow



context: GlobalContext


class BootError(Exception):
    def __init__(
            self,
            readable_message: str,
            exception: Exception,
            retry_in: float | None,
    ) -> None:
        super().__init__(readable_message)
        self.exception = exception
        self.retry_in = retry_in


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Makerspace Check-in System",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="print debug")
    parser.add_argument("-d", "--dev", action="store_true", help="enable dev overlay")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG, stream=stdout)
    else:
        logging.basicConfig(level=logging.INFO)

    app = QApplication([])

    import signal
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    def build_app_context() -> None:
        global context
        context = GlobalContext(
            health_controller=HealthController(),
            navigation_controller=NavigationController(),
            check_in_controller=CheckInController(),
            account_controller=AccountController(),
            rfid_reader_controller=RFIDReaderController(),
            barcode_scanner_controller=BarcodeScannerController(),
            traffic_light_controller=TrafficLightController(),
            usb_port_controller=USBPortController(),
            mainWindow=MainWindow()
        )

    def shutdown() -> None:
        context.rfid_reader_controller.stop()

    app.aboutToQuit.connect(shutdown)

    def attempt_startup() -> None:
        try:
            ApiController.ping()
        except ApiUnreachableError as exception:
            raise BootError(
                "Cannot reach API",
                exception=exception,
                retry_in=context.config.API_RETRY_DELAY_SECONDS
            )

        try:
            build_app_context()
        except Exception as exception:
            raise BootError(
                "Kiosk failed to initialize",
                exception=exception,
                retry_in=context.config.API_RETRY_DELAY_SECONDS
            )

        context.mainWindow.hide_error()
        logging.info("made it to app start")

    QTimer.singleShot(0, attempt_startup)
    sys.exit(app.exec())
