from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout
from PyQt6.QtCore import Qt

from global_context import context
from .base import Screen
from .components.styled_button import StyledButton, home_button
from .components.styled_entry import StyledEntry
from .components.label import field_label, styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CheckInManual(Screen):
    def _build(self, controller: NavigationController) -> None:
        top_row = QHBoxLayout()
        top_row.addWidget(home_button(lambda: controller.back_to_main()))
        top_row.addStretch()
        self.content.addLayout(top_row)

        self.content.addStretch(2)

        instruction = styled_label(
            "Enter your UCSD PID below\n"
            "to check in",
            font_size=36,
        )
        self.content.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch(1)

        pid_label = field_label("PID")
        self.content.addWidget(pid_label, alignment=Qt.AlignmentFlag.AlignHCenter)

        entry_row = QHBoxLayout()
        self.pid_entry = StyledEntry()
        self.pid_entry.setMaximumWidth(800)
        self.pid_entry.returnPressed.connect(lambda: self._call_check_in())
        entry_row.addStretch()
        entry_row.addWidget(self.pid_entry)
        entry_row.addStretch()
        self.content.addLayout(entry_row)

        self.content.addStretch(2)

        btn_row = QHBoxLayout()
        self.check_in_btn = StyledButton("Check In")
        self.check_in_btn.setFixedWidth(349)
        self.check_in_btn.setEnabled(False)
        self.check_in_btn.clicked.connect(lambda: self._call_check_in())
        self.pid_entry.textChanged.connect(self._update_btn_state)
        btn_row.addStretch()
        btn_row.addWidget(self.check_in_btn)
        btn_row.addStretch()
        self.content.addLayout(btn_row)

    def _update_btn_state(self) -> None:
        self.check_in_btn.setEnabled(bool(self.pid_entry.text().strip()))

    def on_show(self) -> None:
        self.pid_entry.setFocus()

    def on_hide(self) -> None:
        self.pid_entry.clearFocus()

    def clear_entries(self) -> None:
        self.pid_entry.clear()

    def update_entries(self, pid: str) -> None:
        self.pid_entry.setText(pid)

    def _call_check_in(self) -> None:
        pid = self.pid_entry.text().strip()
        if not pid:
            return
        self.clear_entries()
        context().check_in_controller.handle_by_pid(pid)
