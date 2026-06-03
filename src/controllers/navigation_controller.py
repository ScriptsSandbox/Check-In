from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from typing import TypeVar, cast

from PyQt6.QtCore import QTimer

from misc.global_context import context
from ui.base import Screen
from ui.views.check_in_manual import CheckInManual
from ui.views.create_account_barcode import CreateAccountBarcode
from ui.views.create_account_manual import CreateAccountManual
from ui.views.create_account_review import CreateAccountReview
from ui.views.home_screen import HomeScreen
from ui.views.qr_codes import QRCodes
from ui.views.sign_waiver import SignWaiver
from ui.views.transition_screen import TransitionScreen
from ui.views.user_welcome import UserWelcome

T = TypeVar("T", bound=Screen)

_timeouts: dict[type[Screen], int] = {
    SignWaiver: 30000,
    QRCodes: 30000,
}


class NavigationController:
    def __init__(self) -> None:
        self._screens: dict[type[Screen], Screen] = {}
        self._curr_screen: type[Screen] | None = None
        self._screen_uuid: str = uuid.uuid4().hex

        for Screen in (
                HomeScreen,
                TransitionScreen,
                CreateAccountBarcode,
                CreateAccountManual,
                CreateAccountReview,
                SignWaiver,
                CheckInManual,
                QRCodes,
                UserWelcome,
        ):
            screen = Screen(self)
            self._screens[Screen] = screen
            context().main_window.central.addWidget(screen)

        self.navigate(HomeScreen)

        logging.info("navigation controller initialized")

    def navigate(self, screen_class: type[T]) -> None:
        if self._curr_screen is not None:
            self._screens[self._curr_screen].on_hide()
        self._curr_screen = screen_class
        screen = self.get_screen(screen_class)
        self._screen_uuid = uuid.uuid4().hex
        context().main_window.central.setCurrentWidget(screen)
        screen.on_show()

        if screen_class in _timeouts:
            uid = self._screen_uuid
            QTimer.singleShot(
                _timeouts[screen_class],
                lambda: self.reset_check_in_session() if uid == self._screen_uuid else None,
            )

    def navigate_via_transition(self, message: str, *, delay_ms: int, next_action: Callable[[], None]) -> None:
        self.get_screen(TransitionScreen).set_message(message)
        self.navigate(TransitionScreen)
        uid = self._screen_uuid
        QTimer.singleShot(delay_ms, lambda: next_action() if uid == self._screen_uuid else None)

    def reset_check_in_session(self) -> None:
        context().session.reset()
        self.navigate(HomeScreen)

    def get_screen(self, screen_class: type[T]) -> T:
        return cast(T, self._screens[screen_class])

    def get_curr_screen(self) -> type[Screen] | None:
        return self._curr_screen
