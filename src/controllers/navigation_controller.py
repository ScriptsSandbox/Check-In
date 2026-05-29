from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING, TypeVar, cast

from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtWidgets import QLabel

from views.check_in_rfid import CheckInRFID
from views.transition_screen import TransitionScreen
from views.create_account_barcode import CreateAccountBarcode
from views.create_account_manual import CreateAccountManual
from views.create_account_no_pid import CreateAccountNoPid
from views.create_account_review import CreateAccountReview
from views.sign_waiver import SignWaiver
from views.check_in_manual import CheckInManual
from views.qr_codes import QRCodes
from views.user_welcome import UserWelcome
from views.base import Screen
from app_context import AppContext

if TYPE_CHECKING:
    from window import CheckInWindow
    from views.components.dev_overlay import DevOverlay

T = TypeVar("T", bound=Screen)


class NavigationController:
    def __init__(self, window: CheckInWindow, ctx: AppContext, dev_mode: bool = False) -> None:
        self.ctx = ctx
        self._window = window
        self._stacked = window.stacked
        self._frames: dict[type[Screen], Screen] = {}
        self._curr: type[Screen] | None = None
        self._frame_uuid: str = uuid.uuid4().hex
        self._on_done_stack: list[Callable[[], None] | None] = []
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
            self._stacked.addWidget(frame)

        # Status overlay — floats over the stacked widget at the bottom
        self._status_label = QLabel("", window.central)
        self._status_label.setGeometry(40, 628, 1200, 56)
        self._status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._status_label.setStyleSheet(
            "color: #F5F0E6;"
            "font: bold 18pt Montserrat;"
            "background-color: rgba(0, 0, 0, 170);"
            "border-radius: 10px;"
            "border: none;"
        )
        self._status_label.hide()
        self._status_label.raise_()

        if dev_mode:
            from views.components.dev_overlay import DevOverlay
            self._dev_overlay = DevOverlay(window, self)

        self.show_frame(CheckInRFID)

    # ------------------------------------------------------------------
    # Core frame switching
    # ------------------------------------------------------------------

    def show_frame(self, screen_class: type[Screen]) -> None:
        if self._curr is not None:
            self._frames[self._curr].on_hide()
        self._curr = screen_class
        self._frame_uuid = uuid.uuid4().hex
        self._stacked.setCurrentWidget(self._frames[screen_class])
        self._frames[screen_class].on_show()

        if self._dev_overlay is not None:
            self._dev_overlay.update(screen_class)

        if screen_class in self._timeouts:
            uid = self._frame_uuid
            QTimer.singleShot(
                self._timeouts[screen_class],
                lambda: self._on_timeout(uid),
            )

    def get_frame(self, screen_class: type[T]) -> T:
        return cast(T, self._frames[screen_class])

    def get_curr_frame(self) -> type[Screen] | None:
        return self._curr

    # ------------------------------------------------------------------
    # Status overlay
    # ------------------------------------------------------------------

    def show_status(self, text: str) -> None:
        self._status_label.setText(text)
        self._status_label.show()
        self._status_label.raise_()

    def hide_status(self) -> None:
        self._status_label.hide()

    # ------------------------------------------------------------------
    # Stack-based flow
    # ------------------------------------------------------------------

    def push(self, screen_class: type[Screen], on_done: Callable[[], None] | None = None) -> None:
        self._on_done_stack.append(on_done)
        self.show_frame(screen_class)

    def pop(self) -> None:
        cb = self._on_done_stack.pop() if self._on_done_stack else None
        if cb:
            cb()
        else:
            self.back_to_main()

    # ------------------------------------------------------------------
    # Named navigations
    # ------------------------------------------------------------------

    def back_to_main(self) -> None:
        self._on_done_stack.clear()
        self.ctx.rfid = ""
        self.ctx.traffic_light.request_off()
        self.show_frame(CheckInRFID)

    def go_to_no_id(self) -> None:
        self.get_frame(CheckInManual).clear_entries()
        self.show_frame(CheckInManual)

    def go_to_create_account_manual(self) -> None:
        self.get_frame(CreateAccountManual).clear_entries()
        self.show_frame(CreateAccountManual)

    def go_to_create_account_no_pid(self) -> None:
        self.get_frame(CreateAccountNoPid).clear_entries()
        self.show_frame(CreateAccountNoPid)

    def go_to_create_account_review(
        self, pid: str = "", first_name: str = "", last_name: str = "", email: str = ""
    ) -> None:
        pid_locked = bool(pid)
        self.get_frame(CreateAccountReview).setup(
            first_name=first_name,
            last_name=last_name,
            email=email,
            pid=pid,
            pid_locked=pid_locked,
        )
        self.show_frame(CreateAccountReview)

    def go_to_create_account(self, on_done: Callable[[], None]) -> None:
        self.get_frame(TransitionScreen).display(
            "Looks like you don't have an account,\nlet's set one up!"
        )
        QTimer.singleShot(3000, lambda: self.push(CreateAccountBarcode, on_done=on_done))

    def go_to_sign_waiver(self) -> None:
        self.get_frame(TransitionScreen).display(
            "Looks like you haven't signed\nthe waiver yet,\nlet's fix that!"
        )
        QTimer.singleShot(3000, lambda: self.show_frame(SignWaiver))

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _on_timeout(self, uid: str) -> None:
        if uid == self._frame_uuid:
            self.back_to_main()
