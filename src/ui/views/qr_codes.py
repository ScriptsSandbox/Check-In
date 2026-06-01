from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout, QLabel

from misc.asset import Asset
from ui.base import Screen
from ui.components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class QRCodes(Screen):
    def _build(self, controller: NavigationController) -> None:
        self.add_home_row()

        self.content.addStretch(1)

        qr_row = QHBoxLayout()
        qr_row.setSpacing(80)

        def _qr_col(image_path: str, caption: str) -> QVBoxLayout:
            col = QVBoxLayout()
            col.setSpacing(12)
            img = QLabel()
            px = QPixmap(str(image_path))
            img.setPixmap(px)
            img.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            img.setStyleSheet("background: transparent; border: none;")
            lbl = styled_label(caption, font_size=30, width=px.width())
            col.addWidget(img)
            col.addWidget(lbl, alignment=Qt.AlignmentFlag.AlignHCenter)
            return col

        qr_row.addStretch()
        qr_row.addLayout(_qr_col(Asset.QR_WEBSITE.get_path(), "Website"))
        qr_row.addLayout(_qr_col(Asset.QR_WAIVER.get_path(), "Waiver"))
        qr_row.addStretch()
        self.content.addLayout(qr_row)

        self.content.addStretch(1)
