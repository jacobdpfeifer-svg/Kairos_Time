"""Shared actuator bootstrap — user_root + write gate + ConfirmationGuard."""

from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp-servers"))

from common.actuator import (  # noqa: E402
    check_write,
    gate_connector_write,
    gate_with_human,
    release_connector_confirmation,
    user_root,
)

from canvas_mcp.core.connector_guards import reset_connector_guards  # noqa: E402
from canvas_mcp.core.permissions import load_permissions, save_permissions  # noqa: E402
from canvas_mcp.core.user_root import ensure_user_root  # noqa: E402

_TOKEN_RE = re.compile(r"confirmation_token='([^']+)'")


@pytest.fixture(autouse=True)
def _reset_guards():
    reset_connector_guards()
    yield
    reset_connector_guards()


def _set_posture(root: Path, category: str, posture: str) -> None:
    state = load_permissions(root)
    state.categories[category].posture = posture  # type: ignore[assignment]
    save_permissions(root, state)


def _extract_token(preview: str) -> str:
    match = _TOKEN_RE.search(preview)
    assert match, f"no confirmation_token in preview:\n{preview}"
    return match.group(1)


def test_actuator_user_root_honors_dev(tmp_path, monkeypatch):
    ensure_user_root(tmp_path)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    monkeypatch.setenv("PRODUCT_USER_ID", "dev")
    assert user_root() == tmp_path.resolve()


def test_check_write_blocks_never_category(tmp_path, monkeypatch):
    ensure_user_root(tmp_path)
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    state = load_permissions(tmp_path)
    state.categories["lti_submit"].posture = "never"
    save_permissions(tmp_path, state)
    ok, reason = check_write(
        tmp_path,
        "lti_submit",
        confirmed=True,
        actor="test",
        tool="submit",
        target="x",
        why="test",
        log_block=False,
    )
    assert not ok
    assert reason


def test_gate_automatic_proceeds_without_token(tmp_path):
    ensure_user_root(tmp_path)
    # Use a category that may be automatic (calendar/email_send are ALWAYS_GATED).
    _set_posture(tmp_path, "email_triage", "automatic")
    gate = gate_connector_write(
        tmp_path,
        "email_triage",
        connector_id="gmail",
        tool="apply_labels",
        fingerprint_parts=["msg1", "INBOX", "why"],
        preview_lines=["Apply labels"],
        confirmation_token=None,
        actor="gmail",
        target="msg1",
        why="why",
        log_block=False,
    )
    assert gate.kind == "proceed"
    assert gate.confirmation_token is None


def test_gate_gated_no_token_returns_preview(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    gate = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["Study", "a", "b", "why"],
        preview_lines=["Summary: Study"],
        confirmation_token=None,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    assert gate.kind == "preview"
    assert "NOTHING has been written yet" in gate.message
    assert "Summary: Study" in gate.message
    assert _extract_token(gate.message)


def test_gate_gated_forged_token_rejected(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    gate = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["Study", "a", "b", "why"],
        preview_lines=["Summary: Study"],
        confirmation_token="9999999999.deadbeef.f" * 4,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    assert gate.kind == "blocked"
    assert "malformed" in gate.message.lower() or "confirmation" in gate.message.lower()


def test_gate_gated_wrong_content_token_rejected(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    preview = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["Study", "a", "b", "why"],
        preview_lines=["Summary: Study"],
        confirmation_token=None,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    token = _extract_token(preview.message)
    gate = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["DIFFERENT", "a", "b", "why"],
        preview_lines=["Summary: DIFFERENT"],
        confirmation_token=token,
        actor="gcal",
        target="DIFFERENT",
        why="why",
        log_block=False,
    )
    assert gate.kind == "blocked"
    assert "does not match" in gate.message


def test_gate_gated_valid_token_proceeds_once(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    parts = ["Study", "a", "b", "why"]
    preview = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=None,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    token = _extract_token(preview.message)
    first = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=token,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
        human_approved=True,
    )
    assert first.kind == "proceed"
    assert first.confirmation_token == token

    second = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=token,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
        human_approved=True,
    )
    assert second.kind == "blocked"
    assert "already used" in second.message.lower()


def test_gate_never_blocks_even_with_preview_token(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    preview = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["Study", "a", "b", "why"],
        preview_lines=["Summary: Study"],
        confirmation_token=None,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    token = _extract_token(preview.message)
    _set_posture(tmp_path, "calendar", "never")
    gate = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=["Study", "a", "b", "why"],
        preview_lines=["Summary: Study"],
        confirmation_token=token,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
        human_approved=True,
    )
    assert gate.kind == "blocked"
    assert "Blocked" in gate.message


def test_valid_token_without_student_approval_needs_human(tmp_path):
    """F15: the token proves the content; only the student's own answer
    (``human_approved``, set from an elicitation) lets a send/event proceed,
    and asking does not burn the token."""
    ensure_user_root(tmp_path)
    kwargs = {
        "connector_id": "gcal",
        "tool": "create_event",
        "fingerprint_parts": ["Study", "a", "b", "why"],
        "preview_lines": ["Summary: Study"],
        "actor": "gcal",
        "target": "Study",
        "why": "why",
        "log_block": False,
    }
    token = _extract_token(gate_connector_write(tmp_path, "calendar", confirmation_token=None, **kwargs).message)
    waiting = gate_connector_write(tmp_path, "calendar", confirmation_token=token, **kwargs)
    assert waiting.kind == "needs_human" and "Summary: Study" in waiting.message
    approved = gate_connector_write(tmp_path, "calendar", confirmation_token=token, human_approved=True, **kwargs)
    assert approved.kind == "proceed"


@pytest.mark.asyncio
async def test_gate_with_human_fails_closed_without_elicitation_support(tmp_path):
    """A valid token must not execute when the MCP client cannot elicit."""
    ensure_user_root(tmp_path)
    kwargs = {
        "connector_id": "gcal",
        "tool": "create_event",
        "fingerprint_parts": ["Study", "a", "b", "why"],
        "preview_lines": ["Summary: Study"],
        "actor": "gcal",
        "target": "Study",
        "why": "why",
        "log_block": False,
    }
    preview = gate_connector_write(tmp_path, "calendar", confirmation_token=None, **kwargs)
    token = _extract_token(preview.message)

    result = await gate_with_human(
        None, tmp_path, "calendar", confirmation_token=token, **kwargs
    )

    assert result.kind == "blocked"
    assert "Nothing was written" in result.message


@pytest.mark.asyncio
async def test_gate_with_human_proceeds_only_after_accepted_elicitation(tmp_path):
    """The approval comes from an MCP elicitation, never a tool argument."""
    ensure_user_root(tmp_path)
    kwargs = {
        "connector_id": "gcal",
        "tool": "create_event",
        "fingerprint_parts": ["Study", "a", "b", "why"],
        "preview_lines": ["Summary: Study"],
        "actor": "gcal",
        "target": "Study",
        "why": "why",
        "log_block": False,
    }
    preview = gate_connector_write(tmp_path, "calendar", confirmation_token=None, **kwargs)
    token = _extract_token(preview.message)

    class ApprovingContext:
        called = False

        async def elicit(self, *, message, schema):
            self.called = True
            assert "Summary: Study" in message
            return SimpleNamespace(
                action="accept", data=SimpleNamespace(approve=True)
            )

    ctx = ApprovingContext()
    result = await gate_with_human(
        ctx, tmp_path, "calendar", confirmation_token=token, **kwargs
    )

    assert ctx.called
    assert result.kind == "proceed"


def test_release_connector_confirmation_allows_retry(tmp_path):
    ensure_user_root(tmp_path)
    _set_posture(tmp_path, "calendar", "gated")
    parts = ["Study", "a", "b", "why"]
    preview = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=None,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
    )
    token = _extract_token(preview.message)
    first = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=token,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
        human_approved=True,
    )
    assert first.kind == "proceed"
    release_connector_confirmation("gcal", first.confirmation_token)
    retry = gate_connector_write(
        tmp_path,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=parts,
        preview_lines=["Summary: Study"],
        confirmation_token=token,
        actor="gcal",
        target="Study",
        why="why",
        log_block=False,
        human_approved=True,
    )
    assert retry.kind == "proceed"


def test_write_tools_no_longer_expose_confirmed_bool():
    import importlib.util

    sys.path.insert(0, str(REPO / "mcp-servers"))
    from gcal import server as gcal_server  # noqa: E402
    from gmail import server as gmail_server  # noqa: E402

    apple_path = REPO / "mcp-servers" / "apple-cal" / "server.py"
    spec = importlib.util.spec_from_file_location("apple_cal_server", apple_path)
    assert spec and spec.loader
    apple_server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apple_server)

    for fn in (
        gcal_server.create_event,
        gcal_server.update_event,
        gmail_server.create_draft,
        gmail_server.apply_labels,
        gmail_server.send_email,
        apple_server.create_event,
    ):
        params = inspect.signature(fn).parameters
        assert "confirmed" not in params
        assert "confirmation_token" in params
