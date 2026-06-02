from __future__ import annotations

import logging
import threading
from threading import Thread

from controllers.health_controller import CriticalSystemType
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
        self._stop = threading.Event()
        self._disconnect_fired = False
        self._thread: Thread | None = None
        if config().HAS_BARCODE_SCANNER:
            self._barcode_scanner = BarcodeScannerNetumNTEM61(USBPortController.get_usb_device_port(USBDevice.BARCODE_SCANNER))
            self._thread = Thread(target=self._run, daemon=True)
            self._thread.start()

    def on_scanner_disconnect(self) -> None:
        if self._disconnect_fired:
            return
        self._disconnect_fired = True
        self._stop.set()
        context().health_controller.get_system(CriticalSystemType.BARCODE_SCANNER).mark_unhealthy(
            retry_interval=5,
            retry_callback=self._reconnect,
        )

    def _reconnect(self) -> bool:
        logging.info("attempting barcode scanner reconnect")
        try:
            assert self._barcode_scanner
            if not self._barcode_scanner.reconnect():
                return False
            self._stop = threading.Event()
            self._disconnect_fired = False
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
                try:
                    barcode = self._barcode_scanner.read_barcode()
                except OSError as e:
                    logging.error("barcode scanner disconnected: %s", e)
                    self.on_scanner_disconnect()
                    return

                if barcode is None:
                    continue

                logging.debug("raw barcode received: %r", barcode)

                if not self._barcode_scanner.is_valid(barcode):
                    logging.warning("invalid barcode rejected: %r", barcode)
                    continue

                logging.info("barcode scanned: %r", barcode)
                curr_frame = context().navigation_controller.get_curr_frame()

                if curr_frame == CheckInRFID:
                    context().check_in_controller.check_in("pid", barcode)
                elif curr_frame in (CreateAccountBarcode, CreateAccountManual):
                    context().dispatcher.call.emit(
                        lambda b=barcode: context().account_controller.lookup("barcode", b)
                    )
                else:
                    logging.debug("barcode scanned on unhandled screen: %s", curr_frame)
        except Exception as e:
            logging.exception("barcode scanner thread crashed: %s", e)
            self.on_scanner_disconnect()
