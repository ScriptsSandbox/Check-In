from __future__ import annotations

import threading
from typing import Callable, TypeVar

T = TypeVar("T")


def run_with_timeout(func: Callable[[], T], name: str, timeout: float = 1.0) -> T:
    result: T | None = None
    error: BaseException | None = None

    def run() -> None:
        nonlocal result, error
        try:
            result = func()
        except BaseException as exception:
            error = exception

    worker = threading.Thread(target=run, daemon=True, name=f"timeout-{name}")
    worker.start()
    worker.join(timeout)

    if worker.is_alive():
        raise TimeoutError(f"{name} did not complete within {timeout:.0f}s")
    if error is not None:
        raise error
    return result  # type: ignore[return-value]
