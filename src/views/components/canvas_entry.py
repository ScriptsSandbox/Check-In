from __future__ import annotations

import tkinter as tk
from typing import Any

_focused: CanvasEntry | None = None


class CanvasEntry:
    def __init__(
        self,
        canvas: tk.Canvas,
        x: float,
        y: float,
        w: float,
        h: float,
        font: Any,
        fg: str = "#F5F0E6",
    ) -> None:
        self.canvas = canvas
        self._x = x
        self._y = y

        canvas.configure(insertbackground=fg, insertontime=600, insertofftime=400)

        self._hit_id = canvas.create_rectangle(
            x - w / 2, y - h / 2, x + w / 2, y + h / 2,
            fill="", outline="", state="hidden",
        )
        self._text_id = canvas.create_text(
            x, y, text="", fill=fg, font=font,
            anchor="center", state="hidden",
        )

        canvas.tag_bind(self._hit_id, "<Button-1>", self._on_click)
        canvas.tag_bind(self._text_id, "<Button-1>", self._on_click)

    @property
    def item_ids(self) -> list[int]:
        return [self._hit_id, self._text_id]

    def _on_click(self, event: tk.Event[Any] | None = None) -> None:
        if getattr(self, '_readonly', False):
            return
        global _focused
        if _focused and _focused is not self:
            _focused._blur()
        _focused = self
        self.canvas.focus_set()
        self.canvas.focus(self._text_id)  # type: ignore[no-untyped-call]
        self.canvas.bind("<Key>", _dispatch_key)
        if event:
            idx = self.canvas.index(self._text_id, f"@{event.x},{event.y}")  # type: ignore[no-untyped-call]
            self.canvas.icursor(self._text_id, idx)
        else:
            self.canvas.icursor(self._text_id, tk.END)

    def _blur(self) -> None:
        global _focused
        if _focused is self:
            _focused = None
        self.canvas.focus("")  # type: ignore[no-untyped-call]

    @classmethod
    def blur_all(cls) -> None:
        global _focused
        if _focused:
            _focused._blur()

    def get(self) -> str:
        return self.canvas.itemcget(self._text_id, "text")  # type: ignore[no-untyped-call, no-any-return]

    def delete(self, start: int | str, end: int | str | None = None) -> None:
        self.canvas.dchars(self._text_id, 0, tk.END)

    def insert(self, index: int | str, text: str) -> None:
        self.canvas.insert(self._text_id, index, text)

    def set_readonly(self, readonly: bool) -> None:
        self._readonly = readonly
        color = "#C8C0B0" if readonly else "#F5F0E6"
        self.canvas.itemconfigure(self._text_id, fill=color)


def _dispatch_key(event: tk.Event[Any]) -> None:
    if _focused:
        if event.keysym == "BackSpace":
            idx = _focused.canvas.index(_focused._text_id, tk.INSERT)  # type: ignore[no-untyped-call]
            if idx > 0:
                _focused.canvas.dchars(_focused._text_id, idx - 1, idx - 1)
        elif event.char and event.char.isprintable():
            _focused.canvas.insert(_focused._text_id, tk.INSERT, event.char)
