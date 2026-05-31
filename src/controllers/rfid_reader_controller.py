from __future__ import annotations

import threading
import time
import logging
import traceback
from collections.abc import Callable
from os.path import exists
from threading import Thread, Event
from typing import TYPE_CHECKING

from controllers.api_controller import ApiController
from global_context import context
from hardware.rfid_reader import RFIDReader
from hardware.usb_ports import USBDevice
from views.create_account_manual import CreateAccountManual


class RFIDReaderController:
    _reader: RFIDReader

    def __init__(self) -> None:
        pass

    def start(self) -> None:
        self._reader = RFIDReader(context().usb_port_controller.get_usb_device_port(USBDevice.RFID_READER))
        self._stop = threading.Event()
        self._thread: Thread | None = None
        self._on_disconnect: Callable[[str], None] | None = None
        self._disconnect_fired = False

        self._disconnect_fired = False
        self._thread = Thread(target=self._run, args=(self._reader,), daemon=True, name="rfid-reader")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        if self._reader is not None:
            self._reader.close()

    def on_reader_disconnect(self, reason: str) -> None:
        logging.warning("RFID reader disconnected: %s", reason)
        context().mainWindow.show_error(
            "Card reader not detected",
            reason,
            retry_in=context().config.HARDWARE_RETRY_DELAY_SECONDS,
            # on_retry=startup,
        )

    def _fire_disconnect(self, reason: str) -> None:
        if self._disconnect_fired:
            return
        self._disconnect_fired = True
        self._stop.set()

        cb = self.on_reader_disconnect
        if cb is not None:
            context().dispatcher.call.emit(lambda: cb(reason))

    def _run(self, reader: RFIDReader) -> None:
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
                        self._fire_disconnect(f"Card reader at {reader._usb_id} no longer present")
                        return
                    logging.debug("card reader transient error, retrying: %s", e)
                    time.sleep(0.2)
                    continue

                if in_waiting >= 14:
                    context().dispatcher.call.emit(
                        lambda: context().navigation_controller.get_frame(CreateAccountManual).clear_entries()
                    )
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

                    context().rfid = tag
                    context().check_in_controller.handle_by_uuid(tag)

                    last_tag = tag
                    last_time = time.time()
        except Exception as exception:
            tb = traceback.format_exc()
            logging.critical("RFID reader thread died: %s\n%s", exception, tb)
            # notifier.notify_critical(
            #     "RFID reader thread died",
            #     f"{type(exception).__name__}: {exception}\n\n{tb[-1500:]}",
            # )
            self._fire_disconnect(f"{type(exception).__name__}: {exception}")