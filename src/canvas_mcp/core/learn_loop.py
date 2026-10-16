"""Exam-relative retrieval loop — teachable claims, not a flashcard deck.

Canvas work stays on the due-list. This store holds only claims that must be
retrievable later (concepts, confusable problem types, procedural attempts,
arbitrary lists). Workflow chores never become items.

Spacing is expanding and capped by the checkpoint date (Cepeda: the useful
gap grows with how long the claim must be remembered). It is not SM-2/FSRS:
we do not fit a forgetting curve from a handful of events.

Stability advances only on a **delayed** hit — a same-session "I got it" and
``confidence_claimed`` are recorded and ignored as evidence.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

from .dates import parse_day
from .untrusted_content import fence_untrusted_inline

KIND_VALUES = ("declarative", "confusable", "procedural", "list", "workflow")
TEACHABLE_KINDS = ("declarative", "confusable", "procedural", "list")
OUTCOME_VALUES = ("miss", "partial", "hit", "skipped")
STABILITY_VALUES = ("fragile", "holding", "durable")
# Inspectable evidence, not a score. Order is the missing-rung ladder.
RUNG_VALUES = ("encountered", "attempted", "delayed_hit", "durable_near_checkpoint")
DUE_REVIEW_LIMIT = 2
PRE_EXAM_DAYS = 2
NEAR_CHECKPOINT_DAYS = 3

_LIST_MARKERS = ("vocab", "vocabulary", "names and faces", "name list")
_CONFUSABLE_MARKERS = (
    "problem set",
    "problem-set",
    "pset",
    "mixed problems",
    "chain rule",
    "derivative",
)

# A closed-book claim asserts a fact to retrieve, not a study goal to pursue.
# These prefixes name the goal, not the fact, so no retrieval attempt can ever
# "hit" them — skip that instead of feeding it into the ladder.
_VAGUE_CLAIM_PREFIXES = (
    "understand",
    "know",
    "know about",
    "learn",
    "learn about",
    "review",
    "study",
    "remember",
    "be familiar with",
    "get comfortable with",
    "master",
    "go over",
)
MIN_CLAIM_WORDS = 4


@dataclass
class LearnItem:
    id: str
    course: str
    claim: str
    kind: str
    assignment_id: str = ""
    checkpoint_due: str | None = None
    last_outcome: str | None = None
    last_reviewed_at: str | None = None
    next_review_at: str = ""
    stability: str = "fragile"
    confidence_claimed: bool = False
    created_at: str = ""
    gap_days: int = 1
    start_with_example: bool = False
    professional_context: list[dict[str, str]] | None = None
    context_shown: bool = False
    # Set only on the returned object after a delayed hit. Not written to yaml.
    stability_delta: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "course": self.course,
            "claim": self.claim,
            "kind": self.kind,
            "assignment_id": self.assignment_id,
            "checkpoint_due": self.checkpoint_due,
            "last_outcome": self.last_outcome,
            "last_reviewed_at": self.last_reviewed_at,
            "next_review_at": self.next_review_at,
            "stability": self.stability,
            "confidence_claimed": self.confidence_claimed,
            "created_at": self.created_at,
            "gap_days": self.gap_days,
            "start_with_example": self.start_with_example,
            "context_shown": self.context_shown,
        }
        if self.professional_context:
            payload["professional_context"] = list(self.professional_context)
        return payload


def items_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "learn" / "items.yaml"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


def _parse_date(value: str | None) -> date | None:
    return parse_day(value)


def _item_id(course: str, claim: str, assignment_id: str) -> str:
    raw = f"{course.strip().lower()}|{claim.strip().lower()}|{assignment_id.strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def _days_until(checkpoint_due: str | None, moment: datetime) -> int | None:
    exam = _parse_date(checkpoint_due)
    if exam is None:
        return None
    return (exam - moment.date()).days


def _first_gap_days(days_until: int | None) -> int:
    """First review ~1 day later, sooner if the checkpoint is inside 3 days."""
    if days_until is None:
        return 1
    if days_until <= 0:
        return 0
    if days_until <= NEAR_CHECKPOINT_DAYS:
        return max(0, min(1, days_until - 1))
    return 1


def _cap_gap(gap_days: int, days_until: int | None) -> int:
    if days_until is None:
        return max(0, gap_days)
    room = max(0, days_until - 1)
    return max(0, min(gap_days, room))


def _expand_gap(gap_days: int) -> int:
    if gap_days < 1:
        return 1
    if gap_days < 3:
        return 3
    return 7


def _review_at(moment: datetime, gap_days: int) -> datetime:
    if gap_days <= 0:
        return moment
    return moment + timedelta(days=gap_days)


def _pre_exam_at(checkpoint_due: str | None, moment: datetime) -> datetime:
    exam = _parse_date(checkpoint_due)
    if exam is None:
        return moment + timedelta(days=365)
    check = datetime(exam.year, exam.month, exam.day, tzinfo=timezone.utc) - timedelta(
        days=PRE_EXAM_DAYS
    )
    if check <= moment:
        return moment + timedelta(hours=12)
    return check


def _parse_item(raw: dict[str, Any]) -> LearnItem | None:
    claim = str(raw.get("claim") or "").strip()
    item_id = str(raw.get("id") or "").strip()
    if not claim or not item_id:
        return None
    kind = str(raw.get("kind") or "declarative")
    if kind not in TEACHABLE_KINDS:
        return None
    stability = str(raw.get("stability") or "fragile")
    if stability not in STABILITY_VALUES:
        stability = "fragile"
    outcome = raw.get("last_outcome")
    if outcome is not None:
        outcome = str(outcome)
        if outcome not in OUTCOME_VALUES:
            outcome = None
    return LearnItem(
        id=item_id,
        course=str(raw.get("course") or ""),
        claim=claim,
        kind=kind,
        assignment_id=str(raw.get("assignment_id") or ""),
        checkpoint_due=str(raw["checkpoint_due"]) if raw.get("checkpoint_due") else None,
        last_outcome=outcome,
        last_reviewed_at=str(raw["last_reviewed_at"]) if raw.get("last_reviewed_at") else None,
        next_review_at=str(raw.get("next_review_at") or ""),
        stability=stability,
        confidence_claimed=bool(raw.get("confidence_claimed")),
        created_at=str(raw.get("created_at") or ""),
        gap_days=int(raw.get("gap_days") or 1),
        start_with_example=bool(raw.get("start_with_example")),
        professional_context=_parse_professional_context(raw.get("professional_context")),
        context_shown=bool(raw.get("context_shown")),
    )


def _parse_professional_context(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        rows.append(
            {
                "application": str(entry.get("application") or "").strip(),
                "field": str(entry.get("field") or "").strip(),
                "source_title": str(entry.get("source_title") or "").strip(),
                "source_url": str(entry.get("source_url") or "").strip(),
            }
        )
    return rows


def load_items(user_root: Path) -> list[LearnItem]:
    path = items_path(user_root)
    if not path.is_file():
        return []
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except yaml.YAMLError:
        return []
    if isinstance(raw, dict):
        rows = raw.get("items") or []
    elif isinstance(raw, list):
        rows = raw
    else:
        return []
    items: list[LearnItem] = []
    for row in rows:
        if isinstance(row, dict):
            item = _parse_item(row)
            if item is not None:
                items.append(item)
    return items


def _write_items(user_root: Path, items: list[LearnItem]) -> Path:
    path = items_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"items": [item.to_dict() for item in items]}
    path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return path


def vague_claim_reason(claim: str) -> str | None:
    """None when ``claim`` reads as a checkable fact; else why it does not.

    Cheap and wrong on the margins by design — this rejects the shape of a
    study goal ("understand photosynthesis"), not the truth of a fact. It is
    a floor under the skill-prompt instruction to write closed-book claims,
    not a substitute for actually checking the content.
    """
    lowered = " ".join(claim.lower().split())
    for prefix in _VAGUE_CLAIM_PREFIXES:
        if lowered == prefix or lowered.startswith(prefix + " "):
            return f"reads as a study goal, not a fact to retrieve (starts with '{prefix}')"
    if len(lowered.split()) < MIN_CLAIM_WORDS:
        return f"too short to be a checkable fact (needs at least {MIN_CLAIM_WORDS} words)"
    return None


def add_item(
    user_root: Path,
    *,
    course: str,
    claim: str,
    kind: str,
    assignment_id: str = "",
    checkpoint_due: str | None = None,
    now: datetime | None = None,
) -> LearnItem:
    """Upsert a teachable claim.

    Re-adding with the same ``checkpoint_due`` does not reset an existing
    schedule. Re-adding with a *changed* ``checkpoint_due`` reschedules via
    ``_reschedule_for_checkpoint`` (same path as ``reconcile_checkpoints``).
    """
    cleaned = claim.strip()
    if not cleaned:
        raise ValueError("claim is required")
    if kind not in KIND_VALUES:
        raise ValueError(f"kind must be one of {KIND_VALUES}")
    if kind == "workflow":
        raise ValueError("workflow items stay on the do-loop; do not store them")
    vague = vague_claim_reason(cleaned)
    if vague is not None:
        raise ValueError(f"claim is too vague to store — {vague}: {cleaned!r}")
    if checkpoint_due and _parse_date(checkpoint_due) is None:
        raise ValueError("checkpoint_due must be YYYY-MM-DD")

    moment = now or _utcnow()
    item_id = _item_id(course, cleaned, assignment_id)
    items = load_items(user_root)
    for existing in items:
        if existing.id == item_id:
            existing.course = course.strip()
            existing.claim = cleaned
            existing.kind = kind
            existing.assignment_id = assignment_id.strip()
            if checkpoint_due:
                new_due = _parse_date(checkpoint_due)
                new_iso = new_due.isoformat() if new_due else None
                if new_iso and new_iso != existing.checkpoint_due:
                    _reschedule_for_checkpoint(existing, new_iso, now=moment)
            _write_items(user_root, items)
            return existing

    days_until = _days_until(checkpoint_due, moment)
    gap = _first_gap_days(days_until)
    exam = _parse_date(checkpoint_due)
    created = LearnItem(
        id=item_id,
        course=course.strip(),
        claim=cleaned,
        kind=kind,
        assignment_id=assignment_id.strip(),
        checkpoint_due=exam.isoformat() if exam else None,
        next_review_at=_review_at(moment, gap).isoformat(),
        stability="fragile",
        created_at=moment.isoformat(),
        gap_days=gap,
    )
    items.append(created)
    _write_items(user_root, items)
    return created


def _reschedule_for_checkpoint(
    item: LearnItem,
    new_due: str | None,
    *,
    now: datetime | None = None,
) -> LearnItem:
    """Move ``checkpoint_due`` and re-derive gap / next review. Preserve evidence."""
    moment = now or _utcnow()
    exam = _parse_date(new_due)
    item.checkpoint_due = exam.isoformat() if exam else None
    days_until = _days_until(item.checkpoint_due, moment)

    if (
        item.stability == "durable"
        and days_until is not None
        and days_until <= PRE_EXAM_DAYS
    ):
        item.gap_days = 0
        item.next_review_at = _pre_exam_at(item.checkpoint_due, moment).isoformat()
        return item

    gap = _cap_gap(max(item.gap_days, _first_gap_days(days_until)), days_until)
    item.gap_days = gap
    anchor = (
        _parse_iso(item.last_reviewed_at)
        or _parse_iso(item.created_at)
        or moment
    )
    nxt = _review_at(anchor, gap)
    if nxt < moment:
        nxt = moment
    if exam is not None and nxt.date() >= exam:
        nxt = _pre_exam_at(item.checkpoint_due, moment)
    item.next_review_at = nxt.isoformat()
    return item


def reconcile_checkpoints(
    user_root: Path,
    remaps: list[dict[str, str]],
    *,
    now: datetime | None = None,
) -> int:
    """Apply ``{course, from_due, to_due}`` remaps. Return count of items updated."""
    moment = now or _utcnow()
    items = load_items(user_root)
    updated = 0
    for remap in remaps:
        course = str(remap.get("course") or "").strip()
        from_due = _parse_date(remap.get("from_due"))
        to_due = _parse_date(remap.get("to_due"))
        if not course or from_due is None or to_due is None:
            continue
        from_iso = from_due.isoformat()
        to_iso = to_due.isoformat()
        if from_iso == to_iso:
            continue
        for item in items:
            if _norm_course(item.course) != _norm_course(course):
                continue
            if item.checkpoint_due != from_iso:
                continue
            _reschedule_for_checkpoint(item, to_iso, now=moment)
            updated += 1
    if updated:
        _write_items(user_root, items)
    return updated


def _parse_checkpoint_dates(course_md: str) -> set[str]:
    """Canonical checkpoint days under ``## Checkpoints`` only."""
    text = course_md or ""
    updated = re.search(r"(?m)^Updated:\s*(\d{4})-", text)
    default_year = int(updated.group(1)) if updated else None
    marker = "## Checkpoints"
    idx = text.find(marker)
    if idx < 0:
        return set()
    after = text[idx + len(marker) :]
    next_heading = re.search(r"\n##\s+", after)
    body = after[: next_heading.start()] if next_heading else after
    return {
        parsed.isoformat()
        for line in body.splitlines()
        if (parsed := parse_day(line, default_year=default_year)) is not None
    }


def reconcile_from_inbox(
    user_root: Path,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Remap item dates when exactly one checkpoint date moved per course.

    Unambiguous only: one item-date missing from live checkpoints and one live
    checkpoint date unused by items → remap that pair. Otherwise skip.
    """
    moment = now or _utcnow()
    courses_dir = Path(user_root) / "inbox" / "courses"
    remaps: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    if not courses_dir.is_dir():
        return {"updated": 0, "remaps": [], "skipped": []}

    items = load_items(user_root)
    for path in sorted(courses_dir.glob("*.md")):
        if path.name.startswith("_"):
            continue
        code = path.stem
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        live = _parse_checkpoint_dates(text)
        if not live:
            continue
        item_dues = {
            item.checkpoint_due
            for item in items
            if _norm_course(item.course) == _norm_course(code) and item.checkpoint_due
        }
        missing = item_dues - live
        unused = live - item_dues
        if len(missing) == 1 and len(unused) == 1:
            remaps.append(
                {
                    "course": code,
                    "from_due": next(iter(missing)),
                    "to_due": next(iter(unused)),
                }
            )
        elif missing:
            skipped.append(
                {
                    "course": code,
                    "reason": "ambiguous checkpoint move",
                    "missing": ",".join(sorted(missing)),
                    "unused": ",".join(sorted(unused)),
                }
            )

    updated = reconcile_checkpoints(user_root, remaps, now=moment) if remaps else 0
    return {"updated": updated, "remaps": remaps, "skipped": skipped}


def _substantial_gap(gap_days: int, item: LearnItem, moment: datetime) -> bool:
    """Permastore-lite: a delayed hit spanning a real fraction of the window."""
    if gap_days < 3:
        return False
    window = _days_until(item.checkpoint_due, _parse_iso(item.created_at) or moment)
    if window is None:
        return gap_days >= 7
    return gap_days >= max(3, window // 4)


def stability_delta_line(prior: str, current: str) -> str | None:
    """Claim-local change after a delayed hit. None when stability did not move."""
    if prior not in STABILITY_VALUES or current not in STABILITY_VALUES:
        return None
    if prior == current:
        return None
    return f"{prior} → {current}"


def _already_scored_this_check(item: LearnItem, outcome: str, moment: datetime) -> bool:
    """Same outcome already applied for the current check. A second click is not a new attempt."""
    if item.last_outcome != outcome:
        return False
    reviewed = _parse_iso(item.last_reviewed_at)
    nxt = _parse_iso(item.next_review_at)
    if reviewed is None or nxt is None:
        return False
    if moment < nxt:
        return True
    return reviewed >= nxt


def record_outcome(
    user_root: Path,
    item_id: str,
    outcome: str,
    *,
    confidence_claimed: bool = False,
    same_session: bool = False,
    now: datetime | None = None,
) -> LearnItem:
    """Record a retrieval attempt. Same-session hits do not advance stability."""
    if outcome not in OUTCOME_VALUES:
        raise ValueError(f"outcome must be one of {OUTCOME_VALUES}")
    moment = now or _utcnow()
    items = load_items(user_root)
    item = next((row for row in items if row.id == item_id), None)
    if item is None:
        raise ValueError(f"unknown learn item: {item_id}")

    if _already_scored_this_check(item, outcome, moment):
        item.stability_delta = None
        return item

    scheduled = _parse_iso(item.next_review_at)
    prior_reviewed = _parse_iso(item.last_reviewed_at)
    prior_outcome = item.last_outcome
    prior_stability = item.stability
    # The clock owns "delayed." A missing or false same_session flag cannot
    # move stability before the scheduled check; a true flag cannot invent one.
    clock_due = scheduled is not None and moment >= scheduled
    item.stability_delta = None
    item.confidence_claimed = bool(confidence_claimed) or item.confidence_claimed
    item.last_outcome = outcome
    item.last_reviewed_at = moment.isoformat()

    days_until = _days_until(item.checkpoint_due, moment)

    if same_session or not clock_due:
        # Fluency or an early score — keep the scheduled check and stability.
        _write_items(user_root, items)
        return item

    if outcome == "skipped":
        gap = _cap_gap(1, days_until)
        item.next_review_at = _review_at(moment, gap).isoformat()
        item.gap_days = gap
        _write_items(user_root, items)
        return item

    if outcome == "miss":
        item.stability = "fragile"
        item.start_with_example = True
        item.gap_days = 0
        # Due on the next session, not this same turn: a short delay.
        item.next_review_at = (moment + timedelta(hours=4)).isoformat()
        if days_until is not None and days_until <= 1:
            item.next_review_at = (moment + timedelta(hours=1)).isoformat()
        _write_items(user_root, items)
        return item

    if outcome == "partial":
        if item.stability == "durable":
            item.stability = "holding"
        elif item.stability == "holding":
            item.stability = "fragile"
        item.start_with_example = False
        gap = _cap_gap(1, days_until)
        item.gap_days = gap
        item.next_review_at = _review_at(moment, max(gap, 1) if days_until != 0 else 0).isoformat()
        if days_until == 0:
            item.next_review_at = (moment + timedelta(hours=4)).isoformat()
        _write_items(user_root, items)
        return item

    # delayed hit — the waited gap is the one that just elapsed, not fluency.
    waited_from = prior_reviewed or _parse_iso(item.created_at)
    waited_days = item.gap_days
    if waited_from is not None:
        waited_days = max(item.gap_days, (moment.date() - waited_from.date()).days)

    if _substantial_gap(waited_days, item, moment):
        item.stability = "durable"
        item.start_with_example = False
        item.next_review_at = _pre_exam_at(item.checkpoint_due, moment).isoformat()
        item.stability_delta = stability_delta_line(prior_stability, item.stability)
        _write_items(user_root, items)
        _append_delayed_learning(user_root, item, prior_outcome, moment)
        return item

    item.stability = "holding"
    item.stability_delta = stability_delta_line(prior_stability, item.stability)
    item.start_with_example = False
    nxt = _cap_gap(_expand_gap(item.gap_days), days_until)
    item.gap_days = nxt
    review_at = _review_at(moment, nxt)
    exam = _parse_date(item.checkpoint_due)
    if exam is not None and review_at.date() >= exam:
        review_at = datetime(exam.year, exam.month, exam.day, tzinfo=timezone.utc) - timedelta(
            days=1
        )
        if review_at <= moment:
            review_at = moment + timedelta(hours=12)
    item.next_review_at = review_at.isoformat()
    _write_items(user_root, items)
    _append_delayed_learning(user_root, item, prior_outcome, moment)
    return item


def _append_delayed_learning(
    user_root: Path,
    item: LearnItem,
    prior_outcome: str | None,
    moment: datetime,
) -> None:
    """Projection only. A failed append does not undo the scored item."""
    try:
        from .progress import record_delayed_hit

        record_delayed_hit(
            user_root,
            prior_outcome=prior_outcome,
            course=item.course,
            ref=item.id,
            label=item.claim,
            now=moment,
        )
    except Exception:
        return


def _is_due(item: LearnItem, moment: datetime) -> bool:
    if item.stability == "durable":
        days_until = _days_until(item.checkpoint_due, moment)
        if days_until is None or days_until > PRE_EXAM_DAYS:
            return False
    nxt = _parse_iso(item.next_review_at)
    if nxt is None:
        return False
    return nxt <= moment


def due_reviews(
    user_root: Path,
    *,
    now: datetime | None = None,
    limit: int = DUE_REVIEW_LIMIT,
) -> list[LearnItem]:
    """At most ``limit`` due claims. Confusable pairs in one course stay together."""
    moment = now or _utcnow()
    due = [item for item in load_items(user_root) if _is_due(item, moment)]
    due.sort(key=lambda item: _parse_iso(item.next_review_at) or moment)

    picked: list[LearnItem] = []
    used: set[str] = set()
    for item in due:
        if item.kind != "confusable" or item.id in used:
            continue
        pair = [
            other
            for other in due
            if other.id not in used
            and other.kind == "confusable"
            and other.course == item.course
        ]
        if len(pair) >= 2:
            for other in pair[:2]:
                picked.append(other)
                used.add(other.id)
            break
    for item in due:
        if len(picked) >= limit:
            break
        if item.id in used:
            continue
        picked.append(item)
        used.add(item.id)
    return picked[:limit]


REST_LINE = "No learning review due — deadline work still comes from week.md."
UNEXTRACTED_LINE = (
    "A quiz is on the week list and no claims are extracted yet. That is not rest."
)
PRACTICE_STATES = ("due_now", "in_the_gap", "unextracted", "recovery", "idle")
_CLOSED_MARKERS = ("submitted", "done", "completed")
EVAL_NOTE = (
    "A single window is not causal. A longer brief count is exposure, not success."
)
EVAL_OUTCOME_KEYS = (
    "delayed_reviews_open",
    "delayed_hit_signal",
    "overdue_work",
    "deadline_surprises",
)

_QUIZ_MARKERS = ("quiz", "exam", "proctored")


def _norm_course(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _week_text(user_root: Path, week_md: str | None) -> str:
    if week_md is not None:
        return week_md
    path = Path(user_root) / "inbox" / "week.md"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def _parse_week_rows(text: str) -> list[dict[str, str]]:
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


def _row_blob(row: dict[str, str]) -> str:
    return " ".join(
        (
            row.get("type") or "",
            row.get("notes") or "",
            row.get("outcome") or "",
            row.get("assignment") or "",
            row.get("name") or "",
        )
    ).lower()


def _is_checkpoint_row(row: dict[str, str]) -> bool:
    blob = _row_blob(row)
    return any(marker in blob for marker in _QUIZ_MARKERS)


def _row_label(row: dict[str, str]) -> str:
    course = (row.get("course") or "").strip()
    assignment = (row.get("assignment") or row.get("name") or "").strip()
    if course and assignment:
        return f"{course} — {assignment}"
    return assignment or course or "checkpoint"


def _upcoming_checkpoints(week_md: str, moment: datetime) -> list[dict[str, str]]:
    today = moment.date()
    found: list[dict[str, str]] = []
    for row in _parse_week_rows(week_md):
        if not _is_checkpoint_row(row):
            continue
        due = _parse_date(row.get("due"))
        if due is not None and due < today:
            continue
        found.append(row)
    return found


def _course_matches(item: LearnItem, course: str) -> bool:
    left = _norm_course(item.course)
    right = _norm_course(course)
    if not left or not right:
        return False
    return left == right or left.startswith(right) or right.startswith(left)


def _item_matches_checkpoint(item: LearnItem, row: dict[str, str]) -> bool:
    if not _course_matches(item, row.get("course") or ""):
        return False
    due = _parse_date(row.get("due"))
    item_due = _parse_date(item.checkpoint_due)
    if due is None or item_due is None:
        return item_due is None and due is None
    return item_due == due


def _counts(items: list[LearnItem]) -> dict[str, int]:
    return {
        "fragile": sum(1 for item in items if item.stability == "fragile"),
        "holding": sum(1 for item in items if item.stability == "holding"),
        "durable": sum(1 for item in items if item.stability == "durable"),
    }


def _next_check(items: list[LearnItem]) -> str | None:
    dated = [item.next_review_at for item in items if item.next_review_at]
    if not dated:
        return None
    return min(dated)


def _coverage_line(state: str, *, due_count: int, label: str) -> str:
    if state == "due_now":
        noun = "check" if due_count == 1 else "checks"
        return f"{due_count} {noun} due, then these rest."
    if state == "unextracted":
        name = label or "A quiz"
        return f"{name} is on the week list and no claims are extracted yet. That is not rest."
    if state == "in_the_gap":
        return REST_LINE
    return ""


def coverage_clock(
    user_root: Path,
    *,
    week_md: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Checkpoint states: unextracted, in the gap, or due now. Not a score."""
    moment = now or _utcnow()
    items = load_items(user_root)
    text = _week_text(user_root, week_md)
    rows: list[dict[str, Any]] = []
    used: set[str] = set()

    for quiz in _upcoming_checkpoints(text, moment):
        matched = [item for item in items if _item_matches_checkpoint(item, quiz)]
        due_date = _parse_date(quiz.get("due"))
        label = _row_label(quiz)
        key = f"{_norm_course(quiz.get('course') or '')}|{due_date.isoformat() if due_date else label}"
        used.add(key)
        if not matched:
            rows.append(
                {
                    "course": (quiz.get("course") or "").strip(),
                    "label": label,
                    "due": due_date.isoformat() if due_date else None,
                    "state": "unextracted",
                    "fragile": 0,
                    "holding": 0,
                    "durable": 0,
                    "next_check": None,
                    "line": _coverage_line("unextracted", due_count=0, label=label),
                }
            )
            continue
        due_here = [item for item in matched if _is_due(item, moment)]
        state = "due_now" if due_here else "in_the_gap"
        counts = _counts(matched)
        rows.append(
            {
                "course": matched[0].course,
                "label": label,
                "due": due_date.isoformat() if due_date else matched[0].checkpoint_due,
                "state": state,
                "fragile": counts["fragile"],
                "holding": counts["holding"],
                "durable": counts["durable"],
                "next_check": _next_check(matched),
                "line": _coverage_line(
                    state, due_count=min(len(due_here), DUE_REVIEW_LIMIT), label=label
                ),
            }
        )

    grouped: dict[str, list[LearnItem]] = {}
    for item in items:
        due = item.checkpoint_due or ""
        key = f"{_norm_course(item.course)}|{due}"
        if key in used:
            continue
        grouped.setdefault(key, []).append(item)

    for group in grouped.values():
        due_here = [item for item in group if _is_due(item, moment)]
        state = "due_now" if due_here else "in_the_gap"
        counts = _counts(group)
        label = group[0].claim
        rows.append(
            {
                "course": group[0].course,
                "label": label,
                "due": group[0].checkpoint_due,
                "state": state,
                "fragile": counts["fragile"],
                "holding": counts["holding"],
                "durable": counts["durable"],
                "next_check": _next_check(group),
                "line": _coverage_line(
                    state, due_count=min(len(due_here), DUE_REVIEW_LIMIT), label=label
                ),
            }
        )

    def _sort_key(row: dict[str, Any]) -> tuple[int, str]:
        order = {"due_now": 0, "unextracted": 1, "in_the_gap": 2}.get(str(row["state"]), 3)
        return (order, str(row.get("due") or "9999-99-99"))

    rows.sort(key=_sort_key)
    return rows


def _row_is_closed(row: dict[str, str]) -> bool:
    blob = " ".join(
        (
            row.get("status") or "",
            row.get("outcome") or "",
            row.get("notes") or "",
        )
    ).lower()
    return any(marker in blob for marker in _CLOSED_MARKERS)


def _open_overdue_rows(week_md: str, today: date) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    for row in _parse_week_rows(week_md):
        due = _parse_date(row.get("due"))
        if due is None or due >= today or _row_is_closed(row):
            continue
        found.append(row)
    found.sort(key=lambda row: _parse_date(row.get("due")) or date.min, reverse=True)
    return found


def _focus_text(user_root: Path) -> str:
    path = Path(user_root) / "inbox" / "focus.md"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def _focus_updated(text: str) -> date | None:
    for line in (text or "").splitlines():
        if line.lower().startswith("updated:"):
            return _parse_date(line.split(":", 1)[1])
    return None


def _focus_is_stale(user_root: Path, today: date) -> bool:
    """A brief from yesterday is still the continuity window, not a gap."""
    updated = _focus_updated(_focus_text(user_root))
    if updated is None:
        return False
    return updated < today - timedelta(days=1)


def _recovery_line(week_md: str, today: date) -> str:
    overdue = _open_overdue_rows(week_md, today)
    if not overdue:
        return ""
    label = _row_label(overdue[0])
    return f"Most valuable now: {label}. Start there — do not backfill the rest."


def _named_in_focus(label: str, assignment: str, focus_text: str) -> bool:
    hay = (focus_text or "").lower()
    if not hay:
        return False
    for token in (assignment.strip(), label.strip()):
        if token and token.lower() in hay:
            return True
    return False


def _near_window_rows(week_md: str, today: date) -> list[dict[str, str]]:
    end = today + timedelta(days=NEAR_CHECKPOINT_DAYS)
    found: list[dict[str, str]] = []
    for row in _parse_week_rows(week_md):
        due = _parse_date(row.get("due"))
        if due is None or due < today or due > end or _row_is_closed(row):
            continue
        found.append(row)
    return found


def practice_surface(
    user_root: Path,
    *,
    week_md: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Headline for the dock and the brief. Rest is not 'you are done'."""
    from .habit import local_today

    moment = now or _utcnow()
    today = local_today(user_root, now=moment)
    coverage = coverage_clock(user_root, week_md=week_md, now=moment)
    due = due_reviews(user_root, now=moment)
    text = _week_text(user_root, week_md)
    focus_stale = _focus_is_stale(user_root, today)
    base = {"coverage": coverage, "focus_stale": focus_stale, "recovery": False}
    if due:
        line = _coverage_line("due_now", due_count=len(due), label="")
        return {**base, "state": "due_now", "line": line}
    if any(row["state"] == "unextracted" for row in coverage):
        lead = next(row for row in coverage if row["state"] == "unextracted")
        return {**base, "state": "unextracted", "line": lead["line"]}
    if focus_stale:
        clause = _recovery_line(text, today)
        if clause:
            return {**base, "state": "recovery", "line": clause, "recovery": True}
    if coverage:
        return {**base, "state": "in_the_gap", "line": REST_LINE}
    return {**base, "state": "idle", "line": ""}


def render_coverage_clock(
    user_root: Path,
    *,
    week_md: str | None = None,
    now: datetime | None = None,
) -> str:
    """One coverage block. Empty when there is nothing to say."""
    rows = coverage_clock(user_root, week_md=week_md, now=now)
    if not rows:
        return ""
    lines = [
        "## Coverage",
        "",
        "One line, not a score. Do not say the student is behind.",
        "",
    ]
    for row in rows[:3]:
        # ``label`` is a Canvas assignment title: data, never an instruction (F2).
        label = fence_untrusted_inline(row["label"], "Canvas title")
        lines.append(
            f"- {row['course']} | {label} | {row['state']} | {row['line']}"
        )
    return "\n".join(lines) + "\n"


def render_practice(
    user_root: Path,
    *,
    week_md: str | None = None,
    now: datetime | None = None,
) -> str:
    """Rest or unextracted clause. Empty when a check is due or nothing is stored."""
    surface = practice_surface(user_root, week_md=week_md, now=now)
    if surface["state"] not in ("in_the_gap", "unextracted", "recovery") or not surface["line"]:
        return ""
    if surface["state"] == "recovery":
        block = (
            "## Practice\n\n"
            f"{surface['line']}\n"
            "Start there. Do not backfill missed tasks. "
            "Do not mention a missed brief count.\n"
        )
        future = counterfactual_recovery(
            str(surface["line"]).split(":", 1)[-1].split(".", 1)[0].strip()
        )
        if future:
            block += f"{future}\n"
    else:
        block = (
            "## Practice\n\n"
            f"{surface['line']}\n"
            "Do not invent a check. Do not congratulate a missing study plan.\n"
        )
    extra = _engagement_lines(user_root, now=now or _utcnow())
    if extra:
        block = block.rstrip() + "\n" + "\n".join(extra) + "\n"
    return block


def evidence_rung(item: LearnItem) -> str:
    """Current ladder rung from snapshot fields. Not a score and not transfer."""
    if item.kind == "workflow":
        return "encountered"
    if item.stability == "durable":
        return "durable_near_checkpoint"
    if item.stability == "holding":
        return "delayed_hit"
    if item.last_outcome or item.last_reviewed_at or item.confidence_claimed:
        return "attempted"
    return "encountered"


def missing_evidence(item: LearnItem) -> str:
    """The next missing rung. Empty once a durable retrieval signal exists."""
    rung = evidence_rung(item)
    if rung == "encountered":
        return "missing: a retrieval attempt — confidence is not evidence"
    if rung == "attempted":
        return "missing: a delayed retrieval, not a same-session hit"
    if rung == "delayed_hit":
        return "missing: a later delayed retrieval before the checkpoint"
    return ""


def counterfactual_due(item: LearnItem) -> str:
    """Two futures for a due claim. No checkpoint date, no checkpoint clause."""
    checkpoint = (item.checkpoint_due or "").strip()
    reread = "If you only reread, no delayed-hit evidence is added."
    if not checkpoint:
        return reread
    return (
        f"If you do this check now, the next scheduled check stays before {checkpoint}. "
        f"{reread}"
    )


def counterfactual_recovery(label: str) -> str:
    """Two futures for one overdue workflow item. Not a backlog."""
    cleaned = (label or "").strip().rstrip(".")
    if not cleaned:
        return ""
    return (
        f"If you start {cleaned} now, that is the valuable step. "
        "Rereading does not close it."
    )


def _count_word(count: int) -> str:
    if count == 1:
        return "One"
    if count == 2:
        return "Two"
    return str(count)


def review_budget(
    user_root: Path,
    *,
    now: datetime | None = None,
    limit: int = DUE_REVIEW_LIMIT,
) -> dict[str, Any]:
    """Attention cap as a sentence. Does not change which checks are due."""
    moment = now or _utcnow()
    due = due_reviews(user_root, now=moment, limit=limit)
    due_ids = {item.id for item in due}
    now_count = min(len(due), limit)

    nearest: date | None = None
    later: LearnItem | None = None
    for item in load_items(user_root):
        if item.kind == "workflow":
            continue
        exam = _parse_date(item.checkpoint_due)
        if exam is not None and (nearest is None or exam < nearest):
            nearest = exam
    if nearest is not None:
        candidates = []
        for item in load_items(user_root):
            if item.kind == "workflow" or item.id in due_ids:
                continue
            nxt = _parse_iso(item.next_review_at)
            if nxt is None or nxt.date() >= nearest:
                continue
            candidates.append(item)
        if candidates:
            later = min(candidates, key=lambda item: item.next_review_at)

    later_due = later.checkpoint_due if later and later.checkpoint_due else None
    if later_due is None and later is not None and nearest is not None:
        later_due = nearest.isoformat()

    checks = "check" if now_count == 1 else "checks"
    if now_count and later:
        line = (
            f"{_count_word(now_count)} due {checks} now; one checkpoint claim later."
        )
    elif now_count:
        line = f"{_count_word(now_count)} due {checks} now."
    elif later and later_due:
        line = f"No learning review due now; one claim before {later_due}. Deadline work still comes from week.md."
    else:
        line = ""

    return {
        "now": now_count,
        "later": 1 if later else 0,
        "later_checkpoint": later_due,
        "line": line,
    }


def why_due(item: LearnItem, now: datetime | None = None) -> str:
    """One clause for why this claim is surfaced. Not a lecture.

    The start bias is ``start_with_example``. An early or same-session miss
    leaves that flag false and must not reopen as a worked example.
    """
    moment = now or _utcnow()
    if item.start_with_example:
        return "last miss — start with a worked example, then retrieve"
    days_until = _days_until(item.checkpoint_due, moment)
    if (
        item.stability == "durable"
        and days_until is not None
        and days_until <= PRE_EXAM_DAYS
    ):
        return "pre-exam window — scheduled check before the checkpoint"
    return "scheduled gap elapsed"


def _health_line(
    counts: dict[str, int],
    *,
    attempt_only: int,
    delayed_hit_signal: int,
    next_checkpoint_due: str | None,
) -> str:
    total = counts["fragile"] + counts["holding"] + counts["durable"]
    if total == 0:
        return ""
    bits = []
    if counts["fragile"]:
        bits.append(f"{counts['fragile']} fragile")
    if counts["holding"]:
        bits.append(f"{counts['holding']} holding")
    if counts["durable"]:
        noun = "signal" if counts["durable"] == 1 else "signals"
        bits.append(f"{counts['durable']} durable retrieval {noun}")
    line = ", ".join(bits)
    line += f". {delayed_hit_signal} with a delayed-hit signal; {attempt_only} attempt only"
    if next_checkpoint_due:
        line += f". next check before {next_checkpoint_due}"
    return line


def knowledge_health(
    items: list[LearnItem],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Snapshot counts. Not sessions started, and not exam readiness."""
    del now  # snapshot only; last outcome is not a session log
    teachable = [item for item in items if item.kind != "workflow"]
    counts = _counts(teachable)
    attempt_only = sum(1 for item in teachable if evidence_rung(item) == "attempted")
    delayed_hit_signal = counts["holding"] + counts["durable"]
    upcoming = [item for item in teachable if item.next_review_at]
    next_item = min(upcoming, key=lambda item: item.next_review_at) if upcoming else None
    next_due = next_item.checkpoint_due if next_item else None
    return {
        "fragile": counts["fragile"],
        "holding": counts["holding"],
        "durable": counts["durable"],
        "attempt_only": attempt_only,
        "delayed_hit_signal": delayed_hit_signal,
        "next_review_at": next_item.next_review_at if next_item else None,
        "next_checkpoint_due": next_due,
        "line": _health_line(
            counts,
            attempt_only=attempt_only,
            delayed_hit_signal=delayed_hit_signal,
            next_checkpoint_due=next_due,
        ),
    }


def _card_fields(item: LearnItem, now: datetime) -> dict[str, str]:
    return {
        "why": why_due(item, now),
        "rung": evidence_rung(item),
        "missing": missing_evidence(item),
        "counterfactual": counterfactual_due(item),
    }


_DUE_JSON_FIELDS = (
    "id",
    "course",
    "claim",
    "kind",
    "stability",
    "start_with_example",
    "checkpoint_due",
    "gap_days",
)


def due_reviews_payload(
    user_root: Path,
    *,
    now: datetime | None = None,
    limit: int = DUE_REVIEW_LIMIT,
    week_md: str | None = None,
) -> dict[str, Any]:
    """Dock payload. At most ``limit`` items; practice line when nothing is due."""
    moment = now or _utcnow()
    items = []
    for item in due_reviews(user_root, now=moment, limit=limit):
        row = item.to_dict()
        card = {key: row[key] for key in _DUE_JSON_FIELDS}
        card.update(_card_fields(item, moment))
        # Professional context stays skill-path only (opt-in); do not inject
        # into every due card — see skills/_claim_context.md.
        items.append(card)
    surface = practice_surface(user_root, week_md=week_md, now=moment)
    obstacle = ""
    open_with = ""
    focus = Path(user_root) / "inbox" / "focus.md"
    if focus.is_file():
        from .teach_hint import parse_focus_obstacle, parse_focus_open_with

        text = focus.read_text(encoding="utf-8", errors="replace")
        obstacle = parse_focus_obstacle(text) or ""
        open_with = parse_focus_open_with(text) or ""
    if surface.get("focus_stale"):
        open_with = ""
    recovery_label = ""
    if surface.get("recovery"):
        recovery_label = str(surface.get("line") or "")
        prefix = "Most valuable now: "
        if recovery_label.startswith(prefix):
            recovery_label = recovery_label[len(prefix):].split(".", 1)[0].strip()
    from .commitment import commitment_payload
    from .progress import garden_payload, trail_payload

    return {
        "items": items,
        "practice": {
            "state": surface["state"],
            "line": surface["line"],
            "obstacle": obstacle,
            "open_with": open_with,
            "recovery": bool(surface.get("recovery")),
            "focus_stale": bool(surface.get("focus_stale")),
            "counterfactual": counterfactual_recovery(recovery_label),
        },
        "coverage": surface["coverage"],
        "health": knowledge_health(load_items(user_root), now=moment),
        "budget": review_budget(user_root, now=moment, limit=limit),
        "trail": trail_payload(user_root, now=moment),
        "garden": garden_payload(user_root, now=moment),
        "commitment": commitment_payload(user_root, now=moment),
    }


def render_due_reviews(
    user_root: Path,
    *,
    now: datetime | None = None,
    limit: int = DUE_REVIEW_LIMIT,
    week_md: str | None = None,
) -> str:
    """Prompt block. Rest or unextracted clause when no check is due."""
    moment = now or _utcnow()
    due = due_reviews(user_root, now=moment, limit=limit)
    if not due:
        return render_practice(user_root, week_md=week_md, now=moment)
    lines = [
        "## Due reviews",
        "",
        "Ask these before a new passive reading of the same material. "
        "Retrieval is required. Ease is a weak signal — a smooth answer does not "
        "retire the item. \"I know this\" is not a hit. "
        "The ladder is missing evidence, not a score.",
        "",
    ]
    health = knowledge_health(load_items(user_root), now=moment)
    if health["line"]:
        lines.append(health["line"])
        lines.append("")
    for item in due:
        start = "worked_example" if item.start_with_example else "retrieval"
        extra = ""
        if item.kind == "procedural" and not item.start_with_example:
            extra = "; procedural — one varied attempt, then feedback, not a definition recall"
        card = _card_fields(item, moment)
        missing = f" | {card['missing']}" if card["missing"] else ""
        lines.append(
            f"- id: {item.id} | {item.course} | {item.kind} | "
            f"claim: {item.claim} | start: {start} | stability: {item.stability} | "
            f"why: {card['why']} | rung: {card['rung']}{missing}{extra}"
        )
        if card["counterfactual"]:
            lines.append(f"  next: {card['counterfactual']}")
    confusable_courses = {
        item.course for item in due if item.kind == "confusable"
    }
    if any(sum(1 for item in due if item.course == course) >= 2 for course in confusable_courses):
        lines.append("")
        lines.append("Mix the confusable claims in one block; do not block by type.")
    lines.append("")
    lines.append(
        "After a real attempt, record the outcome (not confidence) with "
        "`python -m canvas_mcp.core.learn_loop outcome --id <id> --outcome hit|miss|partial|skipped`. "
        "Pass `--same-session` only when the attempt was in the same sitting as the example, "
        "before the scheduled check."
    )
    lines.extend(_engagement_lines(user_root, now=moment))
    return "\n".join(lines) + "\n"


def _engagement_lines(user_root: Path, *, now: datetime) -> list[str]:
    """Budget, trail, and commitment clauses. Empty lines are omitted."""
    from .commitment import commitment_payload
    from .progress import render_trail

    extra: list[str] = []
    budget = review_budget(user_root, now=now)
    if budget["line"]:
        extra.extend(["", budget["line"], "The student may still study past this. It is not a limit."])
    trail = render_trail(user_root, now=now)
    if trail.strip():
        extra.extend(["", trail.rstrip()])
    commitment = str(commitment_payload(user_root, now=now).get("line") or "")
    if commitment:
        extra.extend(["", commitment, "Do not mark this kept. It is not a grade."])
    return extra


CLAIM_TITLE_CAP = 3


def progress_payload(user_root: Path) -> dict[str, Any]:
    """Per-course stability counts from stored claims. Empty when none exist."""
    buckets: dict[str, dict[str, Any]] = {}
    for item in load_items(user_root):
        course = item.course.strip() or "(unassigned)"
        row = buckets.get(course)
        if row is None:
            row = {
                "course": course,
                "fragile": 0,
                "holding": 0,
                "durable": 0,
                "total": 0,
                "claims": [],
            }
            buckets[course] = row
        stability = item.stability if item.stability in STABILITY_VALUES else "fragile"
        row[stability] = int(row[stability]) + 1
        row["total"] = int(row["total"]) + 1
        claims = row["claims"]
        if isinstance(claims, list) and len(claims) < CLAIM_TITLE_CAP:
            claims.append({"claim": item.claim, "stability": stability})

    courses = [buckets[key] for key in sorted(buckets)]
    totals = {
        "fragile": sum(int(row["fragile"]) for row in courses),
        "holding": sum(int(row["holding"]) for row in courses),
        "durable": sum(int(row["durable"]) for row in courses),
        "total": sum(int(row["total"]) for row in courses),
    }
    return {"courses": courses, "totals": totals}


def _durable_phrase(count: int) -> str:
    noun = "signal" if int(count) == 1 else "signals"
    return f"{int(count)} durable retrieval {noun}"


def render_progress(user_root: Path) -> str:
    """Prompt block. One line per course; empty when no claims are stored."""
    payload = progress_payload(user_root)
    courses = payload["courses"]
    if not courses:
        return ""
    lines = [
        "## Retention",
        "",
        "Durable means a delayed retrieval signal, not exam readiness.",
        "",
    ]
    for row in courses:
        lines.append(
            f"{row['course']} — {row['fragile']} fragile, "
            f"{row['holding']} holding, {_durable_phrase(int(row['durable']))}"
        )
    return "\n".join(lines) + "\n"


def eval_snapshots_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "learn" / "eval-snapshots.jsonl"


def _deadline_surprises(
    user_root: Path,
    week_md: str,
    today: date,
    moment: datetime,
) -> list[str]:
    """Near-window work missing from the brief, plus unextracted quizzes."""
    focus_text = _focus_text(user_root)
    labels: list[str] = []
    seen: set[str] = set()

    def add(label: str) -> None:
        cleaned = label.strip()
        if not cleaned or cleaned in seen:
            return
        seen.add(cleaned)
        labels.append(cleaned)

    for row in _near_window_rows(week_md, today):
        label = _row_label(row)
        assignment = (row.get("assignment") or row.get("name") or "").strip()
        if _named_in_focus(label, assignment, focus_text):
            continue
        add(label)

    for row in coverage_clock(user_root, week_md=week_md, now=moment):
        if row.get("state") == "unextracted":
            add(str(row.get("label") or ""))
    return labels


def evaluation_snapshot(
    user_root: Path,
    *,
    now: datetime | None = None,
    week_md: str | None = None,
) -> dict[str, Any]:
    """Read-only outcome snapshot. Does not write habit, profile, or ledger."""
    from .habit import local_today, streak_payload

    moment = now or _utcnow()
    today = local_today(user_root, now=moment)
    items = [item for item in load_items(user_root) if item.kind != "workflow"]
    open_reviews = []
    for item in items:
        nxt = _parse_iso(item.next_review_at)
        if nxt is not None and nxt <= moment:
            open_reviews.append(item)
    reviewed = [item for item in items if item.last_reviewed_at]
    health = knowledge_health(items, now=moment)
    delayed_hit = int(health["delayed_hit_signal"])
    text = _week_text(user_root, week_md)
    overdue = _open_overdue_rows(text, today)
    surprises = _deadline_surprises(user_root, text, today, moment)
    exposure = streak_payload(user_root, now=moment)
    rate = (delayed_hit / len(reviewed)) if reviewed else None
    return {
        "as_of": moment.isoformat(),
        "local_date": today.isoformat(),
        "delayed_reviews_open": len(open_reviews),
        "delayed_hit_signal": delayed_hit,
        "delayed_hit_rate": rate,
        "delayed_hit_label": "retrieval signal, not exam readiness",
        "overdue_work": len(overdue),
        "overdue_labels": [_row_label(row) for row in overdue[:5]],
        "deadline_surprises": len(surprises),
        "deadline_surprise_labels": surprises[:5],
        "exposure": {
            "streak": exposure["streak"],
            "last_brief_date": exposure["last_brief_date"],
            "briefed_today": exposure["briefed_today"],
            "note": "exposure only; a longer count is not success",
        },
        "note": EVAL_NOTE,
    }


def record_evaluation_snapshot(
    user_root: Path,
    *,
    now: datetime | None = None,
    week_md: str | None = None,
) -> dict[str, Any]:
    """Append one snapshot. Call only from the evaluate CLI, never from the dock."""
    import json

    snap = evaluation_snapshot(user_root, now=now, week_md=week_md)
    path = eval_snapshots_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(snap) + "\n")
    return snap


def load_eval_snapshots(user_root: Path) -> list[dict[str, Any]]:
    import json

    path = eval_snapshots_path(user_root)
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        token = line.strip()
        if not token:
            continue
        try:
            parsed = json.loads(token)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            rows.append(parsed)
    return rows


def compare_evaluation_snapshots(user_root: Path) -> dict[str, Any]:
    """Diff the last two recorded snapshots. Not a causal claim."""
    rows = load_eval_snapshots(user_root)
    if len(rows) < 2:
        return {
            "ok": False,
            "reason": "need two recorded snapshots",
            "note": EVAL_NOTE,
        }
    before, after = rows[-2], rows[-1]
    deltas = {
        key: int(after.get(key) or 0) - int(before.get(key) or 0)
        for key in EVAL_OUTCOME_KEYS
    }
    return {
        "ok": True,
        "before": {key: before.get(key) for key in EVAL_OUTCOME_KEYS},
        "after": {key: after.get(key) for key in EVAL_OUTCOME_KEYS},
        "deltas": deltas,
        "note": EVAL_NOTE,
    }


def surfaces_due_reviews(skill_id: str) -> bool:
    from .teach_hint import is_teaching_skill

    return is_teaching_skill(skill_id) or skill_id == "student-concept-visual"


def main(argv: list[str] | None = None) -> int:
    """CLI for skills: add a claim, record an outcome, list due reviews."""
    import argparse
    import json
    import os
    import sys

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(description="Exam-relative retrieval loop")
    parser.add_argument("--user-root", type=Path, default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON")
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add", help="Upsert a teachable claim")
    add.add_argument("--course", required=True)
    add.add_argument("--claim", required=True)
    add.add_argument("--kind", choices=KIND_VALUES, required=True)
    add.add_argument("--assignment-id", default="")
    add.add_argument("--checkpoint-due", default=None)

    outcome = sub.add_parser("outcome", help="Record a retrieval attempt")
    outcome.add_argument("--id", required=True)
    outcome.add_argument("--outcome", choices=OUTCOME_VALUES, required=True)
    outcome.add_argument("--confidence-claimed", action="store_true")
    outcome.add_argument("--same-session", action="store_true")

    sub.add_parser("due", help="Print due reviews (at most two)")
    sub.add_parser("progress", help="Print per-course stability counts")
    evaluate = sub.add_parser(
        "evaluate",
        help="Print a local outcome snapshot (does not write unless --record)",
    )
    evaluate.add_argument(
        "--record",
        action="store_true",
        help="Append one snapshot to inbox/learn/eval-snapshots.jsonl",
    )
    evaluate.add_argument(
        "--compare",
        action="store_true",
        help="Diff the last two recorded snapshots; not a causal claim",
    )

    sub.add_parser(
        "reconcile",
        help="Remap claim checkpoint dates from inbox/courses Checkpoints",
    )

    args = parser.parse_args(argv)
    root = args.user_root or resolve_user_root(
        os.environ.get("PRODUCT_USER_ID", "dev"), create=True
    )

    if args.cmd == "add":
        if args.kind == "workflow":
            print("skipped")
            return 0
        try:
            item = add_item(
                root,
                course=args.course,
                claim=args.claim,
                kind=args.kind,
                assignment_id=args.assignment_id,
                checkpoint_due=args.checkpoint_due,
            )
        except ValueError as exc:
            print(f"skipped: {exc}")
            return 0
        print(item.id)
        return 0
    if args.cmd == "outcome":
        try:
            item = record_outcome(
                root,
                args.id,
                args.outcome,
                confidence_claimed=args.confidence_claimed,
                same_session=args.same_session,
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        payload = item.to_dict()
        payload["stability_delta"] = item.stability_delta
        payload.update(_card_fields(item, _utcnow()))
        if args.json:
            print(json.dumps(payload))
        elif item.stability_delta:
            print(f"{item.id} {item.stability_delta} {item.next_review_at}")
        else:
            print(f"{item.id} {item.stability} {item.next_review_at}")
        return 0
    if args.cmd == "progress":
        if args.json:
            print(json.dumps(progress_payload(root)))
            return 0
        block = render_progress(root)
        if not block:
            print("(none)")
            return 0
        print(block, end="")
        return 0
    if args.cmd == "evaluate":
        if args.record:
            snap = record_evaluation_snapshot(root)
        else:
            snap = evaluation_snapshot(root)
        if args.compare:
            compared = compare_evaluation_snapshots(root)
            print(json.dumps(compared))
            return 0 if compared.get("ok") else 1
        print(json.dumps(snap))
        return 0
    if args.cmd == "reconcile":
        result = reconcile_from_inbox(root)
        if args.json:
            print(json.dumps(result))
        else:
            print(
                f"updated={result['updated']} "
                f"remaps={len(result['remaps'])} "
                f"skipped={len(result['skipped'])}"
            )
        return 0
    if args.json:
        print(json.dumps(due_reviews_payload(root)))
        return 0
    block = render_due_reviews(root)
    if not block:
        print("(none)")
        return 0
    print(block, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
