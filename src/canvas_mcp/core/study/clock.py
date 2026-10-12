"""Zone-aware calendar arithmetic, exam cutoffs, and clock trust.

All instants are UTC. Calendar days are added in the student's IANA zone at
the same wall time; an ambiguous wall time picks the later fold and a
nonexistent one normalizes forward through the gap (spec §3.2).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .model import CLOCK_TOLERANCE_SECONDS, GAP_LADDER, MAX_GAP_DAYS, StudyError

UTC = timezone.utc


def zone_of(name: str | None) -> ZoneInfo | None:
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def calendar_add(moment: datetime, days: int, zone_name: str) -> datetime:
    if days <= 0:
        raise StudyError("validation", "calendar_add needs a positive day count")
    zone = zone_of(zone_name) or UTC
    local = moment.astimezone(zone)
    naive = local.replace(tzinfo=None) + timedelta(days=days)
    # fold=1 selects the later interpretation of an ambiguous (fall-back) wall time.
    candidate = naive.replace(tzinfo=zone, fold=1)
    round_trip = candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None)
    if round_trip != naive:
        # Nonexistent wall time (spring-forward gap): fold=1 would land *before*
        # the gap; fold=0 applies the pre-transition offset, i.e. forward through it.
        candidate = naive.replace(tzinfo=zone, fold=0)
    return candidate.astimezone(UTC)


def local_date(moment: datetime, zone_name: str) -> date:
    zone = zone_of(zone_name) or UTC
    return moment.astimezone(zone).date()


def expand_gap(gap_days: int) -> int:
    if not isinstance(gap_days, int) or gap_days < 1 or gap_days > MAX_GAP_DAYS:
        raise StudyError("validation", f"gap_days out of range: {gap_days!r}")
    for rung in GAP_LADDER:
        if rung > gap_days:
            return rung
    return MAX_GAP_DAYS


@dataclass(frozen=True)
class ExamWindow:
    """Planning view of one exam record. ``cutoff`` is None when no cap applies."""

    exam_id: str
    value: str
    cutoff: datetime | None
    ends_at: datetime | None  # instant after which the exam is in the past
    starts_at: datetime | None = None
    source: str = "unknown"
    confidence: str = "unknown"

    def is_past(self, now: datetime) -> bool:
        return self.ends_at is not None and self.ends_at <= now


def exam_window(raw: dict[str, Any]) -> ExamWindow:
    """Return a conservative pre-exam window.

    A real start time is the hard cutoff. A due-only Canvas record is treated
    as an end time with a low-confidence one-hour safety buffer; it is never
    presented as a known exam start.
    """
    exam_id = str(raw.get("id") or "")
    value = str(raw.get("value") or "unknown")
    zone = zone_of(str(raw.get("zone") or ""))
    if value in ("known_instant", "window"):
        starts_raw = raw.get("starts_at")
        ends_raw = raw.get("ends_at") or raw.get("at")
        start = None
        end = None
        try:
            if starts_raw:
                start = datetime.fromisoformat(str(starts_raw).replace("Z", "+00:00"))
            if ends_raw:
                end = datetime.fromisoformat(str(ends_raw).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return ExamWindow(exam_id, "unknown", None, None)
        if start is not None and start.tzinfo is None:
            start = start.replace(tzinfo=zone) if zone else None
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=zone) if zone else None
        if start is None and end is None:
            return ExamWindow(exam_id, "unknown", None, None)
        if start is not None:
            start = start.astimezone(UTC)
        if end is not None:
            end = end.astimezone(UTC)
        if start is not None:
            cutoff = start
            if end is None:
                end = start
        else:
            assert end is not None  # both-None returned above
            cutoff = end - timedelta(hours=1)
        return ExamWindow(exam_id, value, cutoff, end, starts_at=start,
                          source=str(raw.get("source") or "unknown"),
                          confidence=str(raw.get("confidence") or "unknown"))
    if value == "date_only":
        if zone is None:
            return ExamWindow(exam_id, "unknown", None, None)
        try:
            day = date.fromisoformat(str(raw.get("date")))
        except (TypeError, ValueError):
            return ExamWindow(exam_id, "unknown", None, None)
        start = datetime(day.year, day.month, day.day, tzinfo=zone).astimezone(UTC)
        end = calendar_add(start, 1, str(raw.get("zone")))
        return ExamWindow(exam_id, value, start - timedelta(hours=1), end, starts_at=start,
                          source=str(raw.get("source") or "unknown"),
                          confidence=str(raw.get("confidence") or "unknown"))
    return ExamWindow(exam_id, value if value in ("cancelled", "unknown") else "unknown", None, None)


def nearest_future_exam(
    exams: list[dict[str, Any]],
    *,
    course: str | None,
    objective_id: str | None,
    now: datetime,
) -> tuple[dict[str, Any], ExamWindow] | None:
    """Nearest future exam whose scope matches; ties by exam id. Cancelled/unknown excluded."""
    candidates: list[tuple[datetime, str, dict[str, Any], ExamWindow]] = []
    for raw in exams:
        if course and raw.get("course") and raw.get("course") != course:
            continue
        scope = raw.get("objective_scope") or []
        if objective_id and scope and objective_id not in scope:
            continue
        window = exam_window(raw)
        if window.value not in ("known_instant", "date_only"):
            continue
        if window.ends_at is None or window.is_past(now):
            continue
        candidates.append((window.ends_at, window.exam_id, raw, window))
    if not candidates:
        return None
    candidates.sort(key=lambda row: (row[0], row[1]))
    _, _, raw, window = candidates[0]
    return raw, window


def scope_has_unknown_exam(
    exams: list[dict[str, Any]], *, course: str | None, objective_id: str | None
) -> bool:
    for raw in exams:
        if course and raw.get("course") and raw.get("course") != course:
            continue
        scope = raw.get("objective_scope") or []
        if objective_id and scope and objective_id not in scope:
            continue
        if exam_window(raw).value == "unknown":
            return True
    return False


# --- clock trust -----------------------------------------------------------


def clock_state_path(user_root: Path) -> Path:
    return user_root / "study" / "clock.json"


def _sleep_aware_monotonic() -> float:
    """A monotonic clock that keeps counting while the machine sleeps.

    ``time.monotonic()`` on macOS (mach_absolute_time) pauses during sleep, so
    a laptop closed overnight would look like a wall-clock jump. CLOCK_MONOTONIC
    on Darwin and CLOCK_BOOTTIME on Linux include sleep.
    """
    for name in ("CLOCK_BOOTTIME", "CLOCK_MONOTONIC"):
        clock_id = getattr(time, name, None)
        if clock_id is not None:
            try:
                return time.clock_gettime(clock_id)
            except (OSError, ValueError):
                continue
    return time.monotonic()


def check_clock(user_root: Path, now: datetime | None = None) -> tuple[datetime, str, str]:
    """Return (now, status, note). ``status`` is ``trusted`` or ``uncertain``.

    Within one boot, wall-clock elapsed is compared with sleep-aware monotonic
    elapsed since the previous invocation. Across reboots the check cannot run;
    the clock is then labeled trusted-but-unverified (status ``trusted``).
    The sample is always refreshed, so an anomaly marks this invocation only
    and does not latch forever (a fixed clock is trusted again next time).
    Passing ``now`` (tests) skips the check.
    """
    if now is not None:
        return now, "trusted", "injected"
    wall = datetime.now(UTC)
    mono = _sleep_aware_monotonic()
    path = clock_state_path(user_root)
    status, note = "trusted", "no prior sample"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        prev_wall = datetime.fromisoformat(str(raw["wall"]))
        prev_mono = float(raw["mono"])
        if mono >= prev_mono:
            expected = prev_wall + timedelta(seconds=mono - prev_mono)
            drift = abs((wall - expected).total_seconds())
            if drift > CLOCK_TOLERANCE_SECONDS:
                status, note = "uncertain", f"wall drifted {int(drift)}s from monotonic elapsed"
            else:
                note = "monotonic agrees"
        else:
            note = "monotonic reset (reboot); unverified"
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"wall": wall.isoformat(), "mono": mono}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass
    return wall, status, note
