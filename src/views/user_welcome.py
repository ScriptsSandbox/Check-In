from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QLabel
from PyQt6.QtCore import QTimer

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.theme import INNER_MARGIN, OUTER_MARGIN
from .components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class UserWelcome(Screen):
    def _build(self, controller: NavigationController) -> None:
        self._last_name: str | None = None
        self._active_labels: set[QLabel] = set()

        outer = QVBoxLayout(self)
        outer.setContentsMargins(OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN)
        outer.setSpacing(0)

        outline = OutlineFrame()
        outer.addWidget(outline)

        inner = QVBoxLayout(outline)
        inner.setContentsMargins(INNER_MARGIN, INNER_MARGIN, INNER_MARGIN, INNER_MARGIN)
        inner.setSpacing(0)

        inner.addStretch()

        self._msg_label = styled_label("Welcome back", size=38)
        inner.addWidget(self._msg_label)

        inner.addSpacing(8)

        self._names_layout = QVBoxLayout()
        self._names_layout.setContentsMargins(0, 0, 0, 0)
        self._names_layout.setSpacing(0)
        inner.addLayout(self._names_layout)

        inner.addStretch()

    def on_hide(self) -> None:
        self._active_labels.clear()
        while self._names_layout.count():
            item = self._names_layout.takeAt(0)
            if item.widget():  # type: ignore[union-attr]
                item.widget().deleteLater()  # type: ignore[union-attr]
        self._msg_label.setText("Welcome back")
        self._last_name = None

    def display_name(self, name: str, message: str = "Welcome back") -> None:
        if name == self._last_name:
            return

        self._last_name = name
        self._msg_label.setText(message)
        self.controller.show_frame(UserWelcome)

        label = styled_label(name, size=70, bold=True)
        self._names_layout.addWidget(label)
        self._active_labels.add(label)

        QTimer.singleShot(3000, lambda: self._remove_name(label))

    def _remove_name(self, label: QLabel) -> None:
        if label not in self._active_labels:
            return
        self._active_labels.discard(label)
        self._names_layout.removeWidget(label)
        label.deleteLater()

        if not self._active_labels:
            self._last_name = None
            self.controller.back_to_main()
