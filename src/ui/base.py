from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QWidget, QVBoxLayout

from .components.outline_frame import OutlineFrame
from .components.theme import OUTER_MARGIN, INNER_MARGIN

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class Screen(QWidget):
    def __init__(self, controller: NavigationController) -> None:
        super().__init__()
        self.controller = controller

        outer = QVBoxLayout(self)
        outer.setContentsMargins(OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN)
        outer.setSpacing(0)

        outline = OutlineFrame()
        outer.addWidget(outline)

        self.content = QVBoxLayout(outline)
        self.content.setContentsMargins(INNER_MARGIN, INNER_MARGIN, INNER_MARGIN, INNER_MARGIN)
        self.content.setSpacing(0)

        self._build(controller)

    def _build(self, controller: NavigationController) -> None:
        pass

    def on_show(self) -> None:
        pass

    def on_hide(self) -> None:
        pass
