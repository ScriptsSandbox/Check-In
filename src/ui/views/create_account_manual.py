from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout

from misc.global_context import context
from ui.base import Screen
from ui.components.styled_button import StyledButton
from ui.components.styled_entry import field_row

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountManual(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.add_home_row()

        self.content.addStretch(3)

        self.pid_entry = field_row(self.content, "PID", spacing=0)
        self.pid_entry.returnPressed.connect(self._go_to_review)

        self.content.addStretch(2)

        btn_row = QHBoxLayout()
        self.register_btn = StyledButton("Register")
        self.register_btn.setFixedWidth(349)
        self.register_btn.setEnabled(False)
        self.register_btn.clicked.connect(self._go_to_review)
        self.pid_entry.textChanged.connect(self._update_btn_state)
        btn_row.addStretch()
        btn_row.addWidget(self.register_btn)
        btn_row.addStretch()
        self.content.addLayout(btn_row)

        self.content.addSpacing(12)

        no_pid_row = QHBoxLayout()
        no_pid_btn = StyledButton("No PID →")
        no_pid_btn.setFixedWidth(349)
        no_pid_btn.setMinimumHeight(80)
        no_pid_btn.clicked.connect(lambda: controller.go_to_create_account_no_pid())
        no_pid_row.addStretch()
        no_pid_row.addWidget(no_pid_btn)
        no_pid_row.addStretch()
        self.content.addLayout(no_pid_row)

    def _update_btn_state(self) -> None:
        self.register_btn.setEnabled(bool(self.pid_entry.text().strip()))

    def on_show(self) -> None:
        self.pid_entry.setFocus()

    def on_hide(self) -> None:
        self.pid_entry.clearFocus()
        self.clear_entries()

    def clear_entries(self) -> None:
        self.pid_entry.clear()

    def _go_to_review(self) -> None:
        pid = self.pid_entry.text().strip()
        self.clear_entries()
        context().account_controller.lookup_by_pid(pid)
