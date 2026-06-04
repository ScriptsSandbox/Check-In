from __future__ import annotations

import logging
from threading import Thread
from typing import Literal

from pyqttoast import ToastPreset

from misc.api_models import CheckInNoAccount, CheckInNoWaiver, CheckInOk, CheckInResponse, StudentResponse, check_in_response_validator
from misc.global_config import config
from misc.global_context import context
from hardware.traffic_light import TrafficLightState
from ui.views.create_account_barcode import CreateAccountBarcode
from ui.views.sign_waiver import SignWaiver
from ui.views.user_welcome import UserWelcome


class CheckInController:
    def __init__(self) -> None:
        logging.info("check-in controller initialized")

    def check_in(
            self,
            method: Literal["rfid", "pid"],
            identifier: str,
            *,
            welcome_message: str = "Welcome back"
    ) -> None:
        accounts_path = f"/accounts/{method}/{identifier}"

        def worker() -> None:
            try:
                get_account_response = context().api_controller.request("GET", accounts_path)
                if get_account_response.status_code == 404:
                    result: CheckInResponse = CheckInNoAccount()
                else:
                    get_account_response.raise_for_status()
                    email = StudentResponse.model_validate(get_account_response.json()).student.email
                    check_in_response = context().api_controller.request("POST", "/check-in", json={"email": email})
                    check_in_response.raise_for_status()
                    result = check_in_response_validator.validate_python(check_in_response.json())
            except Exception as e:
                logging.error(f"error during check-in for {identifier}: {e}")
                context().traffic_light_controller.request_state_async(TrafficLightState.RED)
                context().main_window.show_toast_async("System Error", "Please let staff know", ToastPreset.ERROR)
                return

            context().main_window.main_thread_dispatcher.emit(lambda r=result: handle(r))

        def handle(result: CheckInResponse) -> None:
            if isinstance(result, CheckInNoAccount):
                logging.info(f"no account found for {identifier}")
                context().traffic_light_controller.request_state_async(TrafficLightState.YELLOW)

                if not config().HAS_BARCODE_SCANNER:
                    context().navigation_controller.navigate_via_transition(
                        "Looks like you don't have an account. Use the other kiosk to set one up!",
                        delay_ms=5000,
                        next_action=context().navigation_controller.reset_check_in_session,
                    )
                    return

                if not context().session.rfid:
                    context().navigation_controller.navigate_via_transition(
                        "Looks like you don't have an account. Please tap an RFID card to create one!",
                        delay_ms=5000,
                        next_action=context().navigation_controller.reset_check_in_session,
                    )
                    return

                context().session.check_in_method = method
                context().session.check_in_identifier = identifier
                context().navigation_controller.navigate(CreateAccountBarcode)
                return

            if isinstance(result, CheckInNoWaiver):
                logging.info(f"no waiver for {identifier}")
                context().traffic_light_controller.request_state_async(TrafficLightState.YELLOW)
                context().navigation_controller.navigate_via_transition(
                    "Looks like you haven't signed the waiver yet, let's fix that!",
                    delay_ms=3000,
                    next_action=lambda: context().navigation_controller.navigate(SignWaiver),
                )
                return

            assert isinstance(result, CheckInOk)
            logging.info(f"check-in successful: {result.name}")
            context().traffic_light_controller.request_state_async(TrafficLightState.GREEN)
            context().navigation_controller.get_screen(UserWelcome).display_name(result.name, welcome_message)

        Thread(target=worker, daemon=True).start()
