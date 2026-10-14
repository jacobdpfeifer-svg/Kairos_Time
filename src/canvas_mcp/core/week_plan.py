"""Student-owned week plan state (docs/research/saas-themes-applied-to-kairos-2026-10-13.md).

Everything here is the student's own logistics, written locally:

* minute estimates per item (the app guesses; the student corrects)
* hours available for schoolwork per week (one answer, carried forward)
* deferrals ("do this on Thursday instead"), with undo
* an accepted plan per week, stamped ``accepted_at``; nothing reorders it later
* typed / voice / extension captures (``inbox/plan/items.jsonl``)
* pile corrections for Canvas arrivals, per change or "always" per course

No Canvas access, no calendar writes, no counts of weeks planned, nothing to
lose by skipping a week. Standard library only: the packaged app runs this
with ``-m week_plan`` from ``canvas_mcp/core`` like the study core.

CLI: ``python -m week_plan --user-root <root> --json run`` reads one JSON
request ``{"cmd": ..., "params": {...}}`` on stdin and prints one JSON reply.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = 1
PILES = ("needs_you", "changed", "fyi")
SOURCES = ("typed", "voice", "extension", "ask")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ID_RE = re.compile(r"^[A-Za-z0-9:_.\-]{1,128}$")
TITLE_MAX = 200
MAX_ITEMS = 2000


class PlanError(ValueError):
    """A request the student (or app) can fix; reported, never a traceback."""


# ------------------------------------------------------------------ paths


def plan_dir(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "plan"


def week_path(user_root: Path) -> Path:
    return plan_dir(user_root) / "week.json"


def items_path(user_root: Path) -> Path:
    return plan_dir(user_root) / "items.jsonl"


def piles_path(user_root: Path) -> Path:
    return Path(user_root) / "calibration" / "piles.json"


# ------------------------------------------------------------------ io


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback
    return raw if isinstance(raw, type(fallback)) else fallback


def _empty_state() -> dict[str, Any]:
    return {"schema": SCHEMA, "default_hours": None, "weeks": {}, "estimates": {}, "deferrals": {}, "pile_moves": {}}


def load_state(user_root: Path) -> dict[str, Any]:
    """Corrupt or missing files read as an empty plan (AI-eval F14: never crash the workspace)."""
    raw = _read_json(week_path(user_root), {})
    state = _empty_state()
    if raw.get("schema") == SCHEMA:
        for key in state:
            if key != "schema" and isinstance(raw.get(key), type(state[key]) if state[key] is not None else (int, float, type(None))):
                state[key] = raw[key]
    return state


def _save_state(user_root: Path, state: dict[str, Any]) -> None:
    _write_json(week_path(user_root), state)


def _all_items(user_root: Path) -> list[dict[str, Any]]:
    """Every captured row including removed ones; latest version of each id wins."""
    path = items_path(user_root)
    rows: dict[str, dict[str, Any]] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue  # one bad line never hides the rest
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            rows[row["id"]] = {**rows.get(row["id"], {}), **row}
    return list(rows.values())


def load_items(user_root: Path) -> list[dict[str, Any]]:
    """Captured rows the student hasn't removed (the file is append-only)."""
    return [r for r in _all_items(user_root) if not r.get("removed_at")][-MAX_ITEMS:]


def _append_item(user_root: Path, row: dict[str, Any]) -> None:
    path = items_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def load_piles(user_root: Path) -> dict[str, Any]:
    raw = _read_json(piles_path(user_root), {})
    courses = raw.get("courses") if isinstance(raw.get("courses"), dict) else {}
    return {"courses": {str(k): v for k, v in courses.items() if isinstance(v, dict)}}


# ------------------------------------------------------------------ validation


def _id(value: Any, field: str = "item_id") -> str:
    text = str(value or "")
    if not _ID_RE.match(text):
        raise PlanError(f"{field} must be a short id")
    return text


def _day(value: Any, field: str = "day") -> str:
    text = str(value or "")
    if not _DAY_RE.match(text):
        raise PlanError(f"{field} must look like 2026-10-14")
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        raise PlanError(f"{field} is not a real date") from exc
    return text


def _week(value: Any) -> str:
    text = _day(value, "week")
    if date.fromisoformat(text).weekday() != 0:
        raise PlanError("week must be the Monday that starts it")
    return text


def _title(value: Any) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        raise PlanError("title is required")
    return text[:TITLE_MAX]


# ------------------------------------------------------------------ commands


def set_hours(user_root: Path, week: str, hours: Any) -> dict[str, Any]:
    try:
        value = float(hours)
    except (TypeError, ValueError) as exc:
        raise PlanError("hours must be a number") from exc
    if not 0 <= value <= 112:
        raise PlanError("hours must be between 0 and 112")
    state = load_state(user_root)
    entry = state["weeks"].setdefault(_week(week), {})
    entry["hours"] = value
    state["default_hours"] = value
    _save_state(user_root, state)
    return state


def set_estimate(user_root: Path, item_id: str, minutes: Any) -> dict[str, Any]:
    state = load_state(user_root)
    key = _id(item_id)
    if minutes in (None, ""):
        state["estimates"].pop(key, None)
    else:
        try:
            value = int(minutes)
        except (TypeError, ValueError) as exc:
            raise PlanError("minutes must be a whole number") from exc
        if not 5 <= value <= 1440:
            raise PlanError("minutes must be between 5 and 1440")
        state["estimates"][key] = value
    _save_state(user_root, state)
    return state


def defer(user_root: Path, item_id: str, to: str) -> dict[str, Any]:
    state = load_state(user_root)
    state["deferrals"][_id(item_id)] = {"to": _day(to, "to"), "at": _now()}
    _save_state(user_root, state)
    return state


def undefer(user_root: Path, item_id: str) -> dict[str, Any]:
    state = load_state(user_root)
    state["deferrals"].pop(_id(item_id), None)
    _save_state(user_root, state)
    return state


def accept(user_root: Path, week: str, days: Any) -> dict[str, Any]:
    """The student said yes to a proposed order. It stays as accepted."""
    if not isinstance(days, dict) or len(days) > 500:
        raise PlanError("days must map item ids to days")
    clean = {_id(k): _day(v) for k, v in days.items()}
    state = load_state(user_root)
    entry = state["weeks"].setdefault(_week(week), {})
    entry["accepted"] = {"at": _now(), "days": clean}
    # An accepted day replaces any earlier deferral for the same item.
    for key in clean:
        state["deferrals"].pop(key, None)
    _save_state(user_root, state)
    return state


def unaccept(user_root: Path, week: str) -> dict[str, Any]:
    state = load_state(user_root)
    entry = state["weeks"].get(_week(week))
    if entry:
        entry.pop("accepted", None)
    _save_state(user_root, state)
    return state


def capture(user_root: Path, params: dict[str, Any]) -> dict[str, Any]:
    source = str(params.get("source") or "typed")
    if source not in SOURCES:
        raise PlanError(f"source must be one of {', '.join(SOURCES)}")
    due = params.get("due_at")
    day = params.get("day")
    row = {
        "id": f"cap-{uuid.uuid4().hex[:12]}",
        "title": _title(params.get("title")),
        "course": " ".join(str(params.get("course") or "").split())[:80] or None,
        "due_at": str(due) if due else None,
        "day": _day(day) if day else None,
        "source": source,
        "created_at": _now(),
    }
    if row["due_at"]:
        try:
            datetime.fromisoformat(str(row["due_at"]).replace("Z", "+00:00"))
        except ValueError as exc:
            raise PlanError("due_at must be an ISO date and time") from exc
    if len(load_items(user_root)) >= MAX_ITEMS:
        raise PlanError("the plan already holds the most rows it keeps; mark some done first")
    _append_item(user_root, row)
    return row


def _item_update(user_root: Path, item_id: str, **fields: Any) -> dict[str, Any]:
    key = _id(item_id)
    if not key.startswith("cap-") or not any(r["id"] == key for r in _all_items(user_root)):
        raise PlanError("only rows you added can be changed here")
    row = {"id": key, **fields}
    _append_item(user_root, row)
    return row


def move_pile(user_root: Path, params: dict[str, Any]) -> dict[str, Any]:
    pile = str(params.get("pile") or "")
    if pile not in PILES:
        raise PlanError(f"pile must be one of {', '.join(PILES)}")
    key = str(params.get("key") or "")[:200]
    if not key:
        raise PlanError("key is required")
    state = load_state(user_root)
    state["pile_moves"][key] = pile
    _save_state(user_root, state)
    if params.get("always"):
        course = " ".join(str(params.get("course") or "").split())[:80]
        kind = re.sub(r"[^a-z_]", "", str(params.get("kind") or ""))[:40]
        if not course or not kind:
            raise PlanError("always needs the course and the kind of change")
        piles = load_piles(user_root)
        piles["courses"].setdefault(course, {})[kind] = pile
        _write_json(piles_path(user_root), piles)
    return state


def snapshot(user_root: Path) -> dict[str, Any]:
    return {"ok": True, "state": load_state(user_root), "items": load_items(user_root), "piles": load_piles(user_root)}


def handle(user_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    cmd = str(request.get("cmd") or "")
    params = request.get("params") or {}
    if not isinstance(params, dict):
        raise PlanError("params must be an object")
    if cmd == "show":
        return snapshot(user_root)
    if cmd == "hours":
        set_hours(user_root, params.get("week"), params.get("hours"))
    elif cmd == "estimate":
        set_estimate(user_root, params.get("item_id"), params.get("minutes"))
    elif cmd == "defer":
        defer(user_root, params.get("item_id"), params.get("to"))
    elif cmd == "undefer":
        undefer(user_root, params.get("item_id"))
    elif cmd == "accept":
        accept(user_root, params.get("week"), params.get("days"))
    elif cmd == "unaccept":
        unaccept(user_root, params.get("week"))
    elif cmd == "capture":
        row = capture(user_root, params)
        return {**snapshot(user_root), "saved": row}
    elif cmd == "done":
        _item_update(user_root, params.get("item_id"), done_at=None if params.get("undo") else _now())
    elif cmd == "remove":
        _item_update(user_root, params.get("item_id"), removed_at=None if params.get("undo") else _now())
    elif cmd == "pile":
        move_pile(user_root, params)
    else:
        raise PlanError(f"unknown command {cmd!r}")
    return snapshot(user_root)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Student-owned week plan state")
    parser.add_argument("--user-root", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("mode", choices=("run",))
    args = parser.parse_args(argv)
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if not isinstance(request, dict):
            raise PlanError("request must be an object")
        reply = handle(args.user_root, request)
    except PlanError as exc:
        reply = {"ok": False, "error": str(exc)}
    except ValueError:
        reply = {"ok": False, "error": "request was not valid JSON"}
    print(json.dumps(reply, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
