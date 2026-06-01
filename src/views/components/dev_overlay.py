from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel, QPushButton
from PyQt6.QtCore import Qt, QTimer

from global_config import config
from global_context import context
from hardware.traffic_light import TrafficLightState
from views.check_in_rfid import CheckInRFID
from views.create_account_barcode import CreateAccountBarcode
from views.create_account_manual import CreateAccountManual
from views.create_account_no_pid import CreateAccountNoPid
from views.create_account_review import CreateAccountReview
from views.sign_waiver import SignWaiver
from views.check_in_manual import CheckInManual
from views.qr_codes import QRCodes
from views.user_welcome import UserWelcome
from views.transition_screen import TransitionScreen
from views.base import Screen
from controllers.navigation_controller import NavigationController

_DEV_NAME = "Dev User"
_DEV_EMAIL = "devuser@ucsd.edu"
_DEV_PID = "A12345678"
_DEV_RFID = "1a2b3c4d5e6f7g"
_THANK_MSG = "Thank you for registering"


def _sim_no_account_success(nav: NavigationController) -> None:
    context().rfid = _DEV_RFID
    if not config().HAS_BARCODE_SCANNER:
        nav.get_frame(TransitionScreen).display(
            "Looks like you don't have an account.\nUse the other kiosk to set one up!"
        )
        QTimer.singleShot(6000, nav.back_to_main)
        return

    def on_done() -> None:
        context().traffic_light_controller.request_state(TrafficLightState.GREEN)
        nav.get_frame(UserWelcome).display_name(_DEV_NAME, _THANK_MSG)

    nav.go_to_create_account(on_done=on_done)


def _sim_no_account_needs_waiver(nav: NavigationController) -> None:
    context().rfid = _DEV_RFID
    if not config().HAS_BARCODE_SCANNER:
        nav.get_frame(TransitionScreen).display(
            "Looks like you don't have an account.\nUse the other kiosk to set one up!"
        )
        QTimer.singleShot(6000, nav.back_to_main)
        return
    nav.go_to_create_account(on_done=nav.go_to_sign_waiver)


def _sim_barcode_swipe(nav: NavigationController) -> None:
    nav.go_to_create_account_review(
        pid=_DEV_PID,
        first_name=_DEV_NAME.split()[0],
        last_name=_DEV_NAME.split()[1],
        email=_DEV_EMAIL,
    )


TRANSITIONS: dict[type[Screen], list[tuple[str, Callable[[NavigationController], None]]]] = {
    CheckInRFID: [
        ("QR Codes", lambda nav: nav.show_frame(QRCodes)),
        ("No ID", lambda nav: nav.go_to_no_id()),
        ("card: success", lambda nav: nav.get_frame(UserWelcome).display_name(_DEV_NAME)),
        ("card: no account [→ success]", _sim_no_account_success),
        ("card: no account [→ waiver]", _sim_no_account_needs_waiver),
        ("card: no waiver", lambda nav: nav.go_to_sign_waiver()),
    ],
    QRCodes: [
        ("← Main", lambda nav: nav.back_to_main()),
    ],
    CheckInManual: [
        ("← Main", lambda nav: nav.back_to_main()),
        ("PID: success", lambda nav: nav.get_frame(UserWelcome).display_name(_DEV_NAME)),
        ("PID: no account [→ success]", _sim_no_account_success),
        ("PID: no account [→ waiver]", _sim_no_account_needs_waiver),
        ("PID: no waiver", lambda nav: nav.go_to_sign_waiver()),
    ],
    CreateAccountBarcode: [
        ("sim barcode swipe", _sim_barcode_swipe),
        ("manual fill", lambda nav: nav.go_to_create_account_manual()),
        ("← Main", lambda nav: nav.back_to_main()),
    ],
    CreateAccountManual: [
        ("→ review (pid lookup)", lambda nav: context().account_controller.go_to_review_from_pid(_DEV_PID)),
        ("→ no-pid screen", lambda nav: nav.go_to_create_account_no_pid()),
        ("← Main", lambda nav: nav.back_to_main()),
    ],
    CreateAccountNoPid: [
        ("submit", lambda nav: nav.pop()),
        ("← Main", lambda nav: nav.back_to_main()),
    ],
    CreateAccountReview: [
        ("submit", lambda nav: nav.pop()),
        ("← Main", lambda nav: nav.back_to_main()),
    ],
    SignWaiver: [
        ("← Main", lambda nav: nav.back_to_main()),
    ],
}


class DevOverlay(QWidget):

    def __init__(self, nav: NavigationController) -> None:
        super().__init__(context().main_window.central)
        self._nav = nav
        self._buttons: list[QPushButton] = []

        self.setStyleSheet("QWidget { background-color: #1a1a2e; }")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(2)

        header = QLabel("DEV NAV")
        header.setStyleSheet(
            "color: #aaaaaa; font: bold 9pt Courier;"
            "background: transparent; border: none;"
        )
        header.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(header)

        self._layout = layout

    def update(self, screen_class: type[Screen]) -> None:  # type: ignore[override]
        while self._layout.count() > 1:
            item = self._layout.takeAt(1)
            w = item.widget()  # type: ignore[union-attr]
            if w:
                w.setParent(None)
        self._buttons.clear()

        for label, action in TRANSITIONS.get(screen_class, []):
            btn = QPushButton(label)
            btn.setStyleSheet("""
                QPushButton {
                    background-color: #2a2a4e;
                    color: white;
                    font: 9pt Courier;
                    padding: 3px 6px;
                    border: none;
                    text-align: left;
                }
                QPushButton:hover { background-color: #4a4a8e; }
            """)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda checked, a=action: a(self._nav))
            self._layout.addWidget(btn)
            self._buttons.append(btn)

        QTimer.singleShot(0, self._refresh)

    def _refresh(self) -> None:
        self.adjustSize()
        self._reposition()
        self.raise_()
        self.show()

    def _reposition(self) -> None:
        self.move(
            25,
            config().SCREEN_HEIGHT - self.height() - 25,
        )
