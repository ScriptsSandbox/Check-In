from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout
from PyQt6.QtCore import Qt

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, home_button, INNER_MARGIN, OUTER_MARGIN
from .components.theme import BODY_WRAP_WIDTH
from .components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountBarcode(Screen):
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

        title = styled_label("Welcome!", size=80, bold=True)
        inner.addWidget(title)

        instruction = styled_label(
            "It looks like you don't have an account yet! If you have a student ID, "
            "please scan your barcode now. If not, please press \"Fill Manually\"",
            size=36,
            wrap_width=BODY_WRAP_WIDTH,
        )
        inner.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)

        inner.addStretch(2)

        btn_row = QHBoxLayout()
        fill_btn = StyledButton("Fill Manually")
        fill_btn.setFixedWidth(349)
        fill_btn.clicked.connect(lambda: controller.go_to_create_account_manual())
        btn_row.addStretch()
        btn_row.addWidget(fill_btn)
        btn_row.addStretch()
        inner.addLayout(btn_row)

        inner.addStretch(2)
