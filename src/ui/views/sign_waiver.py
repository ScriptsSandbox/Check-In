from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt6.QtWidgets import QHBoxLayout, QVBoxLayout, QLabel
from PyQt6.QtGui import QPixmap
from PyQt6.QtCore import Qt

from misc.asset import Asset
from ui.base import Screen
from ui.components.styled_button import StyledButton
from ui.components.label import styled_label

if TYPE_CHECKING:
    from controllers.navigation_controller import NavigationController


class SignWaiver(Screen):
    def _build(self, controller: NavigationController) -> None:
        content = QHBoxLayout()
        content.setContentsMargins(50, 0, 50, 0)
        content.setSpacing(20)

        left = QVBoxLayout()
        left.setSpacing(0)

        left.addStretch(1)

        instruction = styled_label(
            "Please scan the QR code\non the right and sign the waiver",
            font_size=36,
        )
        left.addWidget(instruction, alignment=Qt.AlignmentFlag.AlignHCenter)

        left.addStretch(2)

        content.addLayout(left, stretch=1)

        right = QVBoxLayout()
        right.setSpacing(0)
        right.addStretch()

        qr_px = QPixmap(Asset.QR_WAIVER.get_path())
        qr_px = qr_px.scaled(320, 320, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        qr_label = QLabel()
        qr_label.setPixmap(qr_px)
        qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        qr_label.setStyleSheet("background: transparent; border: none;")
        right.addWidget(qr_label)

        right.addSpacing(24)

        done_btn = StyledButton("Done Scanning")
        done_btn.setFixedWidth(280)
        done_btn.clicked.connect(lambda: controller.back_to_main())
        right.addWidget(done_btn, alignment=Qt.AlignmentFlag.AlignHCenter)

        right.addStretch()

        content.addLayout(right, stretch=1)

        self.content.addLayout(content)
