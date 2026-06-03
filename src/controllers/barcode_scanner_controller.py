from __future__ import annotations

import logging
import threading
from threading import Thread

from controllers.health_controller import CriticalSystemType
from hardware.barcode_scanner_netum_nt_em61 import BarcodeScannerNetumNTEM61
from hardware.usb_ports import USBDeviceType
from misc.global_config import config
from misc.global_context import context
from misc.timeout import run_with_timeout
from ui.views.create_account_barcode import CreateAccountBarcode
from ui.views.create_account_manual import CreateAccountManual
from ui.views.create_account_review import CreateAccountReview
from ui.views.home_screen import HomeScreen


class BarcodeScannerController:
    _barcode_scanner: BarcodeScannerNetumNTEM61 | None

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: Thread | None = None
        self._barcode_scanner: BarcodeScannerNetumNTEM61 | None = None

        if config().HAS_BARCODE_SCANNER:
            logging.info("opening barcode scanner serial port")
            port = context().usb_port_controller.get_usb_device_port(USBDeviceType.BARCODE_SCANNER)
            self._barcode_scanner = run_with_timeout(lambda: BarcodeScannerNetumNTEM61(port), "barcode scanner")
            self._thread = Thread(target=self._run, daemon=True)
            self._thread.start()

        logging.info("barcode scanner controller initialized")

    def _reconnect(self) -> bool:
        logging.info("attempting barcode scanner reconnect")
        try:
            assert self._barcode_scanner
            if not self._barcode_scanner.reconnect():
                return False

            self._stop = threading.Event()
            self._thread = Thread(target=self._run, daemon=True)
            self._thread.start()
            return True
        except Exception as e:
            logging.error("barcode scanner reconnect failed: %s", e)
            return False

    def _run(self) -> None:
        assert self._barcode_scanner
        logging.info("now reading barcodes")

        try:
            while not self._stop.is_set():
                barcode = self._barcode_scanner.read_barcode()
                if barcode is None:
                    continue

                logging.debug("raw barcode received: %r", barcode)

                if not self._barcode_scanner.is_valid(barcode):
                    logging.warning("invalid barcode rejected: %r", barcode)
                    continue

                logging.info("barcode scanned: %r", barcode)
                curr_screen = context().navigation_controller.get_curr_screen()

                if curr_screen == HomeScreen:
                    context().check_in_controller.check_in("pid", barcode)
                elif curr_screen in (CreateAccountBarcode, CreateAccountManual):
                    student = context().account_controller.lookup("barcode", barcode)
                    if student is not None:
                        context().session.set_student(student)
                        context().main_window.main_thread_dispatcher.emit(
                            lambda: context().navigation_controller.navigate(CreateAccountReview)
                        )
                else:
                    logging.debug("barcode scanned on ignored screen: %s", curr_screen)
        except Exception as e:
            logging.exception("barcode scanner thread crashed: %s", e)

            self._stop.set()

            context().health_controller.get_system(CriticalSystemType.BARCODE_SCANNER).mark_unhealthy(
                retry_interval=5,
                retry_callback=self._reconnect,
            )
