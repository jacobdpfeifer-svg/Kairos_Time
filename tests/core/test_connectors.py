"""Phase 6 connectors: honest states, device-code flow, persisted confirmation."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest

from canvas_mcp.core import connectors as c
from canvas_mcp.core.connector_guards import reset_connector_guards


@pytest.fixture(autouse=True)
def _guards() -> Any:
    reset_connector_guards()
    yield
    reset_connector_guards()


class FakeMs:
    """Scripted Microsoft identity + Graph transport."""

    def __init__(self) -> None:
        self.token_responses: list[tuple[int, dict[str, Any]]] = []
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.graph_status = 200
        self.messages = [{"id": "m1", "subject": "MATH 1300 midterm room change", "from": {"emailAddress": {"address": "prof@colorado.edu"}}, "receivedDateTime": "2026-09-18T10:00:00Z", "isRead": False, "webLink": "https://outlook.example/m1"}]

    def __call__(self, url: str, body: dict[str, Any] | None, headers: dict[str, str], method: str) -> tuple[int, dict[str, Any]]:
        self.calls.append((url, body))
        if url.endswith("/devicecode"):
            return 200, {"device_code": "dc", "user_code": "ABCD-1234", "verification_uri": "https://microsoft.com/devicelogin", "interval": 1, "expires_in": 900, "message": "go"}
        if url.endswith("/token"):
            return self.token_responses.pop(0) if self.token_responses else (400, {"error": "authorization_pending"})
        if "/me?" in url:
            if self.graph_status != 200:
                return self.graph_status, {"error": {"code": "InvalidAuthenticationToken"}}
            return 200, {"userPrincipalName": "student@colorado.edu"}
        if "/me/messages" in url:
            if self.graph_status != 200:
                return self.graph_status, {"error": {"code": "InvalidAuthenticationToken"}}
            return 200, {"value": self.messages}
        return 404, {}


def test_not_configured_states_name_the_missing_input(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MS_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    st = c.status(tmp_path)
    assert st["outlook"]["state"] == "not_configured" and "MS_OAUTH_CLIENT_ID" in st["outlook"]["detail"]
    assert st["gcal"]["state"] == "not_configured" and "GOOGLE_OAUTH_CLIENT_SECRETS" in st["gcal"]["detail"]
    with pytest.raises(c.ConnectorError) as info:
        c.outlook_begin(tmp_path, http=FakeMs())
    assert info.value.code == "not_configured"


def test_outlook_device_code_pending_then_connected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MS_OAUTH_CLIENT_ID", "client-123")
    fake = FakeMs()
    begin = c.outlook_begin(tmp_path, http=fake)
    assert begin["user_code"] == "ABCD-1234" and c.status(tmp_path)["outlook"]["state"] == "pending_auth"
    fake.token_responses = [(400, {"error": "authorization_pending"}), (400, {"error": "slow_down"}), (200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})]
    assert c.outlook_poll(tmp_path, http=fake)["pending"] is True
    assert c.outlook_poll(tmp_path, http=fake)["interval"] == 6
    done = c.outlook_poll(tmp_path, http=fake)
    assert done["state"] == "connected" and done["items"][0]["subject"].startswith("MATH 1300")
    st = c.status(tmp_path)["outlook"]
    assert st["state"] == "connected" and st["account"] == "student@colorado.edu" and st["account_type"] == "organization" and st["items"] == 1
    # Token file is owner-only and never in the record.
    token_file = c.ms_token_path(tmp_path)
    assert token_file.exists() and oct(token_file.stat().st_mode & 0o777) == "0o600"
    record = (tmp_path / "inbox" / "connectors" / "outlook.json").read_text()
    assert "AT" not in record.split('"id"')[0] and "refresh" not in record
    # The device code never lingers in the registry after completion.
    assert c.load_registry(tmp_path)["outlook"].get("device") is None


def test_outlook_declined_consent_and_expiry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MS_OAUTH_CLIENT_ID", "client-123")
    fake = FakeMs()
    c.outlook_begin(tmp_path, http=fake)
    fake.token_responses = [(400, {"error": "authorization_declined"})]
    with pytest.raises(c.ConnectorError, match="declined"):
        c.outlook_poll(tmp_path, http=fake)
    assert c.status(tmp_path)["outlook"]["state"] == "disconnected"
    c.outlook_begin(tmp_path, http=fake)
    fake.token_responses = [(400, {"error": "invalid_grant", "error_description": "AADSTS65001: The user or administrator has not consented"})]
    with pytest.raises(c.ConnectorError) as info:
        c.outlook_poll(tmp_path, http=fake)
    assert info.value.code == "consent_required" and c.status(tmp_path)["outlook"]["state"] == "consent_required"
    # Code expiry is checked locally before polling.
    c.outlook_begin(tmp_path, http=fake)
    reg = c.load_registry(tmp_path)
    reg["outlook"]["device"]["expires_at"] = time.time() - 1
    c.save_registry(tmp_path, reg)
    with pytest.raises(c.ConnectorError, match="expired"):
        c.outlook_poll(tmp_path, http=fake)


def test_outlook_refresh_and_revoked_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MS_OAUTH_CLIENT_ID", "client-123")
    fake = FakeMs()
    c._write_secret_file(c.ms_token_path(tmp_path), {"access_token": "OLD", "refresh_token": "RT", "expires_at": time.time() - 10})
    fake.token_responses = [(200, {"access_token": "NEW", "refresh_token": "RT2", "expires_in": 3600})]
    res = c.outlook_read(tmp_path, http=fake)
    assert res["state"] == "connected"
    assert json.loads(c.ms_token_path(tmp_path).read_text())["access_token"] == "NEW"
    # Provider rejects the token: state becomes expired, not silently "connected".
    fake.graph_status = 401
    with pytest.raises(c.ConnectorError) as info:
        c.outlook_read(tmp_path, http=fake)
    assert info.value.code == "expired" and c.status(tmp_path)["outlook"]["state"] == "expired"
    out = c.outlook_disconnect(tmp_path)
    assert out["state"] == "disconnected" and not c.ms_token_path(tmp_path).exists()
    assert c.load_record(tmp_path, "outlook") is None


def test_two_profiles_keep_separate_tokens(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MS_OAUTH_CLIENT_ID", "client-123")
    a, b = tmp_path / "a", tmp_path / "b"
    fake = FakeMs()
    c.outlook_begin(a, http=fake)
    fake.token_responses = [(200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})]
    c.outlook_poll(a, http=fake)
    assert c.status(a)["outlook"]["state"] == "connected"
    assert c.status(b)["outlook"]["state"] in ("disconnected", "not_configured")
    with pytest.raises(c.ConnectorError, match="not connected"):
        c.outlook_read(b, http=fake)


def test_calendar_write_needs_matching_single_use_confirmation(tmp_path: Path) -> None:
    preview = c.gcal_preview_event(tmp_path, summary="Study MATH 1300", start_iso="2026-09-20T15:00:00-06:00", end_iso="2026-09-20T16:00:00-06:00", why="midterm prep")
    assert preview["executable"] is False and "not connected" in preview["note"]
    token = preview["confirmation_token"]
    # A changed preview cannot be authorized by the old token (and burns it).
    with pytest.raises(c.ConnectorError) as info:
        c.gcal_confirm_event(tmp_path, summary="Study MATH 1300", start_iso="2026-09-21T15:00:00-06:00", end_iso="2026-09-21T16:00:00-06:00", why="midterm prep", confirmation_token=token)
    assert info.value.code == "confirmation"
    with pytest.raises(c.ConnectorError) as info:
        c.gcal_confirm_event(tmp_path, summary="Study MATH 1300", start_iso="2026-09-20T15:00:00-06:00", end_iso="2026-09-20T16:00:00-06:00", why="midterm prep", confirmation_token=token)
    assert info.value.code == "confirmation"  # burned by the mismatch
    # A fresh preview with a disconnected calendar refuses to execute — never a dry-run "created".
    fresh = c.gcal_preview_event(tmp_path, summary="Study MATH 1300", start_iso="2026-09-20T15:00:00-06:00", end_iso="2026-09-20T16:00:00-06:00", why="midterm prep")
    with pytest.raises(c.ConnectorError) as info:
        c.gcal_confirm_event(tmp_path, summary="Study MATH 1300", start_iso="2026-09-20T15:00:00-06:00", end_iso="2026-09-20T16:00:00-06:00", why="midterm prep", confirmation_token=fresh["confirmation_token"])
    assert info.value.code == "disconnected"


def test_confirmation_survives_a_process_restart(tmp_path: Path) -> None:
    preview = c.gcal_preview_event(tmp_path, summary="S", start_iso="a", end_iso="b", why="w")
    reset_connector_guards()  # a new process: fresh in-memory guard, persisted state reloads
    guard = c._guard(tmp_path, "gcal")
    assert guard.check(preview["confirmation_token"], guard.fingerprint("S", "a", "b", "w")) is None
    assert guard.reserve(preview["confirmation_token"]) is True
    c._persist_guard(tmp_path, "gcal", guard)
    reset_connector_guards()
    guard2 = c._guard(tmp_path, "gcal")
    assert guard2.reserve(preview["confirmation_token"]) is False  # spent claims persist too


def test_relevant_context_selects_locally(tmp_path: Path) -> None:
    c._save_record(tmp_path, "gcal", {"fetched_at": "x", "items": [{"id": "1", "summary": "MATH 1300 review", "start": "2026-09-19T15:00:00Z"}, {"id": "2", "summary": "Dentist", "start": "2026-09-19T16:00:00Z"}]})
    c._save_record(tmp_path, "outlook", {"fetched_at": "x", "items": [{"id": "m", "subject": "Re: MATH 1300 office hours"}, {"id": "n", "subject": "Newsletter"}]})
    out = c.relevant_context(tmp_path, course_terms=["MATH 1300"], days=3650)
    assert [e["id"] for e in out["events"]] == ["1"] and [m["id"] for m in out["emails"]] == ["m"]


# --- Mission Control calendar island (2026-10-15): ledger, replay, expiry -------------


class FakeGoogle:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []

    def calendar_service(self, user_root: Path) -> object:
        return object()

    def gcal_create_event(self, service: object, **fields: Any) -> dict[str, Any]:
        self.created.append(fields)
        return {"id": f"evt-{len(self.created)}"}


def _ledger(root: Path) -> list[dict[str, Any]]:
    path = root / "ledger.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def _connected(monkeypatch: pytest.MonkeyPatch, root: Path) -> FakeGoogle:
    fake = FakeGoogle()
    monkeypatch.setattr(c, "_google_oauth", lambda: fake)
    c._set(root, "gcal", state="connected")
    return fake


def test_confirmed_calendar_write_happens_once_and_is_ledgered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _connected(monkeypatch, tmp_path)
    fields = {"summary": "Work on PS4", "start_iso": "2026-10-15T20:00:00Z", "end_iso": "2026-10-15T21:30:00Z", "why": "Due in the next few days"}
    token = c.gcal_preview_event(tmp_path, **fields)["confirmation_token"]
    out = c.gcal_confirm_event(tmp_path, **fields, confirmation_token=token)
    assert out["created"]["id"] == "evt-1" and len(fake.created) == 1
    with pytest.raises(c.ConnectorError) as info:
        c.gcal_confirm_event(tmp_path, **fields, confirmation_token=token)
    assert info.value.code == "confirmation"  # replay refused
    assert len(fake.created) == 1
    rows = _ledger(tmp_path)
    assert [r["outcome"] for r in rows] == ["success", "veto"]
    assert rows[0]["tool"] == "gcal_create_event" and rows[0]["target"] == "google_calendar:evt-1"
    assert rows[0]["preview_hash"] and rows[0]["category"] == "calendar"


def test_changed_field_or_expired_token_never_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _connected(monkeypatch, tmp_path)
    fields = {"summary": "Work on PS4", "start_iso": "2026-10-15T20:00:00Z", "end_iso": "2026-10-15T21:30:00Z", "why": "w"}
    token = c.gcal_preview_event(tmp_path, **fields)["confirmation_token"]
    with pytest.raises(c.ConnectorError):
        c.gcal_confirm_event(tmp_path, **{**fields, "summary": "Something else"}, confirmation_token=token)
    expired = c.gcal_preview_event(tmp_path, **fields)["confirmation_token"]
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + 3600)
    with pytest.raises(c.ConnectorError) as info:
        c.gcal_confirm_event(tmp_path, **fields, confirmation_token=expired)
    assert info.value.code == "confirmation"
    assert fake.created == []
    assert {r["outcome"] for r in _ledger(tmp_path)} == {"veto"}
