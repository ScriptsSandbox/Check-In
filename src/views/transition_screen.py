from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QLabel
from PyQt6.QtCore import Qt

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.theme import INNER_MARGIN, OUTER_MARGIN

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class TransitionScreen(Screen):
    def _build(self, controller: NavigationController) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN)
        outer.setSpacing(0)

        outline = OutlineFrame()
        outer.addWidget(outline)

        inner = QVBoxLayout(outline)
        inner.setContentsMargins(INNER_MARGIN, INNER_MARGIN, INNER_MARGIN, INNER_MARGIN)

        inner.addStretch()

        self._msg_label = QLabel("")
        self._msg_label.setStyleSheet(
            "color: #F5F0E6; font: 48pt Montserrat;"
            "background: transparent; border: none;"
        )
        self._msg_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        self._msg_label.setWordWrap(True)
        inner.addWidget(self._msg_label)

        inner.addStretch()

    def display(self, message: str) -> None:
        self._msg_label.setText(message)
        self.controller.show_frame(TransitionScreen)
