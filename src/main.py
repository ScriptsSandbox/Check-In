from __future__ import annotations

import argparse
import logging
import sys
from sys import stdout

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QApplication

from controllers.account_controller import AccountController
from controllers.api_controller import ApiController, ApiUnreachableError
from controllers.barcode_scanner_controller import BarcodeScannerController
from controllers.check_in_controller import CheckInController
from controllers.health_controller import HealthController
from controllers.navigation_controller import NavigationController
from controllers.rfid_reader_controller import RFIDReaderController
from controllers.traffic_light_controller import TrafficLightController
from global_config import config
from global_context import GlobalContext, set_context, context
from hardware.usb_ports import USBPortController
from window import MainWindow


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


def setup_context() -> None:
    health_controller = HealthController()
    navigation_controller = NavigationController()
    check_in_controller = CheckInController()
    account_controller = AccountController()
    rfid_reader_controller = RFIDReaderController()
    barcode_scanner_controller = BarcodeScannerController()
    traffic_light_controller = TrafficLightController()
    usb_port_controller = USBPortController()
    main_window = MainWindow()

    set_context(GlobalContext(
        health_controller=health_controller,
        navigation_controller=navigation_controller,
        check_in_controller=check_in_controller,
        account_controller=account_controller,
        rfid_reader_controller=rfid_reader_controller,
        barcode_scanner_controller=barcode_scanner_controller,
        traffic_light_controller=traffic_light_controller,
        usb_port_controller=usb_port_controller,
        main_window=main_window
    ))

    context().navigation_controller.start()
    context().rfid_reader_controller.start()
    context().traffic_light_controller.start()


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

    setup_context()

    def shutdown() -> None:
        context().rfid_reader_controller.stop()

    app.aboutToQuit.connect(shutdown)

    def attempt_startup() -> None:
        try:
            ApiController.ping()
        except ApiUnreachableError as exception:
            raise BootError(
                "Cannot reach API",
                exception=exception,
                retry_in=config().API_RETRY_DELAY_SECONDS
            )

        context().main_window.hide_error()
        logging.info("made it to app start")

    QTimer.singleShot(0, attempt_startup)
    sys.exit(app.exec())
