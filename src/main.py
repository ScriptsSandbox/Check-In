import sys
import logging
import argparse
import os
from sys import stdout

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer

import health_server
from window import CheckInWindow
from dispatcher import MainThreadDispatcher
from controllers.navigation_controller import NavigationController
from controllers.barcode_scanner_controller import BarcodeScannerController
from hardware.barcode_scanner import BarcodeScanner
from controllers.check_in_controller import CheckInController
from controllers.account_controller import AccountController
from controllers.rfid_reader_controller import RfidReaderController
from hardware.rfid_reader import Reader
from views.create_account_manual import CreateAccountManual
from views.create_account_no_pid import CreateAccountNoPid
from views.create_account_review import CreateAccountReview
from views.check_in_manual import CheckInManual
from hardware.usb_ports import get_usb_ids
from app_context import AppContext
from controllers.api_controller import ApiController


def clear_and_return(ctx: AppContext):
    ctx.nav.back_to_main()
    ctx.nav.get_frame(CreateAccountManual).clear_entries()
    ctx.nav.get_frame(CreateAccountNoPid).clear_entries()
    ctx.nav.get_frame(CreateAccountReview).clear_entries()
    ctx.nav.get_frame(CheckInManual).clear_entries()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Makerspace Check-in System",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Increase verbosity (print debug info)")
    parser.add_argument("-d", "--dev", action="store_true", help="Enable dev mode with on-screen navigation overlay")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG, stream=stdout)
    else:
        logging.basicConfig(level=logging.INFO)

    dev_mode = args.dev or os.environ.get("DEV_MODE") == "1"

    health_server.start(port=int(os.environ.get("HEALTH_PORT", "8001")))
    health_server.start_watchdog()

    try:
        # QApplication must be created before any QWidget or QObject subclass
        app = QApplication(sys.argv)

        # Restore default SIGINT so Ctrl+C terminates the process
        import signal

        signal.signal(signal.SIGINT, signal.SIG_DFL)

        usb = get_usb_ids()
        ApiController.check_api_health()
        ctx = AppContext.create(usb.traffic_light)
        ctx.dispatcher = MainThreadDispatcher()

        window = CheckInWindow()
        nav = NavigationController(window, ctx, dev_mode=dev_mode)
        ctx.window = window
        ctx.nav = nav
        ctx.check_in = CheckInController(ctx)
        ctx.account = AccountController(ctx)
        ctx.traffic_light.request_off()

        window.set_escape_handler(lambda: clear_and_return(ctx))

        reader = Reader(usb.reader)
        card_reader = RfidReaderController(ctx)
        card_reader.start(reader)

        if usb.barcode:
            ctx.has_barcode_scanner = True
            barcode_scanner = BarcodeScanner(usb.barcode)
            barcode_controller = BarcodeScannerController(ctx)
            barcode_controller.start(barcode_scanner)
        else:
            logging.warning("no barcode scanner found, barcode scanning disabled")

        heartbeat_timer = QTimer()
        heartbeat_timer.setInterval(1000)
        heartbeat_timer.timeout.connect(health_server.heartbeat)
        heartbeat_timer.start()
        QTimer.singleShot(0, health_server.mark_ui_ready)

        logging.info("made it to app start")
        window.start()
        sys.exit(0)
    except SystemExit:
        raise
    except BaseException:
        logging.critical("fatal error during kiosk startup", exc_info=True)
        sys.exit(1)
