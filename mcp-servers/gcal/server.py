"""Google Calendar MCP server — read + human-confirmed event writes.

Phase 1 shipped ``create_event``/``update_event`` as real writes gated by
``ConfirmationGuard``. The 2026-09-11 canvas-focus pivot cut those to
hard-blocked stubs. The 2026-09-13 addendum to
``docs/handoff/canvas-focus-pivot-2026-09-11.md`` reopened them: this is the
student's own calendar, not visible to an instructor, and every write still
requires a fresh per-instance confirmation — the guard preview must be shown
and the student must say go before anything is written. There is no
automatic/standing posture for this category (see ``permissions.py``
``DEFAULT_K`` — ``calendar`` has no escalation entry).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import Context, FastMCP

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp-servers"))

from common import google_oauth  # noqa: E402
from common.actuator import gate_with_human, user_root  # noqa: E402
from common.stop_rewind import engage_global_stop, rewind_last  # noqa: E402

from canvas_mcp.core.ledger import UndoPtr, append_ledger  # noqa: E402

mcp = FastMCP("kairos-gcal")


@mcp.tool()
async def create_event(
    summary: str,
    start_iso: str,
    end_iso: str,
    why: str = "Calendar event",
    confirmation_token: str | None = None,
    ctx: Context | None = None,
) -> str:
    """Create a real calendar event. Always previews first; only writes once
    the student approves this exact content in the client's approval prompt
    (the model cannot answer it)."""
    root = user_root()
    gate = await gate_with_human(
        ctx,
        root,
        "calendar",
        connector_id="gcal",
        tool="create_event",
        fingerprint_parts=[summary, start_iso, end_iso, why],
        preview_lines=[
            f"Summary: {summary}",
            f"Start: {start_iso}",
            f"End: {end_iso}",
            f"Why: {why}",
        ],
        confirmation_token=confirmation_token,
        actor="gcal",
        target=summary,
        why=why,
        log_block=False,
    )
    if gate.kind != "proceed":
        return gate.message

    service = google_oauth.calendar_service(root)
    if service is not None:
        remote = google_oauth.gcal_create_event(
            service, summary=summary, start_iso=start_iso, end_iso=end_iso
        )
        event_id = str(remote.get("id"))
        mode = "live"
    else:
        import uuid

        event_id = f"event_{uuid.uuid4().hex[:12]}"
        mode = "dry-run"

    append_ledger(
        root,
        actor="gcal",
        tool="create_event",
        target=event_id,
        why=why,
        outcome="success",
        category="calendar",
        undo_ptr=UndoPtr(kind="gcal_event_created", id=event_id, prior=None),
    )
    return json.dumps(
        {"status": "created", "event_id": event_id, "mode": mode, "narrate": True}
    )


@mcp.tool()
async def update_event(
    event_id: str,
    summary: str | None = None,
    start_iso: str | None = None,
    end_iso: str | None = None,
    why: str = "Calendar event update",
    confirmation_token: str | None = None,
    ctx: Context | None = None,
) -> str:
    """Update a real calendar event. Always previews first; only writes once
    the student approves this exact content in the client's approval prompt
    (the model cannot answer it)."""
    root = user_root()
    gate = await gate_with_human(
        ctx,
        root,
        "calendar",
        connector_id="gcal",
        tool="update_event",
        fingerprint_parts=[event_id, summary or "", start_iso or "", end_iso or "", why],
        preview_lines=[
            f"Event ID: {event_id}",
            f"New summary: {summary if summary is not None else '(unchanged)'}",
            f"New start: {start_iso if start_iso is not None else '(unchanged)'}",
            f"New end: {end_iso if end_iso is not None else '(unchanged)'}",
            f"Why: {why}",
        ],
        confirmation_token=confirmation_token,
        actor="gcal",
        target=event_id,
        why=why,
        log_block=False,
    )
    if gate.kind != "proceed":
        return gate.message

    service = google_oauth.calendar_service(root)
    if service is not None:
        prior = google_oauth.gcal_get_event(service, event_id)
        google_oauth.gcal_update_event(
            service,
            event_id,
            summary=summary,
            start_iso=start_iso,
            end_iso=end_iso,
        )
        mode = "live"
        prior_snapshot = {
            "summary": prior.get("summary"),
            "start_iso": (prior.get("start") or {}).get("dateTime"),
            "end_iso": (prior.get("end") or {}).get("dateTime"),
        }
    else:
        mode = "dry-run"
        prior_snapshot = {}

    append_ledger(
        root,
        actor="gcal",
        tool="update_event",
        target=event_id,
        why=why,
        outcome="success",
        category="calendar",
        undo_ptr=UndoPtr(kind="gcal_event_updated", id=event_id, prior=prior_snapshot),
    )
    return json.dumps(
        {"status": "updated", "event_id": event_id, "mode": mode, "narrate": True}
    )


def _undo_gcal_event_created(ptr: dict[str, Any]) -> bool:
    event_id = ptr.get("id")
    if not event_id:
        return False
    root = user_root()
    service = google_oauth.calendar_service(root)
    if service is None:
        return True
    try:
        google_oauth.gcal_delete_event(service, event_id)
        return True
    except Exception:
        return False


def _undo_gcal_event_updated(ptr: dict[str, Any]) -> bool:
    event_id = ptr.get("id")
    prior = ptr.get("prior") or {}
    if not event_id or not prior:
        return False
    root = user_root()
    service = google_oauth.calendar_service(root)
    if service is None:
        return True
    try:
        google_oauth.gcal_update_event(
            service,
            event_id,
            summary=prior.get("summary"),
            start_iso=prior.get("start_iso"),
            end_iso=prior.get("end_iso"),
        )
        return True
    except Exception:
        return False


@mcp.tool()
def rewind(n: int = 1) -> str:
    """Undo the last N reversible calendar writes (delete created events,
    restore updated ones to their prior summary/time)."""
    undone = rewind_last(
        user_root(),
        n,
        handlers={
            "gcal_event_created": _undo_gcal_event_created,
            "gcal_event_updated": _undo_gcal_event_updated,
        },
    )
    return json.dumps({"undone": len(undone), "ids": [u.get("target") for u in undone]})


@mcp.tool()
def global_stop(hours: int = 24) -> str:
    """Kill switch: pause all gated automation for this student."""
    until = engage_global_stop(user_root(), hours=hours)
    return f"STOP until {until}"


@mcp.tool()
def describe_mode() -> str:
    """Return actuator mode: dry-run | oauth-ready | live."""
    mode = google_oauth.describe_mode(user_root())
    return json.dumps({"mode": mode, "actuator": "gcal"})


if __name__ == "__main__":
    mcp.run()
