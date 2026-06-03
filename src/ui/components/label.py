from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import QLabel

from ui.theme import CREAM, FONT_FAMILY


def styled_label(
    text: str = "",
    *,
    font_size: int,
    bold: bool = False,
    align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignHCenter,
    width: int = 1000,
) -> QLabel:
    label = QLabel(text)

    font = QFont(FONT_FAMILY, font_size)
    font.setBold(bold)
    label.setFont(font)

    label.setStyleSheet(f"color: {CREAM}")
    label.setAlignment(align)

    label.setWordWrap(True)
    label.setFixedWidth(width)
    label.setMinimumHeight(label.heightForWidth(width))

    return label


def title_label(text: str) -> QLabel:
    return styled_label(text, font_size=80, bold=True)

def field_label(text: str) -> QLabel:
    return styled_label(text, font_size=18)
