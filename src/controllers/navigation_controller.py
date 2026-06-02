from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING, TypeVar, cast

from PyQt6.QtCore import QTimer
from pyqttoast import ToastPreset

from misc.global_config import config
from misc.global_context import context
from ui.base import Screen
from ui.views.check_in_manual import CheckInManual
from ui.views.check_in_rfid import CheckInRFID
from ui.views.create_account_barcode import CreateAccountBarcode
from ui.views.create_account_manual import CreateAccountManual
from ui.views.create_account_no_pid import CreateAccountNoPid
from ui.views.create_account_review import CreateAccountReview
from ui.views.qr_codes import QRCodes
from ui.views.sign_waiver import SignWaiver
from ui.views.transition_screen import TransitionScreen
from ui.views.user_welcome import UserWelcome

if TYPE_CHECKING:
    from ui.components.dev_overlay import DevOverlay

T = TypeVar("T", bound=Screen)


class NavigationController:
    def __init__(self) -> None:
        self._frames: dict[type[Screen], Screen] = {}
        self._curr_frame: type[Screen] | None = None
        self._frame_uuid: str = uuid.uuid4().hex
        self._dev_overlay: DevOverlay | None = None

        self._timeouts: dict[type[Screen], int] = {
            SignWaiver: 30000,
            QRCodes: 30000,
        }

        for F in (
                CheckInRFID,
                TransitionScreen,
                CreateAccountBarcode,
                CreateAccountManual,
                CreateAccountNoPid,
                CreateAccountReview,
                SignWaiver,
                CheckInManual,
                QRCodes,
                UserWelcome,
        ):
            frame = F(self)
            self._frames[F] = frame
            context().main_window.central.addWidget(frame)

        if config().DEV_MODE:
            from ui.components.dev_overlay import DevOverlay
            self._dev_overlay = DevOverlay(self)

        self.navigate(CheckInRFID)

        logging.info("navigation controller initialized")

    # ------------------------------------------------------------------
    # Core frame switching
    # ------------------------------------------------------------------

    def navigate(self, screen_class: type[T], before_show: Callable[[T], None] | None = None) -> None:
        if self._curr_frame is not None:
            self._frames[self._curr_frame].on_hide()
        self._curr_frame = screen_class
        frame = self.get_frame(screen_class)
        if before_show is not None:
            before_show(frame)
        self._frame_uuid = uuid.uuid4().hex
        context().main_window.central.setCurrentWidget(frame)
        frame.on_show()

        if self._dev_overlay is not None:
            self._dev_overlay.update(screen_class)

        if screen_class in self._timeouts:
            uid = self._frame_uuid
            QTimer.singleShot(
                self._timeouts[screen_class],
                lambda: self.back_to_main() if uid == self._frame_uuid else None,
            )

    def get_frame(self, screen_class: type[T]) -> T:
        return cast(T, self._frames[screen_class])

    def get_curr_frame(self) -> type[Screen] | None:
        return self._curr_frame

    # ------------------------------------------------------------------
    # Stack-based flow
    # ------------------------------------------------------------------

    def push(self, screen_class: type[Screen], on_done: Callable[[], None] | None = None) -> None:
        context().session.push_continuation(on_done)
        self.navigate(screen_class)

    def pop(self) -> None:
        cb = context().session.pop_continuation()
        if cb:
            cb()
        else:
            self.back_to_main()

    # ------------------------------------------------------------------
    # Named navigations
    # ------------------------------------------------------------------

    def back_to_main(self) -> None:
        context().session.reset()
        self.navigate(CheckInRFID)

    def go_to_no_id(self) -> None:
        self.navigate(CheckInManual)

    def go_to_create_account_manual(self) -> None:
        self.navigate(CreateAccountManual)

    def go_to_create_account_no_pid(self) -> None:
        self.navigate(CreateAccountNoPid)

    def go_to_create_account_review(
        self, pid: str = "", first_name: str = "", last_name: str = "", email: str = ""
    ) -> None:
        self.navigate(
            CreateAccountReview,
            lambda s: s.setup(
                first_name=first_name,
                last_name=last_name,
                email=email,
                pid=pid,
                pid_locked=bool(pid),
            ),
        )

    def go_to_create_account(self, on_done: Callable[[], None]) -> None:
        context().main_window.show_toast_async("No Account",
                                              "Looks like you don't have an account yet, let's set one up!", ToastPreset.INFORMATION)
        self.push(CreateAccountBarcode, on_done=on_done)

    def go_to_sign_waiver(self) -> None:
        self.navigate(
            TransitionScreen,
            lambda s: s.setup("Looks like you haven't signed\nthe waiver yet,\nlet's fix that!"),
        )
        QTimer.singleShot(3000, lambda: self.navigate(SignWaiver))

