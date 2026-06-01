from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout
from PyQt6.QtCore import Qt

from ui.base import Screen
from ui.components.styled_button import StyledButton, home_button
from ui.components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountBarcode(Screen):
    def _build(self, controller: NavigationController) -> None:
        top_row = QHBoxLayout()
        top_row.addWidget(home_button(lambda: controller.back_to_main()))
        top_row.addStretch()
        self.content.addLayout(top_row)

        self.content.addStretch(2)

        title = styled_label("Welcome!", font_size=80, bold=True)
        self.content.addWidget(title, alignment=Qt.AlignmentFlag.AlignHCenter)

        instruction = styled_label(
            "It looks like you don't have an account yet! If you have a student ID, "
            "please scan your barcode now. If not, please press \"Fill Manually\"",
            font_size=36,
        )
        self.content.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch(2)

        btn_row = QHBoxLayout()
        fill_btn = StyledButton("Fill Manually")
        fill_btn.setFixedWidth(349)
        fill_btn.clicked.connect(lambda: controller.go_to_create_account_manual())
        btn_row.addStretch()
        btn_row.addWidget(fill_btn)
        btn_row.addStretch()
        self.content.addLayout(btn_row)

        self.content.addStretch(2)
