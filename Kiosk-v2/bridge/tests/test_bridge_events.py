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
            person_id="person_1",
            profile={"role": "", "affiliation": "", "anticipatedGraduation": ""},
        )


class FailingBackend:
    def check_in(self, uid: str) -> CheckInResult:
        raise RuntimeError("temporary Sheets failure")


class CardLinkBackend:
    def __init__(self) -> None:
        self.link_calls = []

    def check_in(self, uid: str) -> CheckInResult:
        return CheckInResult(outcome="unknown_card", message="Unknown card")

    def link_card(self, identifier, card_uid, staff_uid, staff_ids):
        self.link_calls.append((identifier, card_uid, staff_uid, staff_ids))
        if staff_uid != "STAFF12345678":
            return CheckInResult(outcome="staff_unauthorized", message="Not authorized")
        return CheckInResult(
            outcome="card_linked",
            display_name="Test member",
            message="Card connected.",
        )


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
        assert completed["person_id"] == "person_1"
        assert completed["profile"]["role"] == ""
        assert state.profile_session_is_active()
        assert state.profile_person_id == "person_1"

    asyncio.run(scenario())


def test_non_successful_read_clears_profile_session() -> None:
    state = BridgeState()
    state.start_profile_session(CheckInResult(outcome="success", person_id="person_1"))
    assert state.profile_session_is_active()
    state.start_profile_session(CheckInResult(outcome="waiver_required"))
    assert not state.profile_session_is_active()


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


def test_unknown_card_is_kept_only_for_a_short_staff_link_session() -> None:
    async def scenario() -> None:
        backend = CardLinkBackend()
        state = BridgeState(backend, {"A87654321"})
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=20)
        state.clients.add(queue)

        assert await state.publish("NEWCARD123456") is True
        await queue.get()
        unknown = await queue.get()
        assert unknown["outcome"] == "unknown_card"
        assert state.pending_card_uid == "NEWCARD123456"

        state.card_link_identifier = "A12345678"
        assert await state.publish("NOTSTAFF1234") is True
        await queue.get()
        denied = await queue.get()
        assert denied["outcome"] == "staff_unauthorized"
        assert state.pending_card_uid == "NEWCARD123456"

        assert await state.publish("STAFF12345678") is True
        await queue.get()
        linked = await queue.get()
        assert linked["outcome"] == "card_linked"
        assert linked["display_name"] == "Test member"
        assert state.pending_card_uid is None
        assert backend.link_calls[-1] == (
            "A12345678",
            "NEWCARD123456",
            "STAFF12345678",
            {"A87654321"},
        )

        # The visitor can immediately tap the newly linked card to check in;
        # the original unknown-card read no longer occupies the duplicate guard.
        assert await state.publish("NEWCARD123456") is True

    asyncio.run(scenario())
