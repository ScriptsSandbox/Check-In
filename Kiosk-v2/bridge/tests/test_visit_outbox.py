from visit_outbox import VisitOutbox


def activity_row(visit_id="visit_1"):
    return [
        visit_id,
        "person_1",
        "2026-08-19T10:00:00",
        "User Checkin",
        "",
        "",
        "",
        "Kiosk v2",
        "",
    ]


def test_outbox_survives_process_reopen(tmp_path):
    path = tmp_path / "checkins.sqlite3"
    first = VisitOutbox(path)
    first.enqueue(activity_row())
    first.close()

    reopened = VisitOutbox(path)
    assert [item.visit_id for item in reopened.pending()] == ["visit_1"]
    assert reopened.visit_dates("person_1") == {"2026-08-19"}
    assert reopened.status()["pending"] == 1
    reopened.close()


def test_outbox_ignores_duplicate_visit_ids(tmp_path):
    outbox = VisitOutbox(tmp_path / "checkins.sqlite3")
    outbox.enqueue(activity_row())
    outbox.enqueue(activity_row())
    assert outbox.status()["pending"] == 1
    outbox.close()


def test_failed_rows_back_off_and_remain_durable(tmp_path):
    clock = [1000.0]
    outbox = VisitOutbox(tmp_path / "checkins.sqlite3", now=lambda: clock[0])
    outbox.enqueue(activity_row())
    outbox.mark_failed("visit_1", "network unavailable")

    assert outbox.pending() == []
    assert outbox.status()["pending"] == 1
    assert outbox.status()["last_error"] == "network unavailable"

    clock[0] += 1.1
    assert [item.visit_id for item in outbox.pending()] == ["visit_1"]
    outbox.mark_synced("visit_1")
    assert outbox.status()["pending"] == 0
    outbox.close()
