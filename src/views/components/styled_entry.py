from PyQt6.QtWidgets import QLineEdit, QWidget
from PyQt6.QtCore import Qt


class StyledEntry(QLineEdit):

    def __init__(self, parent: QWidget | None = None, font_size: int = 20) -> None:
        super().__init__(parent)
        self._font_size = font_size
        self.setMinimumHeight(54)
        self._apply_style(readonly=False)

    def _apply_style(self, readonly: bool) -> None:
        text_color = "#C8C0B0" if readonly else "#F5F0E6"
        self.setStyleSheet(f"""
            QLineEdit {{
                background-color: rgba(0, 0, 0, 80);
                border: 2px solid #F5F0E6;
                border-radius: 12px;
                color: {text_color};
                font: {self._font_size}pt Montserrat;
                padding: 6px 14px;
                selection-background-color: #4EBEEE;
                selection-color: #153246;
            }}
        """)

    def set_readonly(self, readonly: bool) -> None:
        self.setReadOnly(readonly)
        self._apply_style(readonly)
