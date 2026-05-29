from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QWidget

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class Screen(QWidget):
    def __init__(self, controller: NavigationController) -> None:
        super().__init__()
        self.controller = controller
        self._build(controller)

    def _build(self, controller: NavigationController) -> None:
        """Subclasses build their UI here instead of in __init__."""
        pass

    def on_show(self) -> None:
        """Called by NavigationController when this screen becomes visible."""
        pass

    def on_hide(self) -> None:
        """Called by NavigationController just before this screen is hidden."""
        pass
