from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtCore import Qt

from .base import Screen
from .components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class TransitionScreen(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.content.addStretch()

        self._msg_label = styled_label("", font_size=48)
        self.content.addWidget(self._msg_label, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch()

    def setup(self, message: str) -> None:
        self._msg_label.setText(message)
