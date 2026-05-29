from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QVBoxLayout, QHBoxLayout, QLabel
from PyQt6.QtGui import QPixmap
from PyQt6.QtCore import Qt

from controllers.asset_controller import AssetController
from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import home_button, INNER_MARGIN, OUTER_MARGIN

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class QRCodes(Screen):
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

        inner.addStretch(1)

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
            lbl = QLabel(caption)
            lbl.setStyleSheet(
                "color: #F5F0E6; font: 30pt Montserrat;"
                "background: transparent; border: none;"
            )
            lbl.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            col.addWidget(img)
            col.addWidget(lbl)
            return col

        qr_row.addStretch()
        qr_row.addLayout(_qr_col(AssetController.QR_WEBSITE.get_path(), "Website"))
        qr_row.addLayout(_qr_col(AssetController.QR_WAIVER.get_path(), "Waiver"))
        qr_row.addStretch()
        inner.addLayout(qr_row)

        inner.addStretch(1)
