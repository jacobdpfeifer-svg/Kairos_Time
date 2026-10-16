"""Dry-run OAuth helper smoke — live Google packages optional.

Calendar/Gmail write helpers execute for real as of the 2026-09-13 addendum
to docs/handoff/canvas-focus-pivot-2026-09-11.md — they are no longer
hard-blocked stubs. What must hold instead: the MCP tool layer always gates
them behind ConfirmationGuard (never an automatic/standing posture), and a
sent email/created event without live credentials still returns a
predictable dry-run response instead of raising.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp-servers"))

from common import google_oauth  # noqa: E402


class _Student:
    """Stands in for the MCP client's approval prompt (elicitation)."""

    def __init__(self, approve: bool) -> None:
        self.approve = approve
        self.asked: list[str] = []

    async def elicit(self, message, schema):
        self.asked.append(message)
        return SimpleNamespace(action="accept" if self.approve else "decline", data=schema(approve=self.approve))


def test_live_oauth_false_without_secrets(monkeypatch, tmp_path):
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    assert google_oauth.client_secrets_path() is None
    assert google_oauth.live_oauth_available() is False
    assert google_oauth.calendar_service(tmp_path) is None
    assert google_oauth.gmail_service(tmp_path) is None
    assert google_oauth.describe_mode(tmp_path) == "dry-run"


def test_secrets_path_requires_existing_file(monkeypatch, tmp_path):
    missing = tmp_path / "missing.json"
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRETS", str(missing))
    assert google_oauth.client_secrets_path() is None
    present = tmp_path / "client.json"
    present.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRETS", str(present))
    assert google_oauth.client_secrets_path() == present


def test_gcal_gmail_describe_mode_tools_dry_run(monkeypatch, tmp_path):
    """MCP actuators must expose describe_mode (oauth-smoke checklist)."""
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    monkeypatch.setenv("PRODUCT_USER_ID", "dev")

    from gcal import server as gcal_server  # type: ignore
    from gmail import server as gmail_server  # type: ignore

    gcal = json.loads(gcal_server.describe_mode())
    gmail = json.loads(gmail_server.describe_mode())
    assert gcal["mode"] == "dry-run"
    assert gmail["mode"] == "dry-run"
    assert gcal["actuator"] == "gcal"
    assert gmail["actuator"] == "gmail"


def test_send_email_and_create_event_preview_before_write(monkeypatch, tmp_path):
    """No token yet -> preview only, nothing sent/created (no live creds needed)."""
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    monkeypatch.setenv("PRODUCT_USER_ID", "dev")

    from gcal import server as gcal_server  # type: ignore
    from gmail import server as gmail_server  # type: ignore

    send_preview = asyncio.run(gmail_server.send_email(to="prof@school.edu", subject="Hi", body="Body"))
    assert "NOTHING has been written yet" in send_preview
    assert "confirmation_token=" in send_preview

    event_preview = asyncio.run(gcal_server.create_event(
        summary="Study block", start_iso="2026-09-14T10:00:00", end_iso="2026-09-14T11:00:00"
    ))
    assert "NOTHING has been written yet" in event_preview
    assert "confirmation_token=" in event_preview


def test_send_email_executes_after_confirm_dry_run(monkeypatch, tmp_path):
    """With no live Google creds, a confirmed send/create still succeeds (dry-run)."""
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    monkeypatch.setenv("PRODUCT_USER_ID", "dev")

    from gcal import server as gcal_server  # type: ignore
    from gmail import server as gmail_server  # type: ignore

    student = _Student(approve=True)
    preview = asyncio.run(gmail_server.send_email(to="prof@school.edu", subject="Hi", body="Body"))
    token = preview.split("confirmation_token='")[1].split("'")[0]
    result = json.loads(
        asyncio.run(gmail_server.send_email(
            to="prof@school.edu", subject="Hi", body="Body", confirmation_token=token, ctx=student
        ))
    )
    assert student.asked and "prof@school.edu" in student.asked[0]
    assert result["status"] == "sent"
    assert result["mode"] == "dry-run"

    from canvas_mcp.core.ledger import Ledger

    ledger_rows = Ledger(tmp_path).read_all()
    assert any(
        r.get("tool") == "send_email" and r.get("outcome") == "success" for r in ledger_rows
    ), "confirmed send_email must append a ledger.jsonl success row"

    preview2 = asyncio.run(gcal_server.create_event(
        summary="Study block", start_iso="2026-09-14T10:00:00", end_iso="2026-09-14T11:00:00"
    ))
    token2 = preview2.split("confirmation_token='")[1].split("'")[0]
    result2 = json.loads(
        asyncio.run(gcal_server.create_event(
            summary="Study block",
            start_iso="2026-09-14T10:00:00",
            end_iso="2026-09-14T11:00:00",
            confirmation_token=token2,
            ctx=_Student(approve=True),
        ))
    )
    assert result2["status"] == "created"
    assert result2["mode"] == "dry-run"
    ledger_rows = Ledger(tmp_path).read_all()
    assert any(
        r.get("tool") == "create_event" and r.get("outcome") == "success" for r in ledger_rows
    ), "confirmed create_event must append a ledger.jsonl success row"


def test_token_alone_never_sends_without_the_students_answer(monkeypatch, tmp_path):
    """F15: a model holding a valid token still cannot send. No approval
    prompt (no ctx), or a declined one, writes nothing and burns nothing."""
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRETS", raising=False)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    monkeypatch.setenv("PRODUCT_USER_ID", "dev")

    from gmail import server as gmail_server  # type: ignore

    preview = asyncio.run(gmail_server.send_email(to="x@example.invalid", subject="s", body="b"))
    token = preview.split("confirmation_token='")[1].split("'")[0]
    for ctx in (None, _Student(approve=False)):
        out = asyncio.run(gmail_server.send_email(to="x@example.invalid", subject="s", body="b", confirmation_token=token, ctx=ctx))
        assert "Nothing was written" in out
    from canvas_mcp.core.ledger import Ledger

    assert not any(r.get("tool") == "send_email" for r in Ledger(tmp_path).read_all())
    # The same token still works once the student says yes.
    sent = json.loads(asyncio.run(gmail_server.send_email(to="x@example.invalid", subject="s", body="b", confirmation_token=token, ctx=_Student(approve=True))))
    assert sent["status"] == "sent"


def test_gcal_create_update_delete_call_real_calendar_api():
    """Live-credentials path must call the actual Calendar API, not raise."""
    service = MagicMock()
    service.events.return_value.insert.return_value.execute.return_value = {"id": "evt_1"}
    google_oauth.gcal_create_event(
        service, summary="x", start_iso="2026-09-14T10:00:00", end_iso="2026-09-14T11:00:00"
    )
    service.events.return_value.insert.assert_called_once()

    service.events.return_value.patch.return_value.execute.return_value = {"id": "evt_1"}
    google_oauth.gcal_update_event(service, "evt_1", summary="y")
    service.events.return_value.patch.assert_called_once()

    service.events.return_value.delete.return_value.execute.return_value = None
    google_oauth.gcal_delete_event(service, "evt_1")
    service.events.return_value.delete.assert_called_once()


def test_gmail_send_message_calls_real_gmail_api():
    service = MagicMock()
    service.users.return_value.messages.return_value.send.return_value.execute.return_value = {
        "id": "msg_1"
    }
    google_oauth.gmail_send_message(service, to="x@y.com", subject="s", body="b")
    service.users.return_value.messages.return_value.send.assert_called_once()


def test_gcal_scopes_include_events_write():
    assert "https://www.googleapis.com/auth/calendar.events" in google_oauth.GCAL_SCOPES


def test_gmail_scopes_include_send():
    assert "https://www.googleapis.com/auth/gmail.send" in google_oauth.GMAIL_SCOPES


def test_email_send_and_calendar_never_escalate_to_automatic(tmp_path):
    """Per the 2026-09-13 addendum: no k-based auto-escalation, ever."""
    from canvas_mcp.core.permissions import (
        ALWAYS_GATED,
        DEFAULT_K,
        DEFAULT_POSTURES,
        load_permissions,
        resolve_posture,
    )
    from canvas_mcp.core.user_root import ensure_user_root

    assert "email_send" not in DEFAULT_K
    assert "calendar" not in DEFAULT_K
    assert DEFAULT_POSTURES["email_send"] == "gated"
    assert DEFAULT_POSTURES["calendar"] == "gated"
    assert "email_send" in ALWAYS_GATED
    assert "calendar" in ALWAYS_GATED

    ensure_user_root(tmp_path)
    path = tmp_path / "calibration" / "permissions.yaml"
    path.write_text(
        "categories:\n"
        "  email_send:\n"
        "    posture: automatic\n"
        "  calendar:\n"
        "    posture: automatic\n"
        "courses:\n"
        "  c1:\n"
        "    email_send:\n"
        "      posture: automatic\n",
        encoding="utf-8",
    )
    state = load_permissions(tmp_path)
    assert state.categories["email_send"].posture == "gated"
    assert state.categories["calendar"].posture == "gated"
    assert state.courses["c1"]["email_send"].posture == "gated"
    assert resolve_posture(state, "email_send") == "gated"
    assert resolve_posture(state, "calendar") == "gated"
    assert resolve_posture(state, "email_send", course_id="c1") == "gated"
