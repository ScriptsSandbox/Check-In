from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING, TypeVar, cast

from PyQt6.QtCore import QTimer
from pyqttoast import ToastPreset

from global_config import config
from global_context import context
from hardware.traffic_light import TrafficLightState
from views.base import Screen
from views.check_in_manual import CheckInManual
from views.check_in_rfid import CheckInRFID
from views.create_account_barcode import CreateAccountBarcode
from views.create_account_manual import CreateAccountManual
from views.create_account_no_pid import CreateAccountNoPid
from views.create_account_review import CreateAccountReview
from views.qr_codes import QRCodes
from views.sign_waiver import SignWaiver
from views.transition_screen import TransitionScreen
from views.user_welcome import UserWelcome

if TYPE_CHECKING:
    from views.components.dev_overlay import DevOverlay

T = TypeVar("T", bound=Screen)


class NavigationController:
    def __init__(self) -> None:
        pass

    def start(self) -> None:
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
            context().main_window.central.addWidget(frame)

        if config().DEV_MODE:
            from views.components.dev_overlay import DevOverlay
            self._dev_overlay = DevOverlay(self)

        self.show_frame(CheckInRFID)

    # ------------------------------------------------------------------
    # Core frame switching
    # ------------------------------------------------------------------

    def show_frame(self, screen_class: type[Screen]) -> None:
        if self._curr is not None:
            self._frames[self._curr].on_hide()
        self._curr = screen_class
        self._frame_uuid = uuid.uuid4().hex
        context().main_window.central.setCurrentWidget(self._frames[screen_class])
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
        context().rfid = ""
        context().traffic_light_controller.request_state(TrafficLightState.OFF)
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
        context().main_window.show_toast("No Account",
                                        "Looks like you don't have an account yet, let's set one up!", ToastPreset.INFORMATION)
        # self.get_frame(TransitionScreen).display(
        #     "Looks like you don't have an account,\nlet's set one up!"
        # )
        # context().dispatcher.call.emit(lambda: self.push(CreateAccountBarcode, on_done=on_done))
        self.push(CreateAccountBarcode, on_done=on_done)
        # QTimer.singleShot(3000, lambda: self.push(CreateAccountBarcode, on_done=on_done))

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
