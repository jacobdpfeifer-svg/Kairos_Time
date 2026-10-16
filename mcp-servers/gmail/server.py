"""Gmail MCP — read + drafts + label/archive/star + gated send.

``send_email`` executes for real only through ConfirmationGuard
(preview → fingerprint-bound token → confirm). Never automatic.

Live mode: ``GOOGLE_OAUTH_CLIENT_SECRETS`` + google-auth packages.
Tokens under ``{user_root}/auth/google/token.json``. Dry-run otherwise.
"""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import Context, FastMCP

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp-servers"))

from common import google_oauth  # noqa: E402
from common.actuator import gate_connector_write, gate_with_human, user_root  # noqa: E402
from common.stop_rewind import rewind_last  # noqa: E402

from canvas_mcp.core.ledger import UndoPtr, append_ledger  # noqa: E402

mcp = FastMCP("kairos-gmail")
_DRAFTS: dict[str, dict[str, Any]] = {}
_LABELS: dict[str, list[str]] = {}


def _labels_fingerprint(labels: list[str] | None) -> str:
    return ",".join(sorted(labels or []))


@mcp.tool()
def create_draft(
    to: str,
    subject: str,
    body: str,
    why: str = "Email draft automation",
    confirmation_token: str | None = None,
) -> str:
    """Save a draft only — never sends."""
    root = user_root()
    gate = gate_connector_write(
        root,
        "email_draft",
        connector_id="gmail",
        tool="create_draft",
        fingerprint_parts=[to, subject, body, why],
        preview_lines=[
            f"To: {to}",
            f"Subject: {subject}",
            f"Body ({len(body)} chars):\n{body}",
            f"Why: {why}",
        ],
        confirmation_token=confirmation_token,
        actor="gmail",
        target=to,
        why=why,
        log_block=False,
    )
    if gate.kind != "proceed":
        return gate.message

    service = google_oauth.gmail_service(root)
    if service is not None:
        remote = google_oauth.gmail_create_draft(
            service, to=to, subject=subject, body=body
        )
        draft_id = str(remote.get("id") or f"draft_{uuid.uuid4().hex[:12]}")
        draft = {
            "id": draft_id,
            "to": to,
            "subject": subject,
            "body": body,
            "mode": "live",
        }
    else:
        draft_id = f"draft_{uuid.uuid4().hex[:12]}"
        draft = {
            "id": draft_id,
            "to": to,
            "subject": subject,
            "body": body,
            "mode": "dry-run",
        }
        _DRAFTS[draft_id] = draft

    append_ledger(
        root,
        actor="gmail",
        tool="create_draft",
        target=draft_id,
        why=why,
        outcome="success",
        category="email_draft",
        undo_ptr=UndoPtr(kind="gmail_draft", id=draft_id, prior=None),
    )
    return json.dumps({"status": "drafted", "draft": draft, "narrate": True})


@mcp.tool()
def apply_labels(
    message_id: str,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
    why: str = "Email triage",
    confirmation_token: str | None = None,
) -> str:
    """Label/archive/star — never delete. Stores prior label state for undo."""
    root = user_root()
    add = list(add_labels or [])
    remove = list(remove_labels or [])
    gate = gate_connector_write(
        root,
        "email_triage",
        connector_id="gmail",
        tool="apply_labels",
        fingerprint_parts=[
            message_id,
            _labels_fingerprint(add),
            _labels_fingerprint(remove),
            why,
        ],
        preview_lines=[
            f"Message ID: {message_id}",
            f"Add labels: {', '.join(sorted(add)) or '(none)'}",
            f"Remove labels: {', '.join(sorted(remove)) or '(none)'}",
            f"Why: {why}",
        ],
        confirmation_token=confirmation_token,
        actor="gmail",
        target=message_id,
        why=why,
        log_block=False,
    )
    if gate.kind != "proceed":
        return gate.message

    service = google_oauth.gmail_service(root)
    if service is not None:
        existing = (
            service.users().messages().get(userId="me", id=message_id).execute()
        )
        prior = list(existing.get("labelIds") or [])
        remote = google_oauth.gmail_modify_labels(
            service,
            message_id,
            add_labels=add,
            remove_labels=remove,
        )
        labels = list(remote.get("labelIds") or [])
        mode = "live"
    else:
        prior = list(_LABELS.get(message_id, []))
        labels = list(prior)
        for lab in remove:
            if lab in labels:
                labels.remove(lab)
        for lab in add:
            if lab not in labels:
                labels.append(lab)
        _LABELS[message_id] = labels
        mode = "dry-run"

    append_ledger(
        root,
        actor="gmail",
        tool="apply_labels",
        target=message_id,
        why=why,
        outcome="success",
        category="email_label",
        undo_ptr=UndoPtr(
            kind="gmail_label",
            id=message_id,
            prior={"labels": prior},
        ),
    )
    return json.dumps(
        {"status": "labeled", "labels": labels, "mode": mode, "narrate": True}
    )


def _undo_gmail_draft(ptr: dict[str, Any]) -> bool:
    draft_id = ptr.get("id")
    if not draft_id:
        return False
    root = user_root()
    service = google_oauth.gmail_service(root)
    if service is not None:
        try:
            google_oauth.gmail_delete_draft(service, draft_id)
            return True
        except Exception:
            return False
    return bool(_DRAFTS.pop(draft_id, None) is not None)


def _undo_gmail_label(ptr: dict[str, Any]) -> bool:
    message_id = ptr.get("id")
    prior = (ptr.get("prior") or {}).get("labels")
    if not message_id or prior is None:
        return False
    root = user_root()
    service = google_oauth.gmail_service(root)
    if service is not None:
        try:
            existing = (
                service.users().messages().get(userId="me", id=message_id).execute()
            )
            current = list(existing.get("labelIds") or [])
            add = [x for x in prior if x not in current]
            remove = [x for x in current if x not in prior]
            google_oauth.gmail_modify_labels(
                service, message_id, add_labels=add, remove_labels=remove
            )
            return True
        except Exception:
            return False
    _LABELS[message_id] = list(prior)
    return True


@mcp.tool()
def rewind(n: int = 1) -> str:
    undone = rewind_last(
        user_root(),
        n,
        handlers={
            "gmail_draft": _undo_gmail_draft,
            "gmail_label": _undo_gmail_label,
        },
    )
    return json.dumps({"undone": len(undone), "ids": [u.get("target") for u in undone]})


@mcp.tool()
def describe_mode() -> str:
    """Return actuator mode: dry-run | oauth-ready | live."""
    mode = google_oauth.describe_mode(user_root())
    return json.dumps({"mode": mode, "actuator": "gmail"})


@mcp.tool()
async def send_email(
    to: str,
    subject: str,
    body: str,
    why: str = "Email send",
    confirmation_token: str | None = None,
    ctx: Context | None = None,
) -> str:
    """Send a real email. Always previews first; only sends once the student
    approves this exact content in the client's approval prompt (the model
    cannot answer it) — see
    docs/handoff/canvas-focus-pivot-2026-09-11.md (2026-09-13 addendum).
    Irreversible: no undo_ptr, `rewind` cannot unsend."""
    root = user_root()
    gate = await gate_with_human(
        ctx,
        root,
        "email_send",
        connector_id="gmail",
        tool="send_email",
        fingerprint_parts=[to, subject, body, why],
        preview_lines=[
            f"To: {to}",
            f"Subject: {subject}",
            f"Body ({len(body)} chars):\n{body}",
            f"Why: {why}",
            "",
            "This will actually send. It cannot be undone.",
        ],
        confirmation_token=confirmation_token,
        actor="gmail",
        target=to,
        why=why,
        log_block=False,
    )
    if gate.kind != "proceed":
        return gate.message

    service = google_oauth.gmail_service(root)
    if service is not None:
        remote = google_oauth.gmail_send_message(
            service, to=to, subject=subject, body=body
        )
        message_id = str(remote.get("id") or f"sent_{uuid.uuid4().hex[:12]}")
        mode = "live"
    else:
        message_id = f"sent_{uuid.uuid4().hex[:12]}"
        mode = "dry-run"

    append_ledger(
        root,
        actor="gmail",
        tool="send_email",
        target=message_id,
        why=why,
        outcome="success",
        category="email_send",
        undo_ptr=None,
    )
    return json.dumps(
        {"status": "sent", "message_id": message_id, "mode": mode, "narrate": True}
    )


if __name__ == "__main__":
    mcp.run()
