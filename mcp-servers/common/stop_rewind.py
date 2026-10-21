"""Shared STOP + rewind helpers for actuators."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from canvas_mcp.core.ledger import Ledger, append_ledger
from canvas_mcp.core.permissions import load_permissions, save_permissions


def engage_global_stop(user_root: Path, *, hours: int = 24) -> str:
    state = load_permissions(user_root)
    until = datetime.now(timezone.utc) + timedelta(hours=hours)
    state.global_stop_until = until.isoformat()
    save_permissions(user_root, state)
    append_ledger(
        user_root,
        actor="user",
        tool="global_stop",
        target="*",
        why=f"Global STOP engaged for {hours}h",
        outcome="paused",
        category="skill_promotion",
        undo_ptr=None,
    )
    return state.global_stop_until


UndoHandler = Callable[[dict[str, Any]], bool]


def rewind_last(
    user_root: Path,
    n: int = 1,
    *,
    handlers: dict[str, UndoHandler] | None = None,
) -> list[dict[str, Any]]:
    """Walk back the last N reversible ledger entries using undo_ptr handlers."""
    handlers = handlers or {}
    ledger = Ledger(user_root)
    reversible = ledger.last_reversible(n)
    undone: list[dict[str, Any]] = []
    for row in reversed(reversible):
        ptr = row.get("undo_ptr") or {}
        kind = ptr.get("kind")
        handler = handlers.get(kind)
        ok = False
        if handler:
            ok = handler(ptr)
        append_ledger(
            user_root,
            actor="user",
            tool="rewind",
            target=str(ptr.get("id")),
            why=f"Rewind of {row.get('tool')}",
            outcome="success" if ok else "error",
            category=str(row.get("category") or "calendar"),
            undo_ptr=None,
        )
        if ok:
            undone.append(row)
    return undone
