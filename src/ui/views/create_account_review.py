from __future__ import annotations

from threading import Thread
from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout, QVBoxLayout, QWidget

from misc.global_context import context
from ui.base import Screen
from ui.components.styled_button import StyledButton
from ui.components.styled_entry import field_row

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountReview(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.add_home_row()

        self.content.addSpacing(8)

        self.first_name_entry = field_row(self.content, "First Name")
        self.last_name_entry = field_row(self.content, "Last Name")
        self.email_entry = field_row(self.content, "Email")

        self.pid_container = QWidget()
        pid_layout = QVBoxLayout(self.pid_container)
        pid_layout.setContentsMargins(0, 0, 0, 0)
        pid_layout.setSpacing(0)
        self.pid_entry = field_row(pid_layout, "PID")
        self.content.addWidget(self.pid_container)

        for entry in (self.first_name_entry, self.last_name_entry,
                      self.email_entry, self.pid_entry):
            entry.returnPressed.connect(self._submit)
            entry.textChanged.connect(self._update_btn_state)

        self.content.addStretch(1)

        btn_row = QHBoxLayout()
        self.register_btn = StyledButton("Register")
        self.register_btn.setFixedWidth(349)
        self.register_btn.setEnabled(False)
        self.register_btn.clicked.connect(self._submit)
        btn_row.addStretch()
        btn_row.addWidget(self.register_btn)
        btn_row.addStretch()
        self.content.addLayout(btn_row)

    def _update_btn_state(self) -> None:
        entries = [self.first_name_entry, self.last_name_entry, self.email_entry]
        if self.pid_container.isVisible():
            entries.append(self.pid_entry)
        self.register_btn.setEnabled(all(e.text().strip() for e in entries))

    def on_show(self) -> None:
        session = context().session
        self.first_name_entry.setText(session.first_name)
        self.last_name_entry.setText(session.last_name)
        self.email_entry.setText(session.email)
        has_pid = bool(session.pid)
        self.pid_container.setVisible(has_pid)
        if has_pid:
            self.pid_entry.setText(session.pid.upper())
            self.pid_entry.set_readonly(True)
        self._update_btn_state()
        self.first_name_entry.setFocus()

    def on_hide(self) -> None:
        for entry in (self.first_name_entry, self.last_name_entry,
                      self.email_entry, self.pid_entry):
            entry.clearFocus()
        self.clear_entries()

    def clear_entries(self) -> None:
        for entry in (self.first_name_entry, self.last_name_entry,
                      self.email_entry, self.pid_entry):
            entry.clear()
        self.pid_entry.set_readonly(False)

    def _submit(self) -> None:
        first = self.first_name_entry.text().strip()
        last = self.last_name_entry.text().strip()
        email = self.email_entry.text().strip()
        has_pid = self.pid_container.isVisible()
        pid = self.pid_entry.text().strip().upper() if has_pid else None
        if not all([first, last, email] + ([pid] if has_pid else [])):
            return
        self.clear_entries()

        def worker() -> None:
            if has_pid:
                success = context().account_controller.create_account(pid=pid)
            else:
                success = context().account_controller.create_account(first_name=first, last_name=last, email=email)
            if success:
                context().check_in_controller.check_in(
                    "rfid",
                    context().session.rfid,
                    welcome_message="Thank you for registering",
                )
            else:
                context().main_window.main_thread_dispatcher.emit(
                    context().navigation_controller.reset_check_in_session
                )

        Thread(target=worker, daemon=True).start()
