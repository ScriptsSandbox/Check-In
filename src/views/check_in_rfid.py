from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout
import qtawesome as qta

from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, NAV_BTN_SIZE, NAV_ICON_SIZE, INNER_MARGIN, OUTER_MARGIN
from .components.label import styled_label
from .qr_codes import QRCodes

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class CheckInRFID(Screen):
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
        top_row.setContentsMargins(0, 0, 0, 0)

        qr_btn = StyledButton(ghost=True)
        qr_btn.setIcon(qta.icon('mdi.qrcode-scan', color='#F5F0E6'))
        qr_btn.setIconSize(NAV_ICON_SIZE)
        qr_btn.setFixedSize(NAV_BTN_SIZE, NAV_BTN_SIZE)
        qr_btn.clicked.connect(lambda: controller.show_frame(QRCodes))

        no_id_btn = StyledButton("No ID", font_size=20, ghost=True)
        no_id_btn.setFixedSize(NAV_BTN_SIZE, NAV_BTN_SIZE)
        no_id_btn.clicked.connect(lambda: controller.go_to_no_id())

        top_row.addWidget(qr_btn)
        top_row.addStretch()
        top_row.addWidget(no_id_btn)
        inner.addLayout(top_row)

        inner.addStretch(2)

        title = styled_label("UCSD Makerspace", size=80, bold=True)
        inner.addWidget(title)

        subtitle = styled_label("Welcome Desk", size=55)
        inner.addWidget(subtitle)

        inner.addStretch(3)

        instruction = styled_label("Please tap ID on the blue box to start", size=24)
        inner.addWidget(instruction)
