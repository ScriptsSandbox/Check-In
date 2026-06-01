from __future__ import annotations

import logging
from threading import Thread
from typing import Any

from pyqttoast import ToastPreset

from controllers.api_controller import ApiController, ExternalApiError
from global_context import context


class AccountController:
    def __init__(self) -> None:
        pass

    def go_to_review_from_barcode(self, barcode: str) -> None:
        context().main_window.show_toast("Looking Up Student", "", ToastPreset.INFORMATION)
        logging.info(f"looking up student by barcode: {barcode}")
        Thread(target=self._lookup_barcode_worker, args=(barcode,), daemon=True).start()

    def _lookup_barcode_worker(self, barcode: str) -> None:
        try:
            student = ApiController.lookup_by_barcode(barcode)
        except ExternalApiError as e:
            context().dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        context().dispatcher.call.emit(lambda s=student: self._on_barcode_result(s))

    def _on_barcode_result(self, student: dict[str, Any] | None) -> None:
        if student is None:
            context().main_window.show_toast("Student not found", "Please enter your details manually", ToastPreset.ERROR)
            return
        context().navigation_controller.go_to_create_account_review(
            pid=student["pid"],
            first_name=student["first_name"],
            last_name=student["last_name"],
            email=student["email"],
        )

    def go_to_review_from_pid(self, pid: str) -> None:
        context().main_window.show_toast("Looking Up Student", "", ToastPreset.INFORMATION)
        logging.info(f"looking up student by PID: {pid}")
        Thread(target=self._lookup_pid_worker, args=(pid,), daemon=True).start()

    def _lookup_pid_worker(self, pid: str) -> None:
        try:
            student = ApiController.lookup_by_pid(pid)
        except ExternalApiError as e:
            context().dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        context().dispatcher.call.emit(lambda s=student: self._on_pid_result(s, pid))

    def _on_pid_result(self, student: dict[str, Any] | None, pid: str) -> None:
        if student is None:
            context().main_window.show_toast("Student Not Found", "Please check your PID", ToastPreset.ERROR)
            return
        context().navigation_controller.go_to_create_account_review(
            pid=pid,
            first_name=student["first_name"],
            last_name=student["last_name"],
            email=student["email"],
        )

    def create_account_from_review(self, *, first_name: str, last_name: str, email: str, pid: str) -> None:
        if pid:
            self._create(pid=pid)
        else:
            self._create(first_name=first_name, last_name=last_name, email=email)

    def _create(
        self,
        *,
        barcode: str | None = None,
        pid: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        email: str | None = None,
    ) -> None:
        context().main_window.show_toast("Account creation in progress!", "", ToastPreset.INFORMATION)
        logging.info(f"creating account: pid={pid} barcode={barcode}")
        Thread(
            target=self._create_worker,
            kwargs=dict(barcode=barcode, pid=pid, first_name=first_name, last_name=last_name, email=email),
            daemon=True,
        ).start()

    def _on_external_api_error(self, api: str) -> None:
        context().main_window.show_toast(f"System Error: {api}", "Please talk to a staff member", ToastPreset.ERROR)

    def _create_worker(
        self,
        *,
        barcode: str | None,
        pid: str | None,
        first_name: str | None,
        last_name: str | None,
        email: str | None,
    ) -> None:
        try:
            result = ApiController.create_account(
                context().rfid,
                barcode=barcode,
                pid=pid,
                first_name=first_name,
                last_name=last_name,
                email=email,
            )
        except ExternalApiError as e:
            context().dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        context().dispatcher.call.emit(lambda r=result: self._on_create_result(r))

    def _on_create_result(self, result: dict[str, Any] | None) -> None:
        if result is None:
            context().main_window.show_toast("Error", "Could not create account, please try manually", ToastPreset.ERROR)
            return
        logging.info("account creation succeeded")
        context().navigation_controller.pop()
