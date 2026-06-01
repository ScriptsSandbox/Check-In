from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout
from PyQt6.QtCore import Qt
import qtawesome as qta

from .base import Screen
from .components.styled_button import StyledButton, NAV_BTN_SIZE, NAV_ICON_SIZE
from .components.label import styled_label, title_label
from .qr_codes import QRCodes

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CheckInRFID(Screen):
    def _build(self, controller: NavigationController) -> None:
        top_row = QHBoxLayout()
        top_row.setContentsMargins(0, 0, 0, 0)

        qr_btn = StyledButton(ghost=True)
        qr_btn.setIcon(qta.icon('mdi.qrcode-scan', color='#F5F0E6'))
        qr_btn.setIconSize(NAV_ICON_SIZE)
        qr_btn.setFixedSize(NAV_BTN_SIZE, NAV_BTN_SIZE)
        qr_btn.clicked.connect(lambda: controller.navigate(QRCodes))

        no_id_btn = StyledButton("No ID", font_size=20, ghost=True)
        no_id_btn.setFixedSize(NAV_BTN_SIZE, NAV_BTN_SIZE)
        no_id_btn.clicked.connect(lambda: controller.go_to_no_id())

        top_row.addWidget(qr_btn)
        top_row.addStretch()
        top_row.addWidget(no_id_btn)
        self.content.addLayout(top_row)

        self.content.addStretch(2)

        title = title_label("UCSD Makerspace")
        self.content.addWidget(title, alignment=Qt.AlignmentFlag.AlignHCenter)

        subtitle = styled_label("Welcome Desk", font_size=55)
        self.content.addWidget(subtitle, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.content.addStretch(3)

        instruction = styled_label("Please tap ID on the blue box to start", font_size=24)
        self.content.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)
