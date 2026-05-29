from collections.abc import Callable

from PyQt6.QtCore import QObject, pyqtSignal


class MainThreadDispatcher(QObject):
    call = pyqtSignal(object)

    def __init__(self) -> None:
        super().__init__()
        self.call.connect(lambda fn: fn())
