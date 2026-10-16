"""Deterministic teach-hint for one briefing turn.

Computes how to *start* the Do-first item from the learning-profile start bias,
course ``prior_knowledge``, a due retrieval, and a content-type concept key.
``practice_format`` only changes order (example then retrieve, or retrieve
first). It never skips retrieval or the scheduled check.

Not a forgetting-curve fit. Durable claims live in ``learn_loop``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

from .dates import parse_day
from .learning_profile import load_learning_profile, record_signal
from .topics import match_concept_key

TEACHING_SKILL_IDS = frozenset(
    {
        "student-task-brief",
        "canvas-week-plan",
        "student-course-arc",
    }
)

PRIOR_VALUES = ("novice", "developing", "experienced")
FORMAT_VALUES = ("worked_example", "retrieval")
NUDGE_KIND = "mid_window_self_check"
SPACING_GAP_DAYS = 5

_PRIOR_RE = re.compile(
    r"(?im)^\s*prior_knowledge:\s*(novice|developing|experienced)\s*$"
)
_OPEN_WITH_RE = re.compile(r"(?im)^Open with:\s*(.+?)\s*$")
_OBSTACLE_RE = re.compile(r"(?im)^Obstacle:\s*(.+?)\s*$")
_FORMAT_RE = re.compile(r"(?im)^Format:\s*(worked_example|retrieval)\s*$")
_ITEM_RE = re.compile(r"^\s*(\d+)\.\s+(.+?)\s*$")

# Longer phrases first so "quiz me instead" wins over "quiz me".
_REPLY_PHRASES: tuple[tuple[str, str], ...] = (
    ("quiz me instead", "retrieval"),
    ("quiz me", "retrieval"),
    ("walk me through", "worked_example"),
    ("just show me", "worked_example"),
)

_SKIP_DIAGRAM = (
    "reading",
    "pre-reading",
    "pre reading",
    "discussion",
    "signup",
    "sign up",
    "dinner",
    "workshop",
    "calendar",
)

_INTERLEAVE_MARKERS = ("problem set", "problem-set", "pset", "mixed problems")


@dataclass(frozen=True)
class TeachHint:
    do_first: str
    format: str
    because: str
    spacing: str
    diagram: str
    interleave: str
    open_with: str | None = None

    def render(self) -> str:
        lines = [
            "Teach-hint",
            f"- do_first: {self.do_first}",
            f"- format: {self.format}",
            f"- because: {self.because}",
            "- retrieval: required after the attempt; do not skip the scheduled check",
            "- fluency: ease is a weak signal; do not retire the item",
            f"- spacing: {self.spacing}",
            f"- diagram: {self.diagram}",
            f"- interleave: {self.interleave}",
        ]
        return "\n".join(lines)


@dataclass(frozen=True)
class Nudge:
    assignment_id: str
    course_code: str
    prompt: str
    last_briefed_at: str
    next_nudge_at: str
    kind: str = NUDGE_KIND
    exam_due: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "assignment_id": self.assignment_id,
            "course_code": self.course_code,
            "prompt": self.prompt,
            "last_briefed_at": self.last_briefed_at,
            "next_nudge_at": self.next_nudge_at,
            "kind": self.kind,
        }
        if self.exam_due:
            data["exam_due"] = self.exam_due
        return data


def is_teaching_skill(skill_id: str) -> bool:
    return skill_id in TEACHING_SKILL_IDS


def format_reply(trigger: str) -> str | None:
    """Map an explicit reformat request to a practice_format value.

    Returns None when the student did not ask to change framing. Silence is
    not a signal.
    """
    blob = (trigger or "").lower()
    for phrase, value in _REPLY_PHRASES:
        if phrase in blob:
            return value
    return None


def record_format_reply(user_root: Path, trigger: str) -> str | None:
    """Record an explicit quiz-me / walk-me-through reply. No-op otherwise."""
    value = format_reply(trigger)
    if value is None:
        return None
    record_signal(user_root, "practice_format", value, delta=1)
    return value


def parse_prior_knowledge(text: str | None) -> str | None:
    if not text:
        return None
    match = _PRIOR_RE.search(text)
    if not match:
        return None
    return match.group(1).lower()


def _norm_course_code(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def course_file(user_root: Path, course_code: str) -> Path | None:
    """Match ``inbox/courses/{stem}.md`` by normalized course code."""
    courses = Path(user_root) / "inbox" / "courses"
    if not courses.is_dir():
        return None
    needle = _norm_course_code(course_code)
    if not needle:
        return None
    for path in sorted(courses.glob("*.md")):
        if path.name.startswith("_"):
            continue
        if _norm_course_code(path.stem) == needle:
            return path
    return None


def write_prior_knowledge(user_root: Path, course_code: str, value: str) -> Path:
    """Set the course ``prior_knowledge`` line. Does not invent a catalog.

    Missing means novice at teach time, but this write records an explicit
    seed (syllabus, early grades, or an ask) — never silence.
    """
    if value not in PRIOR_VALUES:
        raise ValueError(f"prior_knowledge must be one of {PRIOR_VALUES}")
    path = course_file(user_root, course_code)
    if path is None:
        stem = _norm_course_code(course_code).upper() or "COURSE"
        path = Path(user_root) / "inbox" / "courses" / f"{stem}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"prior_knowledge: {value}\n", encoding="utf-8")
        return path
    text = path.read_text(encoding="utf-8", errors="replace")
    line = f"prior_knowledge: {value}"
    if _PRIOR_RE.search(text):
        text = _PRIOR_RE.sub(line, text, count=1)
    else:
        text = f"{line}\n{text}" if text else f"{line}\n"
    path.write_text(text, encoding="utf-8")
    return path


def resolve_format(
    global_format: str,
    prior_knowledge: str | None,
    *,
    reply: str | None = None,
) -> tuple[str, str]:
    """Return (start format, because).

    ``global_format`` is a start bias only. Missing prior is treated as novice
    (example, then retrieve). An explicit reply sets this turn's start order
    and never means the later retrieval is optional.
    """
    if reply in FORMAT_VALUES:
        if reply == "retrieval":
            return reply, "student asked to quiz (start bias; retrieval still required)"
        return reply, "student asked for a walkthrough (then retrieve)"
    if prior_knowledge in (None, "novice"):
        if prior_knowledge is None:
            return "worked_example", (
                "missing prior_knowledge treated as novice (example then retrieve)"
            )
        if global_format == "retrieval":
            return "worked_example", (
                "course prior_knowledge=novice overrides global retrieval"
            )
        return "worked_example", "course prior_knowledge=novice"
    if prior_knowledge == "experienced":
        return "retrieval", "course prior_knowledge=experienced prefers retrieval"
    return global_format, f"start bias (developing uses global practice_format={global_format})"


def nudge_path(user_root: Path) -> Path:
    return Path(user_root) / "calibration" / "revisit-nudges.yaml"


def focus_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "focus.md"


def _parse_iso(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        day = _parse_date(raw)
        if day is None:
            return None
        return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_date(value: str | None, default_year: int | None = None) -> date | None:
    return parse_day(value, default_year=default_year)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def load_nudges(user_root: Path) -> list[Nudge]:
    path = nudge_path(user_root)
    if not path.is_file():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    if not isinstance(raw, list):
        return []
    nudges: list[Nudge] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        nudges.append(
            Nudge(
                assignment_id=str(item.get("assignment_id") or ""),
                course_code=str(item.get("course_code") or ""),
                prompt=prompt,
                last_briefed_at=str(item.get("last_briefed_at") or ""),
                next_nudge_at=str(item.get("next_nudge_at") or ""),
                kind=str(item.get("kind") or NUDGE_KIND),
                exam_due=str(item["exam_due"]) if item.get("exam_due") else None,
            )
        )
    return nudges


def _write_nudges(user_root: Path, nudges: list[Nudge]) -> Path:
    path = nudge_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [nudge.to_dict() for nudge in nudges[:1]]
    path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return path


def due_nudge(user_root: Path, *, now: datetime | None = None) -> Nudge | None:
    """The one live nudge whose next_nudge_at has arrived and whose exam has not."""
    moment = now or _utcnow()
    today = moment.date()
    live: list[Nudge] = []
    for nudge in load_nudges(user_root):
        exam = _parse_date(nudge.exam_due)
        if exam is not None and exam < today:
            continue
        nxt = _parse_iso(nudge.next_nudge_at)
        if nxt is None or nxt > moment:
            continue
        live.append(nudge)
    return live[0] if live else None


def write_nudge(
    user_root: Path,
    *,
    assignment_id: str,
    course_code: str,
    prompt: str,
    exam_due: str,
    now: datetime | None = None,
) -> Path | None:
    """Store at most one mid-window self-check. Refuses if the exam is within 5 days."""
    moment = now or _utcnow()
    exam = _parse_date(exam_due)
    if exam is None:
        raise ValueError("exam_due must be YYYY-MM-DD")
    gap = (exam - moment.date()).days
    if gap <= SPACING_GAP_DAYS:
        return None
    half = max(1, gap // 2)
    nxt = moment + timedelta(days=half)
    nudge = Nudge(
        assignment_id=assignment_id.strip(),
        course_code=course_code.strip(),
        prompt=prompt.strip(),
        last_briefed_at=moment.isoformat(),
        next_nudge_at=nxt.isoformat(),
        exam_due=exam.isoformat(),
    )
    return _write_nudges(user_root, [nudge])


def render_focus_md(
    *,
    open_with: str,
    format: str,
    items: list[str],
    updated: date | None = None,
    obstacle: str | None = None,
) -> str:
    if format not in FORMAT_VALUES:
        raise ValueError(f"format must be one of {FORMAT_VALUES}")
    day = (updated or _utcnow().date()).isoformat()
    lines = [
        f"Updated: {day}",
        f"Open with: {open_with.strip()}",
        f"Format: {format}",
    ]
    cleaned = (obstacle or "").strip()
    if cleaned:
        lines.append(f"Obstacle: {cleaned}")
    lines.append("")
    for index, item in enumerate(items[:3], start=1):
        lines.append(f"{index}. {item.strip()}")
    return "\n".join(lines) + "\n"


def parse_focus_obstacle(text: str) -> str | None:
    match = _OBSTACLE_RE.search(text or "")
    if not match:
        return None
    return match.group(1).strip() or None


def write_focus(
    user_root: Path,
    *,
    open_with: str,
    format: str,
    items: list[str],
    updated: date | None = None,
    obstacle: str | None = None,
    clear_obstacle: bool = False,
    now: datetime | None = None,
) -> Path:
    """Write the practice handoff. Omitted obstacle is kept; never invented."""
    path = focus_path(user_root)
    kept = obstacle
    if obstacle is None and not clear_obstacle and path.is_file():
        kept = parse_focus_obstacle(path.read_text(encoding="utf-8", errors="replace"))
    if clear_obstacle:
        kept = None
    from .habit import local_today, record_brief_day

    # One school-local day for the file stamp and the counter. UTC must not
    # count a brief the school day has not started.
    day = updated or local_today(user_root, now=now)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        render_focus_md(
            open_with=open_with,
            format=format,
            items=items,
            updated=day,
            obstacle=kept,
        ),
        encoding="utf-8",
    )

    # The written brief is the habit. Routing or opening the dock does not count.
    record_brief_day(user_root, now=now, on=day)
    try:
        from .progress import record_micro_step

        record_micro_step(
            user_root,
            label=open_with.strip(),
            on=day,
            now=now,
        )
    except (OSError, ValueError, TypeError):
        # Progress is an optional side effect; keep the brief usable if the
        # local progress store is unavailable or malformed.
        return path
    return path


def parse_focus_open_with(text: str) -> str | None:
    match = _OPEN_WITH_RE.search(text or "")
    if not match:
        return None
    return match.group(1).strip() or None


def _parse_md_table(text: str) -> list[dict[str, str]]:
    headers: list[str] | None = None
    rows: list[dict[str, str]] = []
    for line in text.split("\n"):  # "\n" only: same rule as prompt_assembly._parse_md_table (F1)
        if not line.strip().startswith("|"):
            headers = None
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or all(set(cell) <= set("-: ") for cell in cells):
            continue
        if headers is None:
            headers = [cell.lower() for cell in cells]
            continue
        if len(cells) < len(headers):
            continue
        rows.append({headers[i]: cells[i] for i in range(len(headers))})
    return rows


def _row_label(row: dict[str, str]) -> str:
    course = (row.get("course") or "").strip()
    assignment = (row.get("assignment") or row.get("name") or "").strip()
    if course and assignment:
        return f"{course} — {assignment}"
    return assignment or course or "(none)"


def _do_first_row(rows: list[dict[str, str]], default_year: int | None = None) -> dict[str, str] | None:
    """Choose the soonest meaningful open item, independent of table order."""
    dated: list[tuple[date, int, dict[str, str]]] = []
    for row in rows:
        due = _parse_date(row.get("due"), default_year)
        if due is None:
            continue
        try:
            points = int(float(str(row.get("points") or "0").replace(",", "")))
        except ValueError:
            points = 0
        dated.append((due, -points, row))
    meaningful = [item for item in dated if item[1] <= -10]
    candidates = meaningful or dated
    if candidates:
        candidates.sort(key=lambda item: (item[0], item[1]))
        return candidates[0][2]
    return rows[0] if rows else None


def _is_quiz(row: dict[str, str]) -> bool:
    blob = " ".join(
        (
            row.get("type") or "",
            row.get("notes") or "",
            row.get("outcome") or "",
            row.get("assignment") or "",
            row.get("name") or "",
        )
    ).lower()
    return "quiz" in blob or "exam" in blob or "proctored" in blob


def _skip_diagram(row: dict[str, str]) -> bool:
    blob = " ".join(
        (
            row.get("type") or "",
            row.get("notes") or "",
            row.get("outcome") or "",
            row.get("assignment") or "",
            row.get("name") or "",
        )
    ).lower()
    return any(token in blob for token in _SKIP_DIAGRAM)


def _interleave(row: dict[str, str] | None) -> str:
    if row is None:
        return "no"
    title = (row.get("assignment") or row.get("name") or "").lower()
    if any(marker in title for marker in _INTERLEAVE_MARKERS):
        return "yes"
    return "no"


def _soonest_quiz(rows: list[dict[str, str]], default_year: int | None = None) -> dict[str, str] | None:
    dated: list[tuple[date, dict[str, str]]] = []
    undated: list[dict[str, str]] = []
    for row in rows:
        if not _is_quiz(row):
            continue
        due = _parse_date(row.get("due"), default_year)
        if due is None:
            undated.append(row)
        else:
            dated.append((due, row))
    if dated:
        dated.sort(key=lambda item: item[0])
        return dated[0][1]
    return undated[0] if undated else None


def _spacing_line(
    rows: list[dict[str, str]],
    nudge: Nudge | None,
    *,
    now: datetime,
    default_year: int | None = None,
    due_claims: list[str] | None = None,
) -> tuple[str, str | None]:
    if due_claims:
        first = due_claims[0]
        return f'surface due review "{first}" before the new Top-3', first
    if nudge is not None:
        return f'surface nudge "{nudge.prompt}" before the new Top-3', nudge.prompt
    quiz = _soonest_quiz(rows, default_year)
    if quiz is None:
        return "none", None
    due = _parse_date(quiz.get("due"), default_year)
    if due is None:
        return "none", None
    gap = (due - now.date()).days
    if gap <= SPACING_GAP_DAYS:
        return "none", None
    label = _row_label(quiz)
    return (
        f"schedule mid-window self-check for {label} due {due.isoformat()} (>{SPACING_GAP_DAYS}d)",
        None,
    )


def _course_text(user_root: Path, trigger: str, catalog_md: str | None) -> str:
    parts = [catalog_md or ""]
    try:
        from .prompt_assembly import load_catalog_for_trigger
    except Exception:
        return catalog_md or ""
    loaded = load_catalog_for_trigger(user_root, trigger)
    if loaded:
        parts.append(loaded)
    return "\n".join(parts)


def build_teach_hint(
    user_root: Path,
    trigger: str,
    week_md: str,
    *,
    catalog_md: str | None = None,
    now: datetime | None = None,
) -> TeachHint:
    moment = now or _utcnow()
    profile = load_learning_profile(user_root)
    prior = parse_prior_knowledge(_course_text(user_root, trigger, catalog_md))
    reply = format_reply(trigger)
    fmt, because = resolve_format(profile.practice_format, prior, reply=reply)

    rows = _parse_md_table(week_md)
    updated = re.search(r"(?m)^Updated:\s*(\d{4})-", week_md or "")
    default_year = int(updated.group(1)) if updated else None
    do_row = _do_first_row(rows, default_year)
    do_first = _row_label(do_row) if do_row else "(none)"
    from .learn_loop import due_reviews, why_due

    due = due_reviews(user_root, now=moment)
    if due and due[0].start_with_example and reply not in FORMAT_VALUES:
        fmt = "worked_example"
        because = why_due(due[0], moment)
    nudge = due_nudge(user_root, now=moment)
    spacing, open_with = _spacing_line(
        rows,
        nudge,
        now=moment,
        default_year=default_year,
        due_claims=[item.claim for item in due],
    )

    diagram = "no"
    if do_row is not None and not _skip_diagram(do_row):
        key = match_concept_key(_row_label(do_row))
        if key:
            diagram = (
                f"{key} — attach student-concept-visual as the encode step, "
                "then the student labels or regenerates the relation from memory"
            )

    return TeachHint(
        do_first=do_first,
        format=fmt,
        because=because,
        spacing=spacing,
        diagram=diagram,
        interleave=_interleave(do_row),
        open_with=open_with,
    )


def render_teach_hint(
    user_root: Path,
    trigger: str,
    week_md: str,
    *,
    catalog_md: str | None = None,
    now: datetime | None = None,
) -> str:
    hint = build_teach_hint(
        user_root, trigger, week_md, catalog_md=catalog_md, now=now
    )
    parts: list[str] = []
    if hint.open_with:
        parts.append(f"Open with: {hint.open_with}")
    parts.append(hint.render())
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    """CLI for skills: write the focus handoff or record a format reply."""
    import argparse

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(description="Teaching-loop handoff helpers")
    parser.add_argument("--user-root", type=Path, default=None)
    sub = parser.add_subparsers(dest="cmd", required=True)

    reply = sub.add_parser("reply", help="Record quiz-me / walk-me-through")
    reply.add_argument("--text", required=True)

    focus = sub.add_parser("write-focus", help="Write inbox/focus.md")
    focus.add_argument("--open-with", required=True)
    focus.add_argument("--format", choices=FORMAT_VALUES, required=True)
    focus.add_argument("--item", action="append", default=[], dest="items")
    focus.add_argument(
        "--obstacle",
        default=None,
        help="Student-authored if-then obstacle. Omit to keep the previous line.",
    )
    focus.add_argument(
        "--clear-obstacle",
        action="store_true",
        help="Drop a stored obstacle. Do not infer one.",
    )

    prior = sub.add_parser("set-prior", help="Write course prior_knowledge")
    prior.add_argument("--course", required=True)
    prior.add_argument("--value", choices=PRIOR_VALUES, required=True)

    nudge = sub.add_parser("write-nudge", help="Store one mid-window self-check")
    nudge.add_argument("--assignment-id", default="")
    nudge.add_argument("--course-code", default="")
    nudge.add_argument("--prompt", required=True)
    nudge.add_argument("--exam-due", required=True)

    args = parser.parse_args(argv)
    root = args.user_root or resolve_user_root("dev", create=True)

    if args.cmd == "reply":
        value = record_format_reply(root, args.text)
        if value is None:
            print("no-reply")
            return 0
        print(value)
        return 0
    if args.cmd == "set-prior":
        path: Path | None = write_prior_knowledge(root, args.course, args.value)
        print(path)
        return 0
    if args.cmd == "write-focus":
        path = write_focus(
            root,
            open_with=args.open_with,
            format=args.format,
            items=args.items,
            obstacle=args.obstacle,
            clear_obstacle=args.clear_obstacle,
        )
        print(path)
        return 0
    nudge_path: Path | None = write_nudge(
        root,
        assignment_id=args.assignment_id,
        course_code=args.course_code,
        prompt=args.prompt,
        exam_due=args.exam_due,
    )
    if nudge_path is None:
        print("skipped")
        return 0
    print(nudge_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
