from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout, QLabel
from PyQt6.QtCore import Qt

from main import context
from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, home_button, INNER_MARGIN, OUTER_MARGIN
from .components.styled_entry import StyledEntry

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CheckInManual(Screen):
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

        inner.addStretch(2)

        instruction = QLabel(
            "Enter your UCSD PID below\n"
            "to check in"
        )
        instruction.setStyleSheet(
            "color: #F5F0E6; font: 36pt Montserrat;"
            "background: transparent; border: none;"
        )
        instruction.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        instruction.setWordWrap(True)
        inner.addWidget(instruction)

        inner.addStretch(1)

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
        self.pid_entry.returnPressed.connect(lambda: self._call_check_in(controller))
        entry_row.addStretch()
        entry_row.addWidget(self.pid_entry)
        entry_row.addStretch()
        inner.addLayout(entry_row)

        inner.addStretch(2)

        btn_row = QHBoxLayout()
        self.check_in_btn = StyledButton("Check In")
        self.check_in_btn.setFixedWidth(349)
        self.check_in_btn.setEnabled(False)
        self.check_in_btn.clicked.connect(lambda: self._call_check_in(controller))
        self.pid_entry.textChanged.connect(self._update_btn_state)
        btn_row.addStretch()
        btn_row.addWidget(self.check_in_btn)
        btn_row.addStretch()
        inner.addLayout(btn_row)

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

    def _call_check_in(self, controller: NavigationController) -> None:
        pid = self.pid_entry.text().strip()
        if not pid:
            return
        controller.show_status("PLEASE WAIT: LOADING...")
        self.clear_entries()
        context.check_in_controller.handle_by_pid(pid)
        controller.hide_status()
