from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from PyQt6.QtCore import QTimer

from controllers.api_controller import ApiController
from views.user_welcome import UserWelcome
from views.transition_screen import TransitionScreen
from app_context import AppContext


class CheckInController:
    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def handle_by_uuid(self, tag: str) -> None:
        # Called from background thread — dispatch to main thread via signal.
        self.ctx.dispatcher.call.emit(
            lambda: self._run_check_in(tag, ApiController.checkin_by_uuid)
        )

    def handle_by_pid(self, pid: str) -> None:
        # Called on main thread (button click or barcode dispatcher).
        self._run_check_in(pid, ApiController.checkin_by_pid)

    def _run_check_in(
        self,
        identifier: str,
        check_fn: Callable[[str], dict[str, Any]],
        welcome_message: str = "Welcome back",
    ) -> None:
        result = check_fn(identifier)
        status = result.get("status")

        if status == "api_error":
            logging.error("API error during check-in")
            self.ctx.traffic_light.request_red()
            self.ctx.nav.show_status("System error, please let staff know.")
            QTimer.singleShot(4000, self.ctx.nav.hide_status)
            return

        if status == "no_account":
            logging.info(f"no account found for {identifier}")
            self.ctx.traffic_light.request_red()
            if not self.ctx.has_barcode_scanner:
                self.ctx.nav.get_frame(TransitionScreen).display(
                    "Looks like you don't have an account.\nUse the other kiosk to set one up!"
                )
                QTimer.singleShot(6000, self.ctx.nav.back_to_main)
                return
            self.ctx.nav.go_to_create_account(
                on_done=lambda: self._run_check_in(
                    identifier, check_fn, welcome_message="Thank you for registering"
                )
            )
            return

        if status == "no_waiver":
            logging.info(f"no waiver for {identifier}")
            self.ctx.traffic_light.request_yellow()
            self.ctx.nav.go_to_sign_waiver()
            return

        logging.info(f"check-in successful: {result['name']}")
        self.ctx.traffic_light.request_green()
        self.ctx.nav.get_frame(UserWelcome).display_name(result["name"], welcome_message)
