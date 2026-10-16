"""Email drafts for the Mission Control email island (2026-10-15).

A spoken or typed note becomes an *intent*; the student turns it into an
editable draft here. A draft is never authorization to send:

    intent → draft (editable) → review (exact recipient/subject/body/evidence)
    → send preview → explicit confirm → provider send → ledger outcome

The desktop app has no write-capable mail connector yet (Outlook is read-only,
``Mail.Read``; guarded Gmail send lives in the MCP server, not this UI), so
:func:`send_capability` is ``available: False`` and :func:`send` refuses. The
UI renders no Send button while that is true. When a provider bridge exists it
must bind a single-use ConfirmationGuard token to :func:`send_fingerprint`;
editing any field returns the draft to ``draft`` and invalidates that binding.

Drafts live in ``{user_root}/inbox/email/drafts/<id>.json`` (0600, atomic).
Evidence keeps message ids and subjects only — never a raw email body.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .model import StudyError, write_private_text

DRAFT_ID_RE = re.compile(r"^d[0-9a-f]{16}$")
EMAIL_RE = re.compile(r"^[^@\s,;<>\"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")
LIMITS = {"to": 5, "subject": 200, "body": 10_000, "intent": 2000, "evidence": 5}
NOT_CONNECTED = "Sending is not connected on this device"


def drafts_dir(user_root: Path) -> Path:
    return user_root / "inbox" / "email" / "drafts"


def _path(user_root: Path, draft_id: str) -> Path:
    if not DRAFT_ID_RE.match(draft_id or ""):
        raise StudyError("validation", "invalid draft id")
    return drafts_dir(user_root) / f"{draft_id}.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _recipients(raw: Any) -> list[str]:
    items = raw if isinstance(raw, list) else str(raw or "").replace(";", ",").split(",")
    out = [str(x).strip() for x in items if str(x).strip()]
    if len(out) > LIMITS["to"]:
        raise StudyError("validation", f"at most {LIMITS['to']} recipients")
    for addr in out:
        if not EMAIL_RE.match(addr):
            raise StudyError("validation", f"not an email address: {addr[:80]}")
    return out


def _text(raw: Any, key: str) -> str:
    value = str(raw or "")
    if len(value) > LIMITS[key]:
        raise StudyError("validation", f"{key} is longer than {LIMITS[key]} characters")
    return value


def _evidence(raw: Any) -> list[dict[str, str]]:
    rows = raw if isinstance(raw, list) else []
    out = []
    for row in rows[: LIMITS["evidence"]]:
        if not isinstance(row, dict):
            continue
        # Ids and subjects only. A body field, if sent, is dropped here.
        out.append({"id": str(row.get("id") or "")[:200], "subject": str(row.get("subject") or "")[:200], "kind": str(row.get("kind") or "email")[:32]})
    return out


def _read(user_root: Path, draft_id: str) -> dict[str, Any]:
    try:
        draft = json.loads(_path(user_root, draft_id).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise StudyError("not_found", "no such draft") from exc
    if not isinstance(draft, dict) or draft.get("status") == "discarded":
        raise StudyError("not_found", "no such draft")
    return draft


def _write(user_root: Path, draft: dict[str, Any]) -> dict[str, Any]:
    write_private_text(_path(user_root, draft["draft_id"]), json.dumps(draft, indent=2))
    return draft


def send_capability(user_root: Path) -> dict[str, Any]:
    """No desktop provider bridge exists yet; this is the single switch the UI reads."""
    return {"available": False, "reason": NOT_CONNECTED}


def send_fingerprint(draft: dict[str, Any]) -> str:
    """Hash of every send-relevant field: a confirmation must bind all of them."""
    material = json.dumps(
        {"to": draft.get("to"), "subject": draft.get("subject"), "body": draft.get("body"), "connector": draft.get("connector"), "evidence": [e.get("id") for e in draft.get("evidence") or []]},
        sort_keys=True,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def create(user_root: Path, params: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    draft = {
        "schema_version": 1,
        "draft_id": f"d{secrets.token_hex(8)}",
        "status": "draft",
        "intent": _text(params.get("intent"), "intent"),
        "to": _recipients(params.get("to")),
        "subject": _text(params.get("subject"), "subject"),
        "body": _text(params.get("body"), "body"),
        "evidence": _evidence(params.get("evidence")),
        "connector": str(params.get("connector") or "none")[:32],
        "created_at": now,
        "updated_at": now,
    }
    return {"ok": True, "draft": _write(user_root, draft)}


def update(user_root: Path, draft_id: str, params: dict[str, Any]) -> dict[str, Any]:
    draft = _read(user_root, draft_id)
    for key in ("intent", "subject", "body"):
        if key in params:
            draft[key] = _text(params[key], key)
    if "to" in params:
        draft["to"] = _recipients(params["to"])
    if "evidence" in params:
        draft["evidence"] = _evidence(params["evidence"])
    # Any edit returns the draft to review: nothing previewed earlier still stands.
    draft["status"] = "draft"
    draft["updated_at"] = _now()
    return {"ok": True, "draft": _write(user_root, draft)}


def review(user_root: Path, draft_id: str) -> dict[str, Any]:
    """The exact thing that would be sent, plus whether sending is possible at all."""
    draft = _read(user_root, draft_id)
    if not draft["to"] or not draft["subject"].strip() or not draft["body"].strip():
        raise StudyError("validation", "a draft needs a recipient, a subject, and a body before review")
    draft["status"] = "reviewed"
    draft["updated_at"] = _now()
    _write(user_root, draft)
    return {"ok": True, "draft": draft, "fingerprint": send_fingerprint(draft), "send": send_capability(user_root)}


def list_drafts(user_root: Path) -> dict[str, Any]:
    out = []
    try:
        files = sorted(drafts_dir(user_root).glob("d*.json"))
    except OSError:
        files = []
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and d.get("status") != "discarded" and DRAFT_ID_RE.match(str(d.get("draft_id") or "")):
            out.append(d)
    out.sort(key=lambda d: str(d.get("updated_at") or ""), reverse=True)
    return {"ok": True, "drafts": out, "send": send_capability(user_root)}


def get(user_root: Path, draft_id: str) -> dict[str, Any]:
    return {"ok": True, "draft": _read(user_root, draft_id), "send": send_capability(user_root)}


def discard(user_root: Path, draft_id: str) -> dict[str, Any]:
    path = _path(user_root, draft_id)
    _read(user_root, draft_id)
    path.unlink(missing_ok=True)
    return {"ok": True, "draft_id": draft_id}


def send(user_root: Path, draft_id: str, confirmation_token: str) -> dict[str, Any]:
    """Refuses until a provider bridge exists. Never falls back to a dry-run "sent"."""
    _read(user_root, draft_id)
    cap = send_capability(user_root)
    if not cap["available"]:
        raise StudyError("not_connected", cap["reason"])
    raise StudyError("not_connected", NOT_CONNECTED)  # pragma: no cover - no bridge yet
