from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout, QLabel
from PyQt6.QtCore import Qt

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, home_button, INNER_MARGIN, OUTER_MARGIN
from .components.styled_entry import StyledEntry

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountNoPid(Screen):
    def _build(self, controller: NavigationController) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN)
        outer.setSpacing(0)

        outline = OutlineFrame()
        outer.addWidget(outline)

        inner = QVBoxLayout(outline)
        inner.setContentsMargins(INNER_MARGIN, INNER_MARGIN, INNER_MARGIN, INNER_MARGIN)
        inner.setSpacing(0)

        top_row = QHBoxLayout()
        top_row.addWidget(home_button(lambda: controller.back_to_main()))
        top_row.addStretch()
        inner.addLayout(top_row)

        inner.addStretch(1)

        def _field_row(label_text: str) -> StyledEntry:
            lbl = QLabel(label_text)
            lbl.setStyleSheet(
                "color: #F5F0E6; font: 18pt Montserrat;"
                "background: transparent; border: none;"
            )
            lbl.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            inner.addWidget(lbl)

            row = QHBoxLayout()
            entry = StyledEntry()
            entry.setMaximumWidth(800)
            row.addStretch()
            row.addWidget(entry)
            row.addStretch()
            inner.addLayout(row)
            inner.addSpacing(10)
            return entry

        self.first_name_entry = _field_row("First Name")
        self.last_name_entry = _field_row("Last Name")
        self.email_entry = _field_row("Email")

        for entry in (self.first_name_entry, self.last_name_entry, self.email_entry):
            entry.returnPressed.connect(self._submit)
            entry.textChanged.connect(self._update_btn_state)

        inner.addStretch(1)

        btn_row = QHBoxLayout()
        self.register_btn = StyledButton("Register")
        self.register_btn.setFixedWidth(349)
        self.register_btn.setEnabled(False)
        self.register_btn.clicked.connect(self._submit)
        btn_row.addStretch()
        btn_row.addWidget(self.register_btn)
        btn_row.addStretch()
        inner.addLayout(btn_row)

    def _update_btn_state(self) -> None:
        self.register_btn.setEnabled(all(
            e.text().strip() for e in (self.first_name_entry, self.last_name_entry, self.email_entry)
        ))

    def on_show(self) -> None:
        self.first_name_entry.setFocus()

    def on_hide(self) -> None:
        for entry in (self.first_name_entry, self.last_name_entry, self.email_entry):
            entry.clearFocus()

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
            self.controller.ctx.account.create_account_from_review(
                first_name=first, last_name=last, email=email, pid=""
            )
        except Exception:
            logging.warning("error occurred trying to create a user account", exc_info=True)
