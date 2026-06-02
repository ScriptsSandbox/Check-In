import logging

from PyQt6.QtCore import QObject, pyqtSignal


class MainThreadDispatcher(QObject):
    call = pyqtSignal(object)

    def __init__(self) -> None:
        super().__init__()
        self.call.connect(lambda fn: fn())

        logging.info("main thread dispatcher initialized")
