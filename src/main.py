from __future__ import annotations

import sys
import logging
import argparse
import os
from typing import Any
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
from controllers.api_controller import ApiController, ApiUnreachableError

API_RETRY_DELAY_S = 10
API_MONITOR_INTERVAL_S = 15
HARDWARE_RETRY_DELAY_S = 5


def clear_and_return(ctx: AppContext) -> None:
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

    app = QApplication(sys.argv)

    import signal
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    window = CheckInWindow()
    window.showFullScreen()

    heartbeat_timer = QTimer()
    heartbeat_timer.setInterval(1000)
    heartbeat_timer.timeout.connect(health_server.heartbeat)
    heartbeat_timer.start()
    QTimer.singleShot(0, health_server.mark_ui_ready)

    state: dict[str, Any] = {
        "app_initialized": False,
        "reader_attached": False,
        "monitor_started": False,
        "ctx": None,
    }

    def monitor_api() -> None:
        try:
            ApiController.ping()
        except ApiUnreachableError as e:
            window.show_error(
                "Lost connection to API",
                str(e),
                retry_in=API_RETRY_DELAY_S,
                on_retry=monitor_api,
            )
            return
        if window.is_error_visible():
            window.hide_error()
        QTimer.singleShot(API_MONITOR_INTERVAL_S * 1000, monitor_api)

    def build_app_context() -> AppContext:
        ctx = AppContext.create(get_usb_ids().traffic_light)
        ctx.dispatcher = MainThreadDispatcher()
        nav = NavigationController(window, ctx, dev_mode=dev_mode)
        ctx.window = window
        ctx.nav = nav
        ctx.check_in = CheckInController(ctx)
        ctx.account = AccountController(ctx)
        ctx.traffic_light.request_off()
        window.set_escape_handler(lambda: clear_and_return(ctx))
        return ctx

    def on_reader_disconnect(reason: str) -> None:
        logging.warning("RFID reader disconnected: %s", reason)
        state["reader_attached"] = False
        window.show_error(
            "Card reader not detected",
            reason,
            retry_in=HARDWARE_RETRY_DELAY_S,
            on_retry=startup,
        )

    def attach_reader(ctx: AppContext) -> None:
        usb = get_usb_ids()
        reader = Reader(usb.reader)  # type: ignore[arg-type]
        card_reader = RfidReaderController(ctx)
        card_reader.start(reader, on_disconnect=on_reader_disconnect)
        ctx.card_reader = card_reader

        if usb.barcode:
            ctx.has_barcode_scanner = True
            barcode_scanner = BarcodeScanner(usb.barcode)
            barcode_controller = BarcodeScannerController(ctx)
            barcode_controller.start(barcode_scanner)
        else:
            logging.warning("no barcode scanner found, barcode scanning disabled")

    def shutdown() -> None:
        ctx = state.get("ctx")
        if ctx is not None and getattr(ctx, "card_reader", None) is not None:
            ctx.card_reader.stop()

    app.aboutToQuit.connect(shutdown)

    def startup() -> None:
        try:
            ApiController.ping()
        except ApiUnreachableError as e:
            window.show_error(
                "Cannot reach API",
                str(e),
                retry_in=API_RETRY_DELAY_S,
                on_retry=startup,
            )
            return

        if not state["app_initialized"]:
            try:
                ctx = build_app_context()
            except BaseException as e:
                logging.critical("fatal error during kiosk app init", exc_info=True)
                window.show_error(
                    "Kiosk failed to initialize",
                    f"{type(e).__name__}: {e}",
                )
                return
            state["ctx"] = ctx
            state["app_initialized"] = True

        if not state["reader_attached"]:
            try:
                attach_reader(state["ctx"])
            except RuntimeError as e:
                window.show_error(
                    "Card reader not detected",
                    str(e),
                    retry_in=HARDWARE_RETRY_DELAY_S,
                    on_retry=startup,
                )
                return
            state["reader_attached"] = True

        window.hide_error()
        logging.info("made it to app start")
        if not state["monitor_started"]:
            state["monitor_started"] = True
            QTimer.singleShot(API_MONITOR_INTERVAL_S * 1000, monitor_api)

    QTimer.singleShot(0, startup)
    sys.exit(app.exec())
