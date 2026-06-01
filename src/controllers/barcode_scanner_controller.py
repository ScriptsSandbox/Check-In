from __future__ import annotations

import logging
import time
from threading import Thread

from misc.global_config import config
from misc.global_context import context
from hardware.barcode_scanner_netum_nt_em61 import BarcodeScannerNetumNTEM61
from hardware.usb_ports import USBPortController, USBDevice
from ui.views.check_in_rfid import CheckInRFID
from ui.views.create_account_barcode import CreateAccountBarcode
from ui.views.create_account_manual import CreateAccountManual


class BarcodeScannerController:
    _barcode_scanner: BarcodeScannerNetumNTEM61 | None

    def __init__(self) -> None:
        if config().HAS_BARCODE_SCANNER:
            self._barcode_scanner = BarcodeScannerNetumNTEM61(USBPortController.get_usb_device_port(USBDevice.BARCODE_SCANNER))
            self.start()

    def start(self) -> None:
        if not self._barcode_scanner:
            raise RuntimeError("Barcode scanner does not exist and thus cannot be started")

        thread = Thread(target=self._run, daemon=True)
        thread.start()

    def _run(self) -> None:
        assert self._barcode_scanner

        logging.info("now reading barcodes")
        scanner_error = False
        try:
            while True:
                if scanner_error:
                    time.sleep(0.5)
                    if self._barcode_scanner.reconnect():
                        logging.info("barcode scanner reconnected")
                        scanner_error = False
                    continue

                try:
                    barcode = self._barcode_scanner.read_barcode()
                except OSError as e:
                    logging.error("barcode scanner disconnected: %s", e)
                    scanner_error = True
                    continue

                if barcode is None:
                    continue

                logging.debug("raw barcode received: %r", barcode)

                if not self._barcode_scanner.is_valid(barcode):
                    logging.warning("invalid barcode rejected: %r", barcode)
                    continue

                logging.info("barcode scanned: %r", barcode)
                curr_frame = context().navigation_controller.get_curr_frame()

                if curr_frame == CheckInRFID:
                    context().dispatcher.call.emit(
                        lambda b=barcode: context().check_in_controller.handle_by_pid(b)
                    )
                elif curr_frame in (CreateAccountBarcode, CreateAccountManual):
                    context().dispatcher.call.emit(
                        lambda b=barcode: context().account_controller.go_to_review_from_barcode(b)
                    )
                else:
                    logging.debug("barcode scanned on unhandled screen: %s", curr_frame)
        except Exception as e:
            logging.exception("barcode scanner thread crashed: %s", e)
