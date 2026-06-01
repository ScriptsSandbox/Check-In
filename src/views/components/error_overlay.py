from __future__ import annotations

from collections.abc import Callable

from PyQt6.QtWidgets import QWidget, QLabel, QVBoxLayout
from PyQt6.QtCore import QTimer, Qt


class ErrorOverlay(QWidget):
    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        print(self.geometry())
        self.setGeometry(0, 0, 1280, 720)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet("background-color: rgba(0, 0, 0, 110);")
        self.hide()

        layout = QVBoxLayout(self)
        layout.setContentsMargins(120, 120, 120, 120)
        layout.setSpacing(20)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._heading = QLabel("ERROR", self)
        self._heading.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._heading.setStyleSheet("background: transparent; color: #FF6B6B; font: bold 28pt Montserrat; letter-spacing: 6px;")

        self._title = QLabel("", self)
        self._title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._title.setWordWrap(True)
        self._title.setStyleSheet("background: transparent; color: #F5F0E6; font: bold 40pt Montserrat;")

        self._detail = QLabel("", self)
        self._detail.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        self._detail.setWordWrap(True)
        self._detail.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self._detail.setStyleSheet(
            "background-color: rgba(0, 0, 0, 160);"
            "color: #E6E1D6;"
            "font: 11pt 'Menlo', 'Monaco', 'Courier New', monospace;"
            "border: 1px solid rgba(255, 255, 255, 40);"
            "border-radius: 6px;"
            "padding: 14px 18px;"
        )
        self._detail.setFixedWidth(900)

        self._countdown = QLabel("", self)
        self._countdown.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._countdown.setStyleSheet("background: transparent; color: #F5F0E6; font: 16pt Montserrat;")

        layout.addWidget(self._heading)
        layout.addWidget(self._title)
        layout.addWidget(self._detail, alignment=Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(self._countdown)

        self._retry_timer = QTimer(self)
        self._retry_timer.setInterval(1000)
        self._retry_timer.timeout.connect(self._tick_retry)
        self._retry_remaining: int = 0
        self._retry_callback: Callable[[], None] | None = None

    def show_error(self, title: str, detail: str, *, retry_in: int | None = None, on_retry: Callable[[], None] | None = None) -> None:
        self._title.setText(title)
        self._detail.setText(detail)
        self._retry_timer.stop()
        self._retry_callback = on_retry
        if retry_in is not None and on_retry is not None:
            self._retry_remaining = int(retry_in)
            self._countdown.setText(f"Retrying in {self._retry_remaining}s…")
            self._countdown.show()
            self._retry_timer.start()
        else:
            self._countdown.clear()
            self._countdown.hide()
        self.show()
        self.raise_()

    def hide_error(self) -> None:
        self._retry_timer.stop()
        self._retry_callback = None
        self.hide()

    def _tick_retry(self) -> None:
        self._retry_remaining -= 1
        if self._retry_remaining <= 0:
            self._retry_timer.stop()
            self._countdown.setText("Retrying…")
            cb = self._retry_callback
            self._retry_callback = None
            if cb:
                cb()
        else:
            self._countdown.setText(f"Retrying in {self._retry_remaining}s…")
