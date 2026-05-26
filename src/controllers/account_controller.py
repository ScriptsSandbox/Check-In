import logging
from threading import Thread

from PyQt6.QtCore import QTimer

from controllers.api_controller import ApiController, ExternalApiError


class AccountController:
    def __init__(self, ctx):
        self.ctx = ctx

    def go_to_review_from_barcode(self, barcode):
        self.ctx.nav.show_status("Looking up student...")
        logging.info(f"looking up student by barcode: {barcode}")
        Thread(target=self._lookup_barcode_worker, args=(barcode,), daemon=True).start()

    def _lookup_barcode_worker(self, barcode):
        try:
            student = ApiController.lookup_by_barcode(barcode)
        except ExternalApiError as e:
            self.ctx.dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        self.ctx.dispatcher.call.emit(lambda s=student: self._on_barcode_result(s))

    def _on_barcode_result(self, student):
        self.ctx.nav.hide_status()
        if student is None:
            self.ctx.nav.show_status("Student not found. Please enter your details manually.")
            QTimer.singleShot(3000, self.ctx.nav.hide_status)
            return
        self.ctx.nav.go_to_create_account_review(
            pid=student["pid"],
            first_name=student["first_name"],
            last_name=student["last_name"],
            email=student["email"],
        )

    def go_to_review_from_pid(self, pid):
        self.ctx.nav.show_status("Looking up student...")
        logging.info(f"looking up student by PID: {pid}")
        Thread(target=self._lookup_pid_worker, args=(pid,), daemon=True).start()

    def _lookup_pid_worker(self, pid):
        try:
            student = ApiController.lookup_by_pid(pid)
        except ExternalApiError as e:
            self.ctx.dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        self.ctx.dispatcher.call.emit(lambda s=student: self._on_pid_result(s, pid))

    def _on_pid_result(self, student, pid):
        self.ctx.nav.hide_status()
        if student is None:
            self.ctx.nav.show_status("Student not found. Please check your PID.")
            QTimer.singleShot(3000, self.ctx.nav.hide_status)
            return
        self.ctx.nav.go_to_create_account_review(
            pid=pid,
            first_name=student["first_name"],
            last_name=student["last_name"],
            email=student["email"],
        )

    def create_account_from_review(self, *, first_name, last_name, email, pid):
        if pid:
            self._create(pid=pid)
        else:
            self._create(first_name=first_name, last_name=last_name, email=email)

    def _create(self, *, barcode=None, pid=None, first_name=None, last_name=None, email=None):
        self.ctx.nav.show_status("Account creation in progress!")
        logging.info(f"creating account: pid={pid} barcode={barcode}")
        Thread(
            target=self._create_worker,
            kwargs=dict(barcode=barcode, pid=pid, first_name=first_name, last_name=last_name, email=email),
            daemon=True,
        ).start()

    def _on_external_api_error(self, api: str):
        self.ctx.nav.hide_status()
        self.ctx.nav.show_status(f"system error ({api.upper()} api). please talk to a staff member.")
        QTimer.singleShot(4000, self.ctx.nav.hide_status)

    def _create_worker(self, *, barcode, pid, first_name, last_name, email):
        try:
            result = ApiController.create_account(
                self.ctx.rfid,
                barcode=barcode,
                pid=pid,
                first_name=first_name,
                last_name=last_name,
                email=email,
            )
        except ExternalApiError as e:
            self.ctx.dispatcher.call.emit(lambda: self._on_external_api_error(e.api))
            return
        self.ctx.dispatcher.call.emit(lambda r=result: self._on_create_result(r))

    def _on_create_result(self, result):
        self.ctx.nav.hide_status()
        if result is None:
            self.ctx.nav.show_status("ERROR! Could not create account, please try manually.")
            QTimer.singleShot(3000, self.ctx.nav.hide_status)
            return
        logging.info("account creation succeeded")
        self.ctx.nav.pop()
