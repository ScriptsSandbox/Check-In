from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout, QLabel
from PyQt6.QtCore import Qt

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, home_button, INNER_MARGIN, OUTER_MARGIN
from .components.styled_entry import StyledEntry

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountManual(Screen):
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

        inner.addStretch(3)

        pid_label = QLabel("PID")
        pid_label.setStyleSheet(
            "color: #F5F0E6; font: 18pt Montserrat;"
            "background: transparent; border: none;"
        )
        pid_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        inner.addWidget(pid_label)

        entry_row = QHBoxLayout()
        self.pid_entry = StyledEntry()
        self.pid_entry.setMaximumWidth(800)
        self.pid_entry.returnPressed.connect(self._go_to_review)
        entry_row.addStretch()
        entry_row.addWidget(self.pid_entry)
        entry_row.addStretch()
        inner.addLayout(entry_row)

        inner.addStretch(2)

        btn_row = QHBoxLayout()
        self.register_btn = StyledButton("Register")
        self.register_btn.setFixedWidth(349)
        self.register_btn.setEnabled(False)
        self.register_btn.clicked.connect(self._go_to_review)
        self.pid_entry.textChanged.connect(self._update_btn_state)
        btn_row.addStretch()
        btn_row.addWidget(self.register_btn)
        btn_row.addStretch()
        inner.addLayout(btn_row)

        inner.addSpacing(12)

        no_pid_row = QHBoxLayout()
        no_pid_btn = StyledButton("No PID →")
        no_pid_btn.setFixedWidth(349)
        no_pid_btn.setMinimumHeight(80)
        no_pid_btn.clicked.connect(lambda: controller.go_to_create_account_no_pid())
        no_pid_row.addStretch()
        no_pid_row.addWidget(no_pid_btn)
        no_pid_row.addStretch()
        inner.addLayout(no_pid_row)

    def _update_btn_state(self) -> None:
        self.register_btn.setEnabled(bool(self.pid_entry.text().strip()))

    def on_show(self) -> None:
        self.pid_entry.setFocus()

    def on_hide(self) -> None:
        self.pid_entry.clearFocus()

    def clear_entries(self) -> None:
        self.pid_entry.clear()

    def _go_to_review(self) -> None:
        pid = self.pid_entry.text().strip()
        self.clear_entries()
        self.controller.ctx.account.go_to_review_from_pid(pid)
