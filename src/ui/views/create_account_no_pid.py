from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout

from misc.global_context import context
from ui.base import Screen
from ui.components.styled_button import StyledButton
from ui.components.styled_entry import field_row

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountNoPid(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.add_home_row()

        self.content.addStretch(1)

        self.first_name_entry = field_row(self.content, "First Name", spacing=10)
        self.last_name_entry = field_row(self.content, "Last Name", spacing=10)
        self.email_entry = field_row(self.content, "Email", spacing=10)

        for entry in (self.first_name_entry, self.last_name_entry, self.email_entry):
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
        self.register_btn.setEnabled(all(
            e.text().strip() for e in (self.first_name_entry, self.last_name_entry, self.email_entry)
        ))

    def on_show(self) -> None:
        self.first_name_entry.setFocus()

    def on_hide(self) -> None:
        for entry in (self.first_name_entry, self.last_name_entry, self.email_entry):
            entry.clearFocus()
        self.clear_entries()

    def clear_entries(self) -> None:
        for entry in (self.first_name_entry, self.last_name_entry, self.email_entry):
            entry.clear()

    def _submit(self) -> None:
        first = self.first_name_entry.text().strip()
        last = self.last_name_entry.text().strip()
        email = self.email_entry.text().strip()
        if not all([first, last, email]):
            return
        self.clear_entries()
        try:
            context().account_controller.submit_account(
                first_name=first, last_name=last, email=email, pid=""
            )
        except Exception:
            logging.warning("error occurred trying to create a user account", exc_info=True)
