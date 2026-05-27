from pathlib import Path
from PyQt6.QtWidgets import QMainWindow, QWidget, QStackedWidget, QLabel, QVBoxLayout
from PyQt6.QtGui import QFontDatabase, QPainter, QPixmap, QColor
from PyQt6.QtCore import QTimer, Qt

import notifier

ASSETS_PATH = Path(__file__).parent / "assets" / "shared"


class _RootWidget(QWidget):

    def __init__(self, parent=None):
        super().__init__(parent)
        bg_path = ASSETS_PATH / "background_main.png"
        self._bg = QPixmap(str(bg_path)) if bg_path.exists() else QPixmap()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#153246"))
        if not self._bg.isNull():
            x = (self.width() - self._bg.width()) // 2
            y = (self.height() - self._bg.height()) // 2
            painter.drawPixmap(x, y, self._bg)


class CheckInWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Check-In")
        self.setFixedSize(1280, 720)

        fonts_dir = Path(__file__).parent.parent / "fonts"
        if fonts_dir.exists():
            for font_file in fonts_dir.glob("*.ttf"):
                QFontDatabase.addApplicationFont(str(font_file))

        self.central = _RootWidget()
        self.setCentralWidget(self.central)

        self.stacked = QStackedWidget(self.central)
        self.stacked.setGeometry(0, 0, 1280, 720)
        self.stacked.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.stacked.setStyleSheet("background: transparent;")

        self._error = QWidget(self.central)
        self._error.setGeometry(0, 0, 1280, 720)
        self._error.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self._error.setStyleSheet("background-color: rgba(0, 0, 0, 110);")
        self._error.hide()
        layout = QVBoxLayout(self._error)
        layout.setContentsMargins(120, 120, 120, 120)
        layout.setSpacing(20)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._error_heading = QLabel("ERROR", self._error)
        self._error_heading.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._error_heading.setStyleSheet("background: transparent; color: #FF6B6B; font: bold 28pt Montserrat; letter-spacing: 6px;")
        self._error_title = QLabel("", self._error)
        self._error_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._error_title.setWordWrap(True)
        self._error_title.setStyleSheet("background: transparent; color: #F5F0E6; font: bold 40pt Montserrat;")
        self._error_detail = QLabel("", self._error)
        self._error_detail.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        self._error_detail.setWordWrap(True)
        self._error_detail.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self._error_detail.setStyleSheet(
            "background-color: rgba(0, 0, 0, 160);"
            "color: #E6E1D6;"
            "font: 11pt 'Menlo', 'Monaco', 'Courier New', monospace;"
            "border: 1px solid rgba(255, 255, 255, 40);"
            "border-radius: 6px;"
            "padding: 14px 18px;"
        )
        self._error_detail.setFixedWidth(900)
        self._error_countdown = QLabel("", self._error)
        self._error_countdown.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._error_countdown.setStyleSheet("background: transparent; color: #F5F0E6; font: 16pt Montserrat;")
        layout.addWidget(self._error_heading)
        layout.addWidget(self._error_title)
        layout.addWidget(self._error_detail, alignment=Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(self._error_countdown)

        self._retry_timer = QTimer(self)
        self._retry_timer.setInterval(1000)
        self._retry_timer.timeout.connect(self._tick_retry)
        self._retry_remaining = 0
        self._retry_callback = None

        self._escape_handler = None

    def show_error(self, title, detail, *, retry_in=None, on_retry=None):
        self._error_title.setText(title)
        self._error_detail.setText(detail)
        self._retry_timer.stop()
        self._retry_callback = on_retry
        if retry_in is not None and on_retry is not None:
            self._retry_remaining = int(retry_in)
            self._error_countdown.setText(f"Retrying in {self._retry_remaining}s…")
            self._error_countdown.show()
            self._retry_timer.start()
        else:
            self._error_countdown.clear()
            self._error_countdown.hide()
        self._error.show()
        self._error.raise_()
        notifier.notify_critical(title, detail)

    def hide_error(self):
        self._retry_timer.stop()
        self._retry_callback = None
        self._error.hide()
        notifier.notify_resolved()

    def is_error_visible(self):
        return self._error.isVisible()

    def _tick_retry(self):
        self._retry_remaining -= 1
        if self._retry_remaining <= 0:
            self._retry_timer.stop()
            self._error_countdown.setText("Retrying…")
            cb = self._retry_callback
            self._retry_callback = None
            if cb:
                cb()
        else:
            self._error_countdown.setText(f"Retrying in {self._retry_remaining}s…")

    def set_escape_handler(self, fn):
        self._escape_handler = fn

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape and self._escape_handler:
            self._escape_handler()
        else:
            super().keyPressEvent(event)
