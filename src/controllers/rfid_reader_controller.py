from __future__ import annotations

import threading
import time
import logging
import traceback
from collections.abc import Callable
from os.path import exists
from threading import Thread

from controllers.health_controller import CriticalSystemType
from misc.global_config import config
from misc.global_context import context
from misc.timeout import run_with_timeout
from hardware.rfid_reader_aitrip import RFIDReaderAITRIP
from hardware.usb_ports import USBDevice
from ui.views.check_in_rfid import CheckInRFID


class RFIDReaderController:
    def __init__(self) -> None:
        logging.info("opening RFID reader serial port")
        port = context().usb_port_controller.get_usb_device_port(USBDevice.RFID_READER)
        def _hung_connect() -> RFIDReaderAITRIP:  # TEMP: simulate wedged hardware to test boot timeout
            time.sleep(10)
            return RFIDReaderAITRIP(port)
        self._reader = run_with_timeout(_hung_connect, "RFID reader")
        self._stop = threading.Event()
        self._thread: Thread | None = None
        self._disconnect_fired = False
        self._thread = Thread(target=self._run, args=(self._reader,), daemon=True, name="rfid-reader")
        self._thread.start()

        logging.info("rfid reader controller initialized")

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        if self._reader is not None:
            self._reader.close()

    def on_reader_disconnect(self) -> None:
        if self._disconnect_fired:
            return
        self._disconnect_fired = True
        self._stop.set()

        context().health_controller.get_system(CriticalSystemType.RFID_READER).mark_unhealthy(
            retry_interval=5,
            retry_callback=self._reconnect,
        )

    def _reconnect(self) -> bool:
        logging.info("attempting RFID reader reconnect")
        try:
            port = context().usb_port_controller.get_usb_device_port(USBDevice.RFID_READER)
            self._reader = RFIDReaderAITRIP(port)
            self._stop = threading.Event()
            self._disconnect_fired = False
            self._thread = Thread(target=self._run, args=(self._reader,), daemon=True, name="rfid-reader")
            self._thread.start()
            return True
        except Exception as e:
            logging.error("RFID reader reconnect failed: %s", e)
            return False

    def _run(self, reader: RFIDReaderAITRIP) -> None:
        try:
            logging.info("now reading ID cards")
            last_tag: str | None = None
            last_time: float = 0

            while not self._stop.is_set():
                try:
                    in_waiting = reader.get_ser_in_waiting()
                except OSError as e:
                    if not exists(reader._usb_id):
                        logging.error("card reader disconnected: %s", e)
                        self.on_reader_disconnect()
                        return
                    logging.debug("card reader transient error, retrying: %s", e)
                    time.sleep(0.2)
                    continue

                if in_waiting >= 14:
                    tag = reader.grab_rfid()

                    if " " in tag:
                        continue

                    if tag == last_tag and not reader.can_scan_again(last_time):
                        logging.debug("suppressing repeat scan")
                        continue

                    s_reason = reader.check_rfid(tag)

                    if s_reason != "good":
                        logging.debug(s_reason)
                        continue
                    else:
                        logging.debug("RFID check succeeded")

                    if context().navigation_controller.get_curr_frame() != CheckInRFID:
                        logging.debug("ignoring card tap off home screen")
                        continue

                    context().session.rfid = tag
                    context().check_in_controller.check_in("rfid", tag)

                    last_tag = tag
                    last_time = time.time()
        except Exception as exception:
            tb = traceback.format_exc()
            logging.critical("RFID reader thread died: %s\n%s", exception, tb)
            self.on_reader_disconnect()