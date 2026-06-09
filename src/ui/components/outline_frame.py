from PyQt6.QtWidgets import QFrame, QWidget
from PyQt6.QtGui import QPainter, QPen, QColor, QPainterPath, QPaintEvent
from PyQt6.QtCore import Qt, QRectF


class OutlineFrame(QFrame):

    def __init__(self, parent: QWidget | None = None, radius: int = 20) -> None:
        super().__init__(parent)
        self._radius = radius

    def paintEvent(self, event: QPaintEvent | None) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        half_pen = 2
        rect = QRectF(self.rect()).adjusted(half_pen, half_pen, -half_pen, -half_pen)

        path = QPainterPath()
        path.addRoundedRect(rect, self._radius, self._radius)

        painter.fillPath(path, QColor(0, 0, 0, 35))

        pen = QPen(QColor(240, 240, 240, 200))
        pen.setWidth(4)
        pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawPath(path)
