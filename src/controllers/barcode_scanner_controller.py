from __future__ import annotations

import logging
import time
from threading import Thread
from typing import TYPE_CHECKING

from views.check_in_manual import CheckInManual
from views.create_account_barcode import CreateAccountBarcode
from views.create_account_manual import CreateAccountManual
from app_context import AppContext

if TYPE_CHECKING:
    from hardware.barcode_scanner import BarcodeScanner


class BarcodeScannerController:
    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def start(self, scanner: BarcodeScanner) -> None:
        thread = Thread(target=self._run, args=(scanner,), daemon=True)
        thread.start()

    def _run(self, scanner: BarcodeScanner) -> None:
        logging.info("now reading barcodes")
        scanner_error = False
        try:
            while True:
                if scanner_error:
                    time.sleep(0.5)
                    if scanner.reconnect():
                        logging.info("barcode scanner reconnected")
                        scanner_error = False
                    continue

                try:
                    barcode = scanner.read_barcode()
                except OSError as e:
                    logging.error("barcode scanner disconnected: %s", e)
                    scanner_error = True
                    continue

                if barcode is None:
                    continue

                logging.debug("raw barcode received: %r", barcode)

                if not scanner.is_valid(barcode):
                    logging.warning("invalid barcode rejected: %r", barcode)
                    continue

                logging.info("barcode scanned: %r", barcode)
                curr_frame = self.ctx.nav.get_curr_frame()

                if curr_frame == CheckInManual:
                    self.ctx.dispatcher.call.emit(
                        lambda b=barcode: self.ctx.check_in.handle_by_pid(b)
                    )
                elif curr_frame in (CreateAccountBarcode, CreateAccountManual):
                    self.ctx.dispatcher.call.emit(
                        lambda b=barcode: self.ctx.account.go_to_review_from_barcode(b)
                    )
                else:
                    logging.debug("barcode scanned on unhandled screen: %s", curr_frame)
        except Exception as e:
            logging.exception("barcode scanner thread crashed: %s", e)
