"""Brief-day counter. Counts a written brief, not an app open.

A day increments only when ``write_focus`` succeeds. Missed days are not
announced and are not decremented by a timer — a gap becomes 1 only on the
next successful brief. The stored count is exposure only. Product copy is a
brief-continuity cue, not a learning streak, and never shames a broken run.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml


def habit_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "habit.yaml"


def _parse_day(value: str | None) -> date | None:
    if not value or not str(value).strip():
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def _school_timezone_name(user_root: Path | None) -> str | None:
    slug = os.environ.get("SCHOOL_SLUG", "").strip()
    if not slug and user_root is not None:
        path = Path(user_root) / "school_slug"
        if path.is_file():
            slug = path.read_text(encoding="utf-8", errors="replace").strip()
    if not slug:
        return None
    try:
        from .tenants import load_school

        name = load_school(slug).timezone.strip()
    except (FileNotFoundError, OSError, ValueError, KeyError):
        return None
    return name or None


def brief_timezone(user_root: Path | None = None) -> tzinfo:
    """School-local day boundary. TIMEZONE wins when set; else tenant yaml."""
    from .dates import _output_tz

    if os.environ.get("TIMEZONE", "").strip():
        return _output_tz()
    name = _school_timezone_name(user_root)
    if name:
        if name.upper() == "UTC":
            return timezone.utc
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError:
            return timezone.utc
    return _output_tz()


def local_today(
    user_root: Path | None = None,
    *,
    now: datetime | None = None,
    tz: Any | None = None,
) -> date:
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    zone = tz or brief_timezone(user_root)
    return moment.astimezone(zone).date()


def _load_raw(user_root: Path) -> dict[str, Any]:
    path = habit_path(user_root)
    if not path.is_file():
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except yaml.YAMLError:
        return {}
    return raw if isinstance(raw, dict) else {}


def _write(user_root: Path, last_brief_date: date, streak: int) -> None:
    path = habit_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_brief_date": last_brief_date.isoformat(),
        "streak": int(streak),
    }
    path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def render_streak_line(
    *,
    streak: int,
    last_brief_date: str | None,
    today: date,
) -> str:
    """Quiet dock/brief line. Empty when there is nothing honest to say.

    The count stays in the JSON payload. This line never names it, so it
    cannot be read as a learning streak or a run to protect.
    """
    count = int(streak or 0)
    last = _parse_day(last_brief_date)
    if count <= 0 or last is None:
        return ""
    if last == today:
        return "Brief continuity: written today"
    if last == today - timedelta(days=1):
        return "Brief continuity: yesterday written"
    return ""


def streak_payload(
    user_root: Path,
    *,
    now: datetime | None = None,
    tz: Any | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Read the counter. Does not reset a missed day."""
    day = today or local_today(user_root, now=now, tz=tz)
    raw = _load_raw(user_root)
    last = str(raw["last_brief_date"]) if raw.get("last_brief_date") else None
    last_day = _parse_day(last)
    try:
        streak = int(raw.get("streak") or 0)
    except (TypeError, ValueError):
        streak = 0
    if streak < 0:
        streak = 0
    line = render_streak_line(streak=streak, last_brief_date=last, today=day)
    return {
        "streak": streak,
        "last_brief_date": last,
        "briefed_today": last_day == day,
        "line": line,
    }


def record_brief_day(
    user_root: Path,
    *,
    now: datetime | None = None,
    on: date | None = None,
    tz: Any | None = None,
) -> dict[str, Any]:
    """Count this local day once. Same day is a no-op; a gap starts at 1."""
    today = on or local_today(user_root, now=now, tz=tz)
    raw = _load_raw(user_root)
    last = _parse_day(str(raw["last_brief_date"]) if raw.get("last_brief_date") else None)
    try:
        streak = int(raw.get("streak") or 0)
    except (TypeError, ValueError):
        streak = 0

    if last == today:
        return streak_payload(user_root, now=now, tz=tz, today=today)

    if last == today - timedelta(days=1) and streak > 0:
        streak += 1
    else:
        streak = 1
    _write(user_root, today, streak)
    return streak_payload(user_root, now=now, tz=tz, today=today)


def main(argv: list[str] | None = None) -> int:
    """CLI for the dock: print the current brief-streak line."""
    import argparse

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(description="Brief-day streak")
    parser.add_argument("--user-root", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show", help="Print the current streak (does not increment)")

    args = parser.parse_args(argv)
    root = args.user_root or resolve_user_root("dev", create=True)
    payload = streak_payload(root)
    if args.json:
        print(json.dumps(payload))
        return 0
    if payload["line"]:
        print(payload["line"])
    else:
        print("(none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
