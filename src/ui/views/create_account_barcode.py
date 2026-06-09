from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout
from PyQt6.QtCore import Qt

from ui.base import Screen
from ui.components.styled_button import StyledButton
from ui.components.label import styled_label
from ui.views.create_account_manual import CreateAccountManual

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CreateAccountBarcode(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.add_home_row()

        self.content.addStretch(3)

        title = styled_label("Welcome!", font_size=80, bold=True)
        self.content.addWidget(title, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch(2)

        instruction = styled_label(
            "To create an account, please place your ID on the barcode scanner or press the button below",
            font_size=36,
        )
        self.content.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch(8)

        btn_row = QHBoxLayout()
        fill_btn = StyledButton("Fill Manually")
        fill_btn.setFixedWidth(349)
        fill_btn.clicked.connect(lambda: controller.navigate(CreateAccountManual))
        btn_row.addStretch()
        btn_row.addWidget(fill_btn)
        btn_row.addStretch()
        self.content.addLayout(btn_row)

        self.content.addStretch(3)
