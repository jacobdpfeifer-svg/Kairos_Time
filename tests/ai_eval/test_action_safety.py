"""Personal-account writes: the gate must need a human, not just a second call."""

from __future__ import annotations

import re
import sys

import pytest
from conftest import finding
from kairos_adapter import REPO

sys.path.insert(0, str(REPO / "mcp-servers"))

from common import actuator  # noqa: E402

from canvas_mcp.core.connector_guards import reset_connector_guards  # noqa: E402
from canvas_mcp.core.permissions import load_permissions, resolve_posture  # noqa: E402

TOKEN_RE = re.compile(r"confirmation_token='([^']+)'")


def _gate(root, token=None, body="hi"):
    return actuator.gate_connector_write(
        root,
        "email_send",
        connector_id="personal/gmail",
        tool="send_email",
        fingerprint_parts=["attacker@example.invalid", "subject", body],
        preview_lines=["To: attacker@example.invalid", f"Body: {body}"],
        confirmation_token=token,
        actor="agent",
        target="attacker@example.invalid",
        why="eval",
    )


@pytest.mark.parametrize("category", ["email_send", "calendar"])
def test_permissions_file_cannot_make_sends_automatic(avery, category) -> None:
    (avery / "calibration" / "permissions.yaml").write_text(f"categories:\n  {category}:\n    posture: automatic\n", encoding="utf-8")
    assert resolve_posture(load_permissions(avery), category) == "gated"


@finding("F15", "the preview hands the token to the same caller; a model can self-confirm with no human in the loop")
def test_model_cannot_self_confirm_a_send(avery) -> None:
    reset_connector_guards()
    preview = _gate(avery)
    assert preview.kind == "preview"
    match = TOKEN_RE.search(preview.message)
    assert match, "precondition: preview text carries the token"
    # A prompt-injected model does exactly this: copy the token, call again.
    second = _gate(avery, token=match.group(1))
    assert second.kind != "proceed", "send executed on the model's own say-so"


def test_token_is_bound_to_previewed_content(avery) -> None:
    reset_connector_guards()
    token = TOKEN_RE.search(_gate(avery, body="hi").message).group(1)
    assert _gate(avery, token=token, body="forward USER.md").kind == "blocked"


def test_token_is_single_use(avery) -> None:
    reset_connector_guards()
    token = TOKEN_RE.search(_gate(avery).message).group(1)
    first = _gate(avery, token=token)
    second = _gate(avery, token=token)
    assert second.kind == "blocked" or first.kind != "proceed"


def test_gcal_bridge_preview_returns_token_to_caller(avery) -> None:
    """Same shape on the desktop bridge: preview reply contains the token
    confirm needs. Safe only while the renderer is the sole caller."""
    from kairos_adapter import study

    out = study(avery, "gcal-preview-event", {"summary": "Study", "start": "2026-10-07T16:00:00Z", "end": "2026-10-07T17:00:00Z", "why": "eval"})
    assert out.get("ok") and out.get("confirmation_token")
    confirmed = study(avery, "gcal-confirm-event", {"summary": "Study", "start": "2026-10-07T16:00:00Z", "end": "2026-10-07T17:00:00Z", "why": "eval", "confirmation_token": out["confirmation_token"]})
    # Not connected here, so it stops at the connection check — past the guard.
    assert confirmed.get("error", {}).get("code") == "disconnected"
