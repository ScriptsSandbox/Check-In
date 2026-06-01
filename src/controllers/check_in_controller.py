from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from PyQt6.QtCore import QTimer
from pyqttoast import ToastPreset

from controllers.api_controller import ApiController
from misc.global_config import config
from misc.global_context import context
from hardware.traffic_light import TrafficLightState
from views.user_welcome import UserWelcome
from views.transition_screen import TransitionScreen


class CheckInController:
    def __init__(self) -> None:
        pass

    def handle_by_uuid(self, tag: str) -> None:
        context().dispatcher.call.emit(
            lambda: self._run_check_in(tag, ApiController.checkin_by_uuid)
        )

    def handle_by_pid(self, pid: str) -> None:
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
            context().traffic_light_controller.request_state(TrafficLightState.RED)
            context().main_window.show_toast("System Error", "Please let staff know", ToastPreset.ERROR)
            return

        if status == "no_account":
            logging.info(f"no account found for {identifier}")
            context().traffic_light_controller.request_state(TrafficLightState.RED)
            if not config().HAS_BARCODE_SCANNER:
                context().navigation_controller.navigate(
                    TransitionScreen,
                    lambda s: s.setup("Looks like you don't have an account.\nUse the other kiosk to set one up!"),
                )
                QTimer.singleShot(6000, context().navigation_controller.back_to_main)
                return
            context().navigation_controller.go_to_create_account(
                on_done=lambda: self._run_check_in(
                    identifier, check_fn, welcome_message="Thank you for registering"
                )
            )
            return

        if status == "no_waiver":
            logging.info(f"no waiver for {identifier}")
            context().traffic_light_controller.request_state(TrafficLightState.YELLOW)
            context().navigation_controller.go_to_sign_waiver()
            return

        logging.info(f"check-in successful: {result['name']}")
        context().traffic_light_controller.request_state(TrafficLightState.GREEN)
        context().navigation_controller.get_frame(UserWelcome).display_name(result["name"], welcome_message)
