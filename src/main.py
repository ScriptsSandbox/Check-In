from __future__ import annotations

import logging
import signal
import sys

from PyQt6.QtWidgets import QApplication

from controllers.account_controller import AccountController
from controllers.api_controller import APIController
from controllers.barcode_scanner_controller import BarcodeScannerController
from controllers.check_in_controller import CheckInController
from controllers.health_controller import HealthController, CriticalSystem, CriticalSystemType
from controllers.navigation_controller import NavigationController
from controllers.rfid_reader_controller import RFIDReaderController
from controllers.traffic_light_controller import TrafficLightController
from hardware.usb_ports import USBPortController
from misc.global_config import config
from misc.global_context import GlobalContext, context
from misc.check_in_session import CheckInSession
from window import MainWindow


def prepare_boot() -> None:
    if config().VERBOSE_LOGGING:
        logging.basicConfig(level=logging.DEBUG, stream=sys.stdout)
    else:
        logging.basicConfig(level=logging.INFO)

    signal.signal(signal.SIGINT, signal.SIG_DFL)


def initiate_boot() -> None:
    global_context = GlobalContext()

    global_context.health_controller = HealthController()
    global_context.main_window = MainWindow()

    global_context.api_controller = APIController()

    global_context.navigation_controller = NavigationController()
    global_context.check_in_controller = CheckInController()
    global_context.account_controller = AccountController()

    global_context.usb_port_controller = USBPortController()
    global_context.rfid_reader_controller = RFIDReaderController()
    global_context.barcode_scanner_controller = BarcodeScannerController()
    global_context.traffic_light_controller = TrafficLightController()

    global_context.session = CheckInSession()

    global_context.health_controller.register(CriticalSystem.with_monitoring(
        CriticalSystemType.API_CONNECTION,
        global_context.api_controller.ping,
        period_seconds=5
    ))

def shutdown() -> None:
    context().rfid_reader_controller.stop()

if __name__ == "__main__":
    app: QApplication | None = None
    try:
        prepare_boot()
        app = QApplication([])
        assert app
        initiate_boot()
        context().main_window.on_finish_boot()
        app.aboutToQuit.connect(shutdown)
        sys.exit(app.exec())
    except Exception as exception:
        if app is None or context() is None or context().health_controller is None:
            # if this has occurred the system has failed so completely it will be unable to alert that it has failed
            logging.error(f"rip: {exception}")

        elif context().main_window is None:
            # if this occurred the system failed before the UI loaded
            context().health_controller.get_system(CriticalSystemType.SYSTEM_BOOT).mark_unhealthy()
            logging.error(f"UI Failed to load: {exception}")

        else:
            # if this occurred something else failed to initialize, and we should retry after a while
            context().main_window.show_error("System Boot Failure", str(exception), retry_in=60, on_retry=lambda: sys.exit(1))
            context().health_controller.get_system(CriticalSystemType.SYSTEM_BOOT).mark_unhealthy()
            logging.error(f"System Boot Failure: {exception}")
            app.exec() # need to start the pyqt ui loop otherwise nothing will render

        sys.exit(1)

