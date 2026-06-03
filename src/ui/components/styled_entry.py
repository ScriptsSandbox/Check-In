from PyQt6.QtWidgets import QHBoxLayout, QLineEdit, QVBoxLayout, QWidget
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

from .label import field_label
from ui.theme import ACCENT, CREAM, DARK, FONT_FAMILY, READONLY_TEXT


class StyledEntry(QLineEdit):

    def __init__(self, parent: QWidget | None = None, font_size: int = 20) -> None:
        super().__init__(parent)
        self.setMinimumHeight(54)
        self.setFont(QFont(FONT_FAMILY, font_size))
        self._apply_style(readonly=False)

    def _apply_style(self, readonly: bool) -> None:
        text_color = READONLY_TEXT if readonly else CREAM
        self.setStyleSheet(f"""
            QLineEdit {{
                background-color: rgba(0, 0, 0, 80);
                border: 2px solid {CREAM};
                border-radius: 12px;
                color: {text_color};
                padding: 6px 14px;
                selection-background-color: {ACCENT};
                selection-color: {DARK};
            }}
        """)

    def set_readonly(self, readonly: bool) -> None:
        self.setReadOnly(readonly)
        self._apply_style(readonly)


def field_row(
    layout: QVBoxLayout,
    label_text: str,
    *,
    max_width: int = 800,
    spacing: int = 8,
) -> StyledEntry:
    layout.addWidget(field_label(label_text), alignment=Qt.AlignmentFlag.AlignHCenter)

    row = QHBoxLayout()
    entry = StyledEntry()
    entry.setMaximumWidth(max_width)
    row.addStretch()
    row.addWidget(entry)
    row.addStretch()
    layout.addLayout(row)

    if spacing:
        layout.addSpacing(spacing)

    return entry
