"""Append-only academic outcomes. Not the actuator ledger and not a streak.

Learning events are delayed retrieval hits and corrected misses. Workflow
events are paths: a started micro-step or a student-marked commitment.
A failed append must not roll back a learn-item or focus write.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

LEARNING_KINDS = ("delayed_hit", "corrected_miss")
WORKFLOW_KINDS = ("micro_step_started", "commitment_started", "commitment_kept")
EVENT_KINDS = LEARNING_KINDS + WORKFLOW_KINDS
TRAIL_WINDOW_DAYS = 7
TRAIL_LINE = "You kept the chain of work alive this week."
GARDEN_NOTE = "A private record of decisions, not time studied and not mastery."


def outcomes_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "learn" / "outcomes.jsonl"


def _parse_iso(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def _event_day(row: dict[str, Any], user_root: Path) -> date | None:
    from .habit import local_today

    moment = _parse_iso(str(row.get("ts") or ""))
    if moment is None:
        return None
    return local_today(user_root, now=moment)


def read_events(user_root: Path) -> list[dict[str, Any]]:
    """Return well-formed rows. Malformed lines are skipped."""
    path = outcomes_path(user_root)
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "")
        quality = str(row.get("quality") or "")
        if kind not in EVENT_KINDS:
            continue
        if quality not in ("learning", "workflow"):
            continue
        rows.append(row)
    return rows


def append_event(
    user_root: Path,
    *,
    kind: str,
    quality: str,
    course: str = "",
    ref: str = "",
    label: str = "",
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Append one academic event. Returns None on any write failure."""
    if kind not in EVENT_KINDS or quality not in ("learning", "workflow"):
        return None
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    row = {
        "ts": moment.isoformat(),
        "kind": kind,
        "quality": quality,
        "course": (course or "").strip(),
        "ref": (ref or "").strip(),
        "label": (label or "").strip(),
    }
    try:
        path = outcomes_path(user_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    except OSError:
        return None
    return row


def record_delayed_hit(
    user_root: Path,
    *,
    prior_outcome: str | None,
    course: str,
    ref: str,
    label: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """One learning event for a newly applied delayed hit. Misses append nothing."""
    kind = "corrected_miss" if prior_outcome in ("miss", "partial") else "delayed_hit"
    return append_event(
        user_root,
        kind=kind,
        quality="learning",
        course=course,
        ref=ref,
        label=label,
        now=now,
    )


def record_micro_step(
    user_root: Path,
    *,
    label: str,
    on: date,
    course: str = "",
    ref: str = "",
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """One workflow path per school-local day. Same-day rewrite does not append."""
    cleaned = (label or "").strip()
    if not cleaned:
        return None
    from .habit import local_today

    for row in read_events(user_root):
        if row.get("kind") != "micro_step_started":
            continue
        if _event_day(row, user_root) == on:
            return None
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if local_today(user_root, now=moment) != on:
        moment = datetime(
            on.year,
            on.month,
            on.day,
            moment.hour,
            moment.minute,
            tzinfo=moment.tzinfo,
        )
    return append_event(
        user_root,
        kind="micro_step_started",
        quality="workflow",
        course=course,
        ref=ref,
        label=cleaned,
        now=moment,
    )


def _in_window(row: dict[str, Any], user_root: Path, today: date) -> bool:
    day = _event_day(row, user_root)
    if day is None:
        return False
    start = today - timedelta(days=TRAIL_WINDOW_DAYS - 1)
    return start <= day <= today


def _public_event(row: dict[str, Any]) -> dict[str, str]:
    return {
        "kind": str(row.get("kind") or ""),
        "course": str(row.get("course") or ""),
        "ref": str(row.get("ref") or ""),
        "label": str(row.get("label") or ""),
        "ts": str(row.get("ts") or ""),
    }


def trail_payload(
    user_root: Path,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Week of meaningful events. The chain line needs a learning event."""
    from .habit import local_today

    today = local_today(user_root, now=now)
    learning: list[dict[str, str]] = []
    workflow: list[dict[str, str]] = []
    for row in read_events(user_root):
        if not _in_window(row, user_root, today):
            continue
        public = _public_event(row)
        if row.get("quality") == "learning":
            learning.append(public)
        else:
            workflow.append(public)
    line = TRAIL_LINE if learning else ""
    return {"line": line, "learning": learning, "workflow": workflow}


def _checkpoint_dates(user_root: Path, today: date) -> dict[str, date]:
    """Earliest past checkpoint per course. Computed, not stored as a plant."""
    try:
        from .learn_loop import load_items
    except Exception:
        return {}
    today_rows: dict[str, date] = {}
    try:
        items = load_items(user_root)
    except Exception:
        return {}
    for item in items:
        if getattr(item, "kind", "") == "workflow":
            continue
        raw = getattr(item, "checkpoint_due", None)
        if not raw:
            continue
        try:
            due = date.fromisoformat(str(raw).strip()[:10])
        except ValueError:
            continue
        if due >= today:
            continue
        course = (getattr(item, "course", "") or "").strip() or "(unassigned)"
        prior = today_rows.get(course)
        if prior is None or due < prior:
            today_rows[course] = due
    return today_rows


def garden_payload(
    user_root: Path,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Course rows of decisions. Workflow is a path and cannot grow a plant."""
    from .habit import local_today

    today = local_today(user_root, now=now)
    buckets: dict[str, dict[str, Any]] = {}

    def row_for(course: str) -> dict[str, Any]:
        key = course.strip() or "(unassigned)"
        found = buckets.get(key)
        if found is None:
            found = {
                "course": key,
                "delayed_retrieval": 0,
                "corrected_miss": 0,
                "path": 0,
                "checkpoint_passed": False,
            }
            buckets[key] = found
        return found

    for event in read_events(user_root):
        course = str(event.get("course") or "")
        row = row_for(course)
        kind = event.get("kind")
        if kind == "delayed_hit":
            row["delayed_retrieval"] = int(row["delayed_retrieval"]) + 1
        elif kind == "corrected_miss":
            row["corrected_miss"] = int(row["corrected_miss"]) + 1
        elif kind in WORKFLOW_KINDS:
            row["path"] = int(row["path"]) + 1

    for course in _checkpoint_dates(user_root, today):
        row_for(course)["checkpoint_passed"] = True

    courses: list[dict[str, Any]] = []
    for course in sorted(buckets):
        row = buckets[course]
        bits: list[str] = []
        delayed = int(row["delayed_retrieval"])
        corrected = int(row["corrected_miss"])
        path = int(row["path"])
        if delayed:
            noun = "delayed retrieval" if delayed == 1 else "delayed retrievals"
            bits.append(f"{delayed} {noun}")
        if corrected:
            noun = "corrected miss" if corrected == 1 else "corrected misses"
            bits.append(f"{corrected} {noun}")
        if path:
            noun = "path" if path == 1 else "paths"
            bits.append(f"{path} {noun}")
        if row["checkpoint_passed"]:
            bits.append("checkpoint date passed")
        if not bits:
            continue
        row["line"] = ", ".join(bits)
        courses.append(row)

    if not courses:
        return {"note": "", "courses": []}
    return {"note": GARDEN_NOTE, "courses": courses}


def render_trail(
    user_root: Path,
    *,
    now: datetime | None = None,
) -> str:
    trail = trail_payload(user_root, now=now)
    if not trail["line"] and not trail["learning"] and not trail["workflow"]:
        return ""
    lines = ["## Trail", ""]
    if trail["line"]:
        lines.append(trail["line"])
        lines.append("A path is not a delayed hit. Do not invent a check to feed this line.")
        lines.append("")
    if trail["learning"]:
        lines.append("Learning")
        for event in trail["learning"]:
            lines.append(f"- {event['course']} | {event['label']}".rstrip())
        lines.append("")
    if trail["workflow"]:
        lines.append("Paths")
        for event in trail["workflow"]:
            lines.append(f"- {event['label']}".rstrip())
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
