from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import QLabel

from .theme import CREAM, FONT_FAMILY


def styled_label(
    text: str = "",
    *,
    size: int,
    bold: bool = False,
    color: str = CREAM,
    align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignHCenter,
    wrap: bool = False,
    wrap_width: int | None = None,
) -> QLabel:
    lbl = QLabel(text)

    font = QFont(FONT_FAMILY, size)
    font.setBold(bold)
    lbl.setFont(font)

    lbl.setStyleSheet(f"color: {color}; background: transparent; border: none;")
    lbl.setAlignment(align)

    if wrap or wrap_width is not None:
        lbl.setWordWrap(True)
    if wrap_width is not None:
        lbl.setFixedWidth(wrap_width)
        lbl.setMinimumHeight(lbl.heightForWidth(wrap_width))

    return lbl


def field_label(text: str) -> QLabel:
    return styled_label(text, size=18)
