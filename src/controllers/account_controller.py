from __future__ import annotations

import logging
from typing import Literal

from pyqttoast import ToastPreset

from controllers.api_controller import ExternalApiError
from misc.api_models import CreateAccountResponse, Student, StudentResponse
from misc.global_context import context


class AccountController:
    def __init__(self) -> None:
        logging.info("account controller initialized")

    def lookup(self, by: Literal["pid", "barcode"], value: str) -> Student | None:
        context().main_window.show_toast_async("Looking Up Student", "", ToastPreset.INFORMATION)
        logging.info(f"looking up student by {by}: {value}")
        try:
            response = context().api_controller.request("GET", f"/accounts/{by}/{value}")
            if response.status_code == 404:
                context().main_window.show_toast_async("Student Not Found", "Please enter your details manually", ToastPreset.ERROR)
                return None
            response.raise_for_status()
            return StudentResponse.model_validate(response.json()).student
        except ExternalApiError as e:
            context().main_window.show_toast_async(f"System Error: {e.api}", "Please talk to a staff member", ToastPreset.ERROR)
            return None
        except Exception as e:
            logging.error(f"error looking up student by {by}: {e}")
            context().main_window.show_toast_async("Student Not Found", "Please enter your details manually", ToastPreset.ERROR)
            return None

    def create_account(
        self,
        *,
        barcode: str | None = None,
        pid: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        email: str | None = None,
    ) -> bool:
        context().main_window.show_toast_async("Account creation in progress!", "", ToastPreset.INFORMATION)
        logging.info(f"creating account: pid={pid} barcode={barcode}")
        payload = {k: v for k, v in {
            "rfid": context().session.rfid,
            "barcode": barcode,
            "pid": pid,
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
        }.items() if v is not None}
        try:
            response = context().api_controller.request("POST", "/accounts", json=payload)
            response.raise_for_status()
            CreateAccountResponse.model_validate(response.json())
            logging.info("account creation succeeded")
            return True
        except ExternalApiError as e:
            context().main_window.show_toast_async(f"System Error: {e.api}", "Please talk to a staff member", ToastPreset.ERROR)
            return False
        except Exception as e:
            logging.error(f"error creating account: {e}")
            context().main_window.show_toast_async("Account Creation Failed", "Please try again or talk to a staff member", ToastPreset.ERROR)
            return False
