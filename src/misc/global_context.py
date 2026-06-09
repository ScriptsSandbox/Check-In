from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController
    from controllers.check_in_controller import CheckInController
    from controllers.account_controller import AccountController
    from controllers.rfid_reader_controller import RFIDReaderController
    from controllers.traffic_light_controller import TrafficLightController
    from controllers.barcode_scanner_controller import BarcodeScannerController
    from controllers.health_controller import HealthController
    from hardware.usb_ports import USBPortController
    from window import MainWindow
    from misc.check_in_session import CheckInSession
    from controllers.api_controller import APIController


_context: GlobalContext

def context() -> GlobalContext:
    return _context


class GlobalContext:
    health_controller: HealthController
    navigation_controller: NavigationController
    check_in_controller: CheckInController
    account_controller: AccountController
    rfid_reader_controller: RFIDReaderController
    barcode_scanner_controller: BarcodeScannerController
    traffic_light_controller: TrafficLightController
    usb_port_controller: USBPortController
    main_window: MainWindow
    session: CheckInSession
    api_controller: APIController

    def __init__(self) -> None:
        global _context
        _context = self