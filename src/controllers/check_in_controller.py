from __future__ import annotations

import logging
from threading import Thread
from typing import Literal

from pydantic import TypeAdapter
from PyQt6.QtCore import QTimer
from pyqttoast import ToastPreset

from misc.api_models import CheckInNoAccount, CheckInNoWaiver, CheckInOk, CheckInResponse, StudentResponse
from misc.global_config import config
from misc.global_context import context
from hardware.traffic_light import TrafficLightState
from ui.views.user_welcome import UserWelcome
from ui.views.transition_screen import TransitionScreen

_check_in_adapter = TypeAdapter(CheckInResponse)


class CheckInController:
    def __init__(self) -> None:
        pass

    def check_in(self, by: Literal["rfid", "pid"], value: str, welcome_message: str = "Welcome back") -> None:
        accounts_path = f"/accounts/{by}/{value}"

        def worker() -> None:
            try:
                resp = context().api_controller.request("GET", accounts_path)
                if resp.status_code == 404:
                    result: CheckInResponse = CheckInNoAccount()
                else:
                    resp.raise_for_status()
                    email = StudentResponse.model_validate(resp.json()).student.email
                    ci_resp = context().api_controller.request("POST", "/check-in", json={"email": email})
                    ci_resp.raise_for_status()
                    result = _check_in_adapter.validate_python(ci_resp.json())
            except Exception as e:
                logging.error(f"error during check-in for {value}: {e}")
                context().traffic_light_controller.request_state_async(TrafficLightState.RED)
                context().main_window.show_toast_async("System Error", "Please let staff know", ToastPreset.ERROR)
                return
            context().dispatcher.call.emit(lambda r=result: handle(r))

        def handle(result: CheckInResponse) -> None:
            if isinstance(result, CheckInNoAccount):
                logging.info(f"no account found for {value}")
                context().traffic_light_controller.request_state_async(TrafficLightState.RED)
                if not config().HAS_BARCODE_SCANNER:
                    context().navigation_controller.navigate(
                        TransitionScreen,
                        lambda s: s.setup("Looks like you don't have an account.\nUse the other kiosk to set one up!"),
                    )
                    QTimer.singleShot(6000, context().navigation_controller.back_to_main)
                    return
                context().navigation_controller.go_to_create_account(
                    on_done=lambda: self.check_in(by, value, welcome_message="Thank you for registering")
                )
                return

            if isinstance(result, CheckInNoWaiver):
                logging.info(f"no waiver for {value}")
                context().traffic_light_controller.request_state_async(TrafficLightState.YELLOW)
                context().navigation_controller.go_to_sign_waiver()
                return

            assert isinstance(result, CheckInOk)
            logging.info(f"check-in successful: {result.name}")
            context().traffic_light_controller.request_state_async(TrafficLightState.GREEN)
            context().navigation_controller.get_frame(UserWelcome).display_name(result.name, welcome_message)

        Thread(target=worker, daemon=True).start()
