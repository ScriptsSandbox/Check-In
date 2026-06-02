import logging
from collections.abc import Callable
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFontDatabase, QPainter, QPixmap, QColor, QFont, QPaintEvent, QKeyEvent
from PyQt6.QtWidgets import QMainWindow, QStackedWidget, QApplication, QWidget, QVBoxLayout
from pyqttoast import Toast, ToastPosition, ToastPreset

from misc.asset import Asset
from misc.global_config import config
from misc.global_context import context
from ui.components.error_overlay import ErrorOverlay
from ui.components.label import title_label


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Check-In")
        self.setFixedSize(config().SCREEN_WIDTH, config().SCREEN_HEIGHT)

        fonts_dir = Path(Asset.FONTS_DIR.get_path())
        for font_file in fonts_dir.glob("*.ttf"):
            QFontDatabase.addApplicationFont(str(font_file))

        self.central = QStackedWidget()
        self.setCentralWidget(self.central)

        self._error = ErrorOverlay(self.central)

        self._boot = QWidget(self.central)
        self._boot.setGeometry(0, 0, config().SCREEN_WIDTH, config().SCREEN_HEIGHT)
        boot_layout = QVBoxLayout(self._boot)
        boot_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        boot_layout.addWidget(title_label("Booting..."), alignment=Qt.AlignmentFlag.AlignHCenter)

        Toast.setPositionRelativeToWidget(self.central)
        Toast.setPosition(ToastPosition.BOTTOM_RIGHT)
        Toast.setMaximumOnScreen(3)

        if config().DEV_MODE:
            # TODO: this is just some temporary code that opens the ui on the screen I want it to
            self.setGeometry(QApplication.screens()[2].geometry())
        self.showFullScreen()

        QApplication.processEvents()

        logging.info("main window initialized")

    def finish_boot(self) -> None:
        self._boot.hide()

    def show_error(
            self, title:
            str, detail:
            str,
            *,
            retry_in: int | None = None,
            on_retry: Callable[[], None] | None = None
    ) -> None:
        self._boot.hide()
        self._error.show_error(title, detail, retry_in=retry_in, on_retry=on_retry)

    def hide_error(self) -> None:
        self._error.hide_error()

    def show_toast_async(self, title: str, text: str = "", toast_preset: ToastPreset = ToastPreset.INFORMATION) -> None:
        context().dispatcher.call.emit(lambda: self._show_toast(title, text, toast_preset))

    def _show_toast(self, title: str, text: str = "", toast_preset: ToastPreset = ToastPreset.INFORMATION) -> None:
        toast = Toast(self)
        toast.setTitle(title)
        if text:
            toast.setText(text)
        toast.applyPreset(toast_preset)
        toast.setDuration(7_000)
        # toast.setShowIcon(True)
        toast.setShowCloseButton(False)
        # toast.setShowDurationBar(False)
        # toast.setResetDurationOnHover(False)
        toast.setBorderRadius(10)
        toast.setMaximumWidth(400)
        # toast.setBackgroundColor(QColor(0, 0, 0, 170))
        # toast.setTextColor(QColor("#F5F0E6"))
        toast.setTitleFont(QFont("Montserrat", 18, QFont.Weight.Bold))
        toast.setTextFont(QFont("Montserrat", 14, QFont.Weight.Normal))
        toast.show()

    def paintEvent(self, event: QPaintEvent | None) -> None:
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#153246"))
        painter.drawPixmap(0, 0, QPixmap(Asset.BACKGROUND.get_path()))

    def is_error_visible(self) -> bool:
        return self._error.isVisible()

    def keyPressEvent(self, event: QKeyEvent | None) -> None:
        if event and event.key() == Qt.Key.Key_Escape:
            context().navigation_controller.back_to_main()
        else:
            super().keyPressEvent(event)
