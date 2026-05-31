from collections.abc import Callable
from pathlib import Path

from PyQt6.QtWidgets import QMainWindow, QWidget, QStackedWidget, QApplication
from PyQt6.QtGui import QFontDatabase, QPainter, QPixmap, QColor, QPaintEvent, QKeyEvent
from PyQt6.QtCore import Qt
from controllers.asset_controller import AssetController
from global_config import config
from global_context import context
from views.check_in_manual import CheckInManual
from views.components.error_overlay import ErrorOverlay
from views.create_account_manual import CreateAccountManual
from views.create_account_no_pid import CreateAccountNoPid
from views.create_account_review import CreateAccountReview


class _RootWidget(QWidget):

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._bg = QPixmap(AssetController.BACKGROUND.get_path())

    def paintEvent(self, event: QPaintEvent | None) -> None:
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#153246"))
        if not self._bg.isNull():
            x = (self.width() - self._bg.width()) // 2
            y = (self.height() - self._bg.height()) // 2
            painter.drawPixmap(x, y, self._bg)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
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

        self._error = ErrorOverlay(self.central)

        self._escape_handler: Callable[[], None] | None = None

        if config().DEV_MODE:
            # TODO: this is just some temporary code that opens the ui on the screen I want it to
            self.setGeometry(QApplication.screens()[1].geometry())
        self.showFullScreen()

    def show_error(self, title: str, detail: str, *, retry_in: int | None = None, on_retry: Callable[[], None] | None = None) -> None:
        self._error.show_error(title, detail, retry_in=retry_in, on_retry=on_retry)

    def hide_error(self) -> None:
        self._error.hide_error()

    def is_error_visible(self) -> bool:
        return self._error.isVisible()

    def keyPressEvent(self, event: QKeyEvent | None) -> None:
        if event and event.key() == Qt.Key.Key_Escape:
            context().navigation_controller.back_to_main()
            context().navigation_controller.get_frame(CreateAccountManual).clear_entries()
            context().navigation_controller.get_frame(CreateAccountNoPid).clear_entries()
            context().navigation_controller.get_frame(CreateAccountReview).clear_entries()
            context().navigation_controller.get_frame(CheckInManual).clear_entries()
        else:
            super().keyPressEvent(event)
