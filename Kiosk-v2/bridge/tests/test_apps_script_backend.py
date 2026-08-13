import json

import apps_script_backend as module
from apps_script_backend import AppsScriptCheckInBackend


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def backend():
    return AppsScriptCheckInBackend("https://example.test/exec", "api-secret", "card-secret")


def test_card_check_in_sends_only_digest(monkeypatch):
    observed = {}

    def fake_urlopen(request, timeout):
        observed.update(json.loads(request.data.decode("utf-8")))
        assert timeout == 20
        return FakeResponse({"ok": True, "outcome": "success", "displayName": "Riley", "visitCount": 4})

    monkeypatch.setattr(module, "urlopen", fake_urlopen)
    result = backend().check_in("A1B2C3D4")
    assert result.outcome == "success"
    assert result.display_name == "Riley"
    assert observed["action"] == "check_in_card"
    assert observed["cardDigest"] == backend().card_digest("A1B2C3D4")
    assert "A1B2C3D4" not in json.dumps(observed)


def test_link_card_sends_digests_and_member_suffix(monkeypatch):
    observed = {}

    def fake_urlopen(request, timeout):
        observed.update(json.loads(request.data.decode("utf-8")))
        return FakeResponse({"ok": True, "outcome": "card_linked", "displayName": "Member"})

    monkeypatch.setattr(module, "urlopen", fake_urlopen)
    result = backend().link_card("A12345678", "11223344", "AABBCCDD", set())
    assert result.outcome == "card_linked"
    assert observed["memberLastFour"] == "3344"
    assert observed["memberDigest"] == backend().card_digest("11223344")
    assert observed["staffDigest"] == backend().card_digest("AABBCCDD")


def test_warm_up_requires_ready_response(monkeypatch):
    monkeypatch.setattr(module, "urlopen", lambda request, timeout: FakeResponse({"ok": False, "outcome": "unauthorized"}))
    try:
        backend().warm_up()
    except RuntimeError as error:
        assert "not ready" in str(error)
    else:
        raise AssertionError("warm_up should reject a non-ready API")


def test_replacement_sends_raw_token_only_for_authorized_fabman_handoff(monkeypatch):
    observed = {}

    def fake_urlopen(request, timeout):
        observed.update(json.loads(request.data.decode("utf-8")))
        return FakeResponse({"ok": True, "outcome": "card_updated", "displayName": "Member"})

    monkeypatch.setattr(module, "urlopen", fake_urlopen)
    result = backend().complete_card_update("ABCD234567", "04A1B2C3D4E5F6")
    assert result.outcome == "card_updated"
    assert observed["action"] == "complete_card_update"
    assert observed["code"] == "ABCD234567"
    assert observed["cardToken"] == "04A1B2C3D4E5F6"
    assert observed["cardDigest"] == backend().card_digest("04A1B2C3D4E5F6")
    assert observed["cardLastFour"] == "E5F6"
