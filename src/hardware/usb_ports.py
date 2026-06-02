import logging
from dataclasses import dataclass
from enum import Enum

import serial.tools.list_ports

from misc.global_config import config

READER_AND_TRAFFIC_LIGHT_VID = 0x1A86
TRAFFIC_LIGHT_LOCATION = "1-1.1.2"
BARCODE_SCANNER_VID = 0x9901


@dataclass
class UsbIds:
    reader: str | None
    traffic_light: str | None
    barcode: str | None


class USBDevice(Enum):
    RFID_READER = "rfid_reader"
    TRAFFIC_LIGHT = "traffic_light"
    BARCODE_SCANNER = "barcode_scanner"


class USBPortController:
    def __init__(self) -> None:
        self.get_usb_device_port(USBDevice.RFID_READER)
        if config().HAS_TRAFFIC_LIGHT:
            self.get_usb_device_port(USBDevice.TRAFFIC_LIGHT)
        if config().HAS_BARCODE_SCANNER:
            self.get_usb_device_port(USBDevice.BARCODE_SCANNER)
        logging.info("usb port controller initialized")

    @classmethod
    def get_usb_device_port(cls, device: USBDevice) -> str:
        for port in serial.tools.list_ports.comports():
            vendor_id = port.vid

            match device:
                case USBDevice.RFID_READER:
                    if vendor_id == READER_AND_TRAFFIC_LIGHT_VID and port.location != TRAFFIC_LIGHT_LOCATION:
                        return port.device
                case USBDevice.TRAFFIC_LIGHT:
                    if vendor_id == READER_AND_TRAFFIC_LIGHT_VID and port.location == TRAFFIC_LIGHT_LOCATION:
                        return port.device
                case USBDevice.BARCODE_SCANNER:
                    if vendor_id == BARCODE_SCANNER_VID:
                        return port.device
        raise RuntimeError(f"Could not find usb for device {device}")