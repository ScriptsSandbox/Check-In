from PyQt6.QtWidgets import QHBoxLayout, QVBoxLayout, QLabel
from PyQt6.QtGui import QPixmap
from PyQt6.QtCore import Qt
from controllers.assets_controller import AssetController
from .base import Screen
from .components.outline_frame import OutlineFrame
from .components.styled_button import StyledButton, OUTER_MARGIN, INNER_MARGIN

class SignWaiver(Screen):
    def _build(self, controller):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN, OUTER_MARGIN)
        outer.setSpacing(0)

        outline = OutlineFrame()
        outer.addWidget(outline)

        root = QVBoxLayout(outline)
        root.setContentsMargins(INNER_MARGIN, INNER_MARGIN, INNER_MARGIN, INNER_MARGIN)
        root.setSpacing(0)

        content = QHBoxLayout()
        content.setContentsMargins(50, 0, 50, 0)
        content.setSpacing(20)

        left = QVBoxLayout()
        left.setSpacing(0)

        left.addStretch(1)

        instruction = QLabel(
            "Please scan the QR code\non the right and sign the waiver"
        )
        instruction.setStyleSheet(
            "color: #F5F0E6; font: 36pt Montserrat;"
            "background: transparent; border: none;"
        )
        instruction.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        instruction.setWordWrap(True)
        left.addWidget(instruction)

        left.addStretch(2)

        content.addLayout(left, stretch=1)

        right = QVBoxLayout()
        right.setSpacing(0)
        right.addStretch()

        qr_px = QPixmap(AssetController.QR_WAIVER.get_path())
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

        root.addLayout(content)
