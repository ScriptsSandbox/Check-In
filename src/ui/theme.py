from PyQt6.QtCore import QSize
from PyQt6.QtGui import QFont

OUTER_MARGIN: int = 14
INNER_MARGIN: int = 24

NAV_BTN_SIZE: int = 100
NAV_ICON_SIZE: QSize = QSize(52, 52)

FONT_FAMILY: str = "Montserrat"


def app_font(size: int, *, bold: bool = False) -> QFont:
    font = QFont(FONT_FAMILY)
    font.setPixelSize(size)
    font.setBold(bold)
    return font

CREAM: str = "#F5F0E6"
ACCENT: str = "#4EBEEE"
READONLY_TEXT: str = "#C8C0B0"
DARK: str = "#153246"
