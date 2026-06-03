from __future__ import annotations

import logging
import threading
import time
import traceback
from threading import Thread

from controllers.health_controller import CriticalSystemType
from hardware.rfid_reader_aitrip import RFIDReaderAITRIP
from hardware.usb_ports import USBDeviceType
from misc.global_context import context
from misc.timeout import run_with_timeout
from ui.views.home_screen import HomeScreen


class RFIDReaderController:
    def __init__(self) -> None:
        logging.info("opening RFID reader serial port")

        port = context().usb_port_controller.get_usb_device_port(USBDeviceType.RFID_READER)
        self._reader = run_with_timeout(lambda: RFIDReaderAITRIP(port), "RFID Reader")

        self._stop = threading.Event()

        self._thread: Thread | None = None
        self._thread = Thread(target=self._run, args=(self._reader,), daemon=True, name="rfid-reader")
        self._thread.start()

        logging.info("rfid reader controller initialized")

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        if self._reader is not None:
            self._reader.close()

    def _reconnect(self) -> bool:
        logging.info("attempting RFID reader reconnect")
        try:
            port = context().usb_port_controller.get_usb_device_port(USBDeviceType.RFID_READER)
            self._reader = RFIDReaderAITRIP(port)
            self._stop = threading.Event()
            self._thread = Thread(target=self._run, args=(self._reader,), daemon=True, name="rfid-reader")
            self._thread.start()
            return True
        except Exception as e:
            logging.error("RFID reader reconnect failed: %s", e)
            return False

    # The PN532 over UART intermittently fails to return its ACK. This is a
    # transient serial glitch the reader recovers from, so tolerate a burst of
    # consecutive failures before treating the reader as genuinely dead.
    _MAX_CONSECUTIVE_ERRORS = 10

    def _run(self, reader: RFIDReaderAITRIP) -> None:
        logging.info("now reading ID cards")
        last_tag: str | None = None
        last_time: float = 0
        consecutive_errors = 0

        try:
            while not self._stop.is_set():
                try:
                    tag = reader.read_rfid()
                except OSError as e:
                    if not reader.is_present():
                        raise
                    consecutive_errors += 1
                    if consecutive_errors >= self._MAX_CONSECUTIVE_ERRORS:
                        raise
                    logging.warning(
                        "transient RFID read error (%d/%d): %s",
                        consecutive_errors, self._MAX_CONSECUTIVE_ERRORS, e,
                    )
                    context().health_controller.get_system(CriticalSystemType.RFID_READER).notify_log(
                        f"transient read error ({consecutive_errors}/{self._MAX_CONSECUTIVE_ERRORS}): {e}"
                    )
                    reader.flush()
                    time.sleep(0.05)
                    continue

                consecutive_errors = 0

                if tag is None:
                    continue

                if tag == last_tag and not reader.can_scan_again(last_time):
                    logging.debug("suppressing repeat scan")
                    continue

                if context().navigation_controller.get_curr_screen() != HomeScreen:
                    logging.debug("ignoring card tap off home screen")
                    continue

                last_tag = tag
                last_time = time.time()

                context().session.rfid = tag
                context().check_in_controller.check_in("rfid", tag)
        except Exception as exception:
            tb = traceback.format_exc()
            logging.critical("RFID reader thread died: %s\n%s", exception, tb)

            self._stop.set()

            context().health_controller.get_system(CriticalSystemType.RFID_READER).mark_unhealthy(
                retry_interval=5,
                retry_callback=self._reconnect,
            )