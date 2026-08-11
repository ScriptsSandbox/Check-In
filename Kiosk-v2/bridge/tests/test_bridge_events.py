import asyncio
from threading import Event

from app import BridgeState
from sheets_backend import CheckInResult


class BlockingBackend:
    def __init__(self) -> None:
        self.release = Event()

    def check_in(self, uid: str) -> CheckInResult:
        assert uid == "0123456789ABCD"
        assert self.release.wait(timeout=2)
        return CheckInResult(
            outcome="success",
            display_name="Test member",
            message="Check-in recorded.",
            visit_count=3,
        )


class FailingBackend:
    def check_in(self, uid: str) -> CheckInResult:
        raise RuntimeError("temporary Sheets failure")


def test_detection_is_broadcast_before_backend_finishes() -> None:
    async def scenario() -> None:
        backend = BlockingBackend()
        state = BridgeState(backend)
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=20)
        state.clients.add(queue)

        publish_task = asyncio.create_task(state.publish("0123456789ABCD"))
        detected = await asyncio.wait_for(queue.get(), timeout=0.5)

        assert detected["type"] == "card_detected"
        assert detected["sequence"] == 1
        assert not publish_task.done()

        backend.release.set()
        completed = await asyncio.wait_for(queue.get(), timeout=2)
        assert await publish_task is True
        assert completed["type"] == "card_read"
        assert completed["outcome"] == "success"
        assert completed["sequence"] == detected["sequence"]
        assert isinstance(completed["processing_ms"], int)
        assert completed["backend_timings_ms"] == {}

    asyncio.run(scenario())


def test_backend_failure_is_display_safe_and_allows_immediate_retry() -> None:
    async def scenario() -> None:
        state = BridgeState(FailingBackend())
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=20)
        state.clients.add(queue)

        assert await state.publish("0123456789ABCD") is True
        assert (await queue.get())["type"] == "card_detected"
        failed = await queue.get()
        assert failed["type"] == "card_read"
        assert failed["outcome"] == "backend_error"
        assert "temporary Sheets failure" not in str(failed)

        assert await state.publish("0123456789ABCD") is True

    asyncio.run(scenario())
