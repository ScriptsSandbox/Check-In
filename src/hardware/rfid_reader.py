from threading import Thread
from os.path import exists
import logging
import serial
import time
from typing import Any

from adafruit_pn532.uart import PN532_UART

expected_characters = 14


class RFIDReader(Thread):
    def __init__(self, usb_id: str) -> None:
        super().__init__()
        self._usb_id = usb_id
        self._pn532: Any | None = None
        self._pending_tag: str | None = None
        if not usb_id or not exists(usb_id):
            raise RuntimeError(f"Card reader not found at {usb_id!r}")
        try:
            self._init_pn532()
            logging.info("card reader init finished")
        except Exception as e:
            raise RuntimeError(f"Card reader failed to initialize: {e}") from e

    def _init_pn532(self) -> None:
        if self._pn532 is not None:
            try:
                self._pn532._uart.close()
            except Exception as e:
                logging.warning("failed to close card reader serial port: %s", e)
            self._pn532 = None
        uart = serial.Serial(self._usb_id, baudrate=115200, timeout=0.1)
        try:
            uart.reset_input_buffer()
            uart.reset_output_buffer()
            time.sleep(0.1)
            self._pn532 = PN532_UART(uart, debug=False)
        except Exception:
            uart.close()
            raise

    def reconnect(self) -> bool:
        if not exists(self._usb_id):
            return False
        try:
            self._init_pn532()
            return True
        except Exception as e:
            logging.warning("card reader reconnect attempt failed: %s", e)
            self._pn532 = None
            return False

    def get_ser_in_waiting(self) -> int:
        try:
            uid = self._pn532.read_passive_target(timeout=0.1)  # type: ignore[union-attr]
        except Exception as e:
            raise OSError(f"PN532 error: {e}")
        if uid:
            self._pending_tag = "".join(f"{b:02X}" for b in uid)
            time.sleep(0.01)
            self._pn532._uart.reset_input_buffer()  # type: ignore[union-attr]
            return expected_characters
        self._pending_tag = None
        return 0

    def grab_rfid(self) -> str:
        tag = self._pending_tag
        self._pending_tag = None
        logging.info("parsed tag: " + str(tag))
        return str(tag)

    def check_rfid(self, tag: str) -> str:
        if not tag or len(tag) != expected_characters:
            return "Tag was not the expected number of chars"
        return "good"

    def can_scan_again(self, last_time: float) -> bool:
        return time.time() - last_time > 3

    def close(self) -> None:
        if self._pn532 is not None:
            try:
                self._pn532._uart.close()
            except Exception as e:
                logging.warning("error closing card reader serial port: %s", e)
            self._pn532 = None
