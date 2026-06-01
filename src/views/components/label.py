from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import QLabel

from .theme import CREAM, FONT_FAMILY


def styled_label(
    text: str = "",
    *,
    font_size: int,
    bold: bool = False,
    align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignHCenter,
    width: int = 1000,
) -> QLabel:
    lbl = QLabel(text)

    font = QFont(FONT_FAMILY, font_size)
    font.setBold(bold)
    lbl.setFont(font)

    lbl.setStyleSheet(f"color: {CREAM}")
    lbl.setAlignment(align)

    lbl.setWordWrap(True)
    lbl.setFixedWidth(width)
    lbl.setMinimumHeight(lbl.heightForWidth(width))

    return lbl


def title_label(text: str) -> QLabel:
    return styled_label(text, font_size=80, bold=True)

def field_label(text: str) -> QLabel:
    return styled_label(text, font_size=18)
