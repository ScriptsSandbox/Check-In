from __future__ import annotations

import logging
from threading import Thread
from typing import Literal

from pyqttoast import ToastPreset

from controllers.api_controller import ExternalApiError
from misc.api_models import CreateAccountResponse, StudentResponse
from misc.global_context import context


class AccountController:
    def __init__(self) -> None:
        logging.info("account controller initialized")

    def lookup(self, by: Literal["pid", "barcode"], value: str) -> None:
        context().main_window.show_toast_async("Looking Up Student", "", ToastPreset.INFORMATION)
        logging.info(f"looking up student by {by}: {value}")

        def worker() -> None:
            try:
                resp = context().api_controller.request("GET", f"/accounts/{by}/{value}")
                if resp.status_code == 404:
                    student: StudentResponse | None = None
                else:
                    resp.raise_for_status()
                    student = StudentResponse.model_validate(resp.json())
            except ExternalApiError as e:
                context().main_window.show_toast_async(f"System Error: {e.api}", "Please talk to a staff member", ToastPreset.ERROR)
                return
            except Exception as e:
                logging.error(f"error looking up student by {by}: {e}")
                student = None

            if student is None:
                context().main_window.show_toast_async("Student Not Found", "Please enter your details manually", ToastPreset.ERROR)
                return
            context().dispatcher.call.emit(
                lambda s=student: context().navigation_controller.go_to_create_account_review(
                    pid=s.student.pid,
                    first_name=s.student.first_name,
                    last_name=s.student.last_name,
                    email=s.student.email,
                )
            )

        Thread(target=worker, daemon=True).start()

    def create_account(
        self,
        *,
        barcode: str | None = None,
        pid: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        email: str | None = None,
    ) -> None:
        context().main_window.show_toast_async("Account creation in progress!", "", ToastPreset.INFORMATION)
        logging.info(f"creating account: pid={pid} barcode={barcode}")

        def worker() -> None:
            payload = {k: v for k, v in {
                "rfid": context().session.rfid,
                "barcode": barcode,
                "pid": pid,
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
            }.items() if v is not None}
            try:
                resp = context().api_controller.request("POST", "/accounts", json=payload)
                resp.raise_for_status()
                result: CreateAccountResponse | None = CreateAccountResponse.model_validate(resp.json())
            except ExternalApiError as e:
                context().main_window.show_toast_async(f"System Error: {e.api}", "Please talk to a staff member", ToastPreset.ERROR)
                return
            except Exception as e:
                logging.error(f"error creating account: {e}")
                result = None

            if result is None:
                context().main_window.show_toast_async("Error", "Could not create account, please try manually", ToastPreset.ERROR)
                return
            logging.info("account creation succeeded")
            context().dispatcher.call.emit(context().navigation_controller.pop)

        Thread(target=worker, daemon=True).start()
