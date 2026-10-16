"""Permissions matrix + k-success counters.

Canonical homes (do not conflate):
- ``calibration/permissions.yaml`` owns **posture**, **k-counters**, veto notes
- filesystem ``skills/provisional/`` → ``skills/active/`` owns the **skill body**

Pinned category schema — every mutating tool maps to one category. Verification
gate #5 (permissions fuzz) imports these constants; do not author that test
before this module exists.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml

Posture = Literal["automatic", "gated", "never"]

# Categories from the product Permissions Matrix.
CATEGORIES: tuple[str, ...] = (
    "calendar",
    "email_triage",
    "email_draft",
    "email_send",
    "audio_capture",
    "photo_intake",
    "canvas_read",
    "canvas_discussion_draft",
    "canvas_discussion_post",
    "canvas_submit",
    "canvas_quiz_submit",
    "canvas_group",
    "canvas_exam_proctored",
    "lti_submit",
    "proctoring_launch",
    "rsvp_paid",
    "rsvp_free",
    "skill_promotion",
)

# Permanently human-only / refused — not configurable to automatic.
NEVER_AUTO: frozenset[str] = frozenset(
    {
        "canvas_group",
        "canvas_exam_proctored",
        "lti_submit",
        "proctoring_launch",
        "rsvp_paid",
    }
)

# Always require per-instance human confirm — may be gated or never, never automatic.
# Distinct from NEVER_AUTO (which forces posture "never"). Per the 2026-09-13
# addendum to docs/handoff/canvas-focus-pivot-2026-09-11.md. The Canvas-visible
# categories are here too: submit/post tools are preview-only (canvas-focus
# pivot), and no k-success count or hand-edited permissions.yaml may ever turn
# one into a standing automatic posture.
ALWAYS_GATED: frozenset[str] = frozenset(
    {
        "calendar",
        "email_send",
        "canvas_submit",
        "canvas_quiz_submit",
        "canvas_discussion_post",
    }
)

# Hard-refuse tool name fragments (router layer).
PROCTORING_REFUSE: frozenset[str] = frozenset(
    {
        "lockdown",
        "respondus",
        "honorlock",
        "proctorio",
        "proctoru",
    }
)

DEFAULT_POSTURES: dict[str, Posture] = {
    "calendar": "gated",
    "email_triage": "automatic",
    "email_draft": "automatic",
    "email_send": "gated",
    "audio_capture": "automatic",
    "photo_intake": "automatic",
    "canvas_read": "automatic",
    "canvas_discussion_draft": "automatic",
    "canvas_discussion_post": "gated",
    "canvas_submit": "gated",
    "canvas_quiz_submit": "gated",
    "canvas_group": "never",
    "canvas_exam_proctored": "never",
    "lti_submit": "never",
    "proctoring_launch": "never",
    "rsvp_paid": "never",
    "rsvp_free": "automatic",
    "skill_promotion": "gated",
}

# k required clean approvals before a gated category may escalate to automatic.
# email_send and calendar are deliberately absent: per the 2026-09-13 addendum
# to docs/handoff/canvas-focus-pivot-2026-09-11.md, every send/event-write
# requires a fresh per-instance human confirmation, forever — no escalation.
DEFAULT_K: dict[str, int] = {
    "canvas_discussion_post": 3,
    "canvas_submit": 3,
    "canvas_quiz_submit": 5,
    "skill_promotion": 3,
}

PERMISSIONS_SCHEMA_VERSION = 1


@dataclass
class CategoryState:
    posture: Posture
    k_required: int = 0
    k_success: int = 0
    veto_notes: list[str] = field(default_factory=list)


@dataclass
class PermissionsState:
    schema_version: int = PERMISSIONS_SCHEMA_VERSION
    global_stop_until: str | None = None  # ISO-8601 or None
    categories: dict[str, CategoryState] = field(default_factory=dict)
    # Per-course counters for course-scoped gated actions.
    # courses[course_id][category].k_success
    courses: dict[str, dict[str, CategoryState]] = field(default_factory=dict)
    # Skill promotion counters live here (not inside SKILL.md).
    skill_counters: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        def cat_dict(c: CategoryState) -> dict[str, Any]:
            return {
                "posture": c.posture,
                "k_required": c.k_required,
                "k_success": c.k_success,
                "veto_notes": list(c.veto_notes),
            }

        return {
            "schema_version": self.schema_version,
            "global_stop_until": self.global_stop_until,
            "categories": {k: cat_dict(v) for k, v in self.categories.items()},
            "courses": {
                cid: {k: cat_dict(v) for k, v in cats.items()}
                for cid, cats in self.courses.items()
            },
            "skill_counters": dict(self.skill_counters),
        }


def default_permissions() -> PermissionsState:
    cats: dict[str, CategoryState] = {}
    for name in CATEGORIES:
        posture = DEFAULT_POSTURES[name]
        cats[name] = CategoryState(
            posture=posture,
            k_required=DEFAULT_K.get(name, 0),
            k_success=0,
        )
    return PermissionsState(categories=cats)


def _safe_nonnegative_int(value: Any, fallback: int) -> int:
    """Parse persisted counters without letting corrupt YAML crash the gate."""
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    return max(0, parsed)


def _parse_category(raw: dict[str, Any], fallback: CategoryState) -> CategoryState:
    posture = str(raw.get("posture") or fallback.posture)
    if posture not in ("automatic", "gated", "never"):
        posture = fallback.posture
    return CategoryState(
        posture=posture,  # type: ignore[arg-type]
        k_required=_safe_nonnegative_int(raw.get("k_required"), fallback.k_required),
        k_success=_safe_nonnegative_int(raw.get("k_success"), 0),
        veto_notes=[str(x) for x in (raw.get("veto_notes") or [])],
    )


def load_permissions(user_root: Path) -> PermissionsState:
    path = Path(user_root) / "calibration" / "permissions.yaml"
    if not path.is_file():
        state = default_permissions()
        save_permissions(user_root, state)
        return state

    with path.open(encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    if not isinstance(raw, dict):
        return default_permissions()

    base = default_permissions()
    cats = dict(base.categories)
    for name, data in (raw.get("categories") or {}).items():
        if name not in CATEGORIES or not isinstance(data, dict):
            continue
        cats[name] = _parse_category(data, cats[name])
        # Never-auto categories cannot be widened.
        if name in NEVER_AUTO:
            cats[name].posture = "never"
        elif name in ALWAYS_GATED and cats[name].posture == "automatic":
            cats[name].posture = "gated"

    courses: dict[str, dict[str, CategoryState]] = {}
    for cid, course_cats in (raw.get("courses") or {}).items():
        if not isinstance(course_cats, dict):
            continue
        courses[str(cid)] = {}
        for name, data in course_cats.items():
            if name not in CATEGORIES or not isinstance(data, dict):
                continue
            fallback = cats[name]
            parsed = _parse_category(data, fallback)
            if name in NEVER_AUTO:
                parsed.posture = "never"
            elif name in ALWAYS_GATED and parsed.posture == "automatic":
                parsed.posture = "gated"
            courses[str(cid)][name] = parsed

    return PermissionsState(
        schema_version=_safe_nonnegative_int(
            raw.get("schema_version"), PERMISSIONS_SCHEMA_VERSION
        ),
        global_stop_until=raw.get("global_stop_until"),
        categories=cats,
        courses=courses,
        skill_counters={
            str(k): _safe_nonnegative_int(v, 0)
            for k, v in (raw.get("skill_counters") or {}).items()
            if isinstance(k, (str, int, float))
        },
    )


def save_permissions(user_root: Path, state: PermissionsState) -> Path:
    path = Path(user_root) / "calibration" / "permissions.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(state.to_dict(), fh, sort_keys=False, allow_unicode=True)
    return path


def is_global_stopped(state: PermissionsState, *, now_iso: str | None = None) -> bool:
    if not state.global_stop_until:
        return False
    from datetime import datetime, timezone

    try:
        until = datetime.fromisoformat(state.global_stop_until)
    except ValueError:
        return False
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    now = (
        datetime.fromisoformat(now_iso)
        if now_iso
        else datetime.now(timezone.utc)
    )
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now < until


def resolve_posture(
    state: PermissionsState,
    category: str,
    *,
    course_id: str | None = None,
) -> Posture:
    if category not in CATEGORIES:
        return "never"
    if category in NEVER_AUTO:
        return "never"
    if is_global_stopped(state):
        return "never"
    if course_id and course_id in state.courses and category in state.courses[course_id]:
        posture = state.courses[course_id][category].posture
    else:
        posture = state.categories[category].posture
    if category in ALWAYS_GATED and posture == "automatic":
        return "gated"
    return posture


def allow_write(
    state: PermissionsState,
    category: str,
    *,
    course_id: str | None = None,
    confirmed: bool = False,
) -> tuple[bool, str]:
    """Return (allowed, reason).

    automatic → allowed without confirm
    gated → allowed only when ``confirmed``
    never → refused
    """
    if category in NEVER_AUTO or category not in CATEGORIES:
        return False, f"Category {category!r} is permanently human-only."
    if is_global_stopped(state):
        return False, "Global STOP is active; all writes paused."
    if any(frag in category.lower() for frag in PROCTORING_REFUSE):
        return False, "Proctoring tools are refused at the router."

    posture = resolve_posture(state, category, course_id=course_id)
    if posture == "never":
        return False, f"Category {category!r} is set to never."
    if posture == "automatic":
        return True, "automatic"
    if confirmed:
        return True, "gated-confirmed"
    return False, f"Category {category!r} requires permission (gated)."


def bump_k_success(
    state: PermissionsState,
    category: str,
    *,
    course_id: str | None = None,
) -> PermissionsState:
    """Increment k_success after a clean approval. May escalate posture."""
    state = deepcopy(state)
    if course_id:
        course_cats = state.courses.setdefault(course_id, {})
        cat = course_cats.get(category) or deepcopy(state.categories[category])
        cat.k_success += 1
        if (
            cat.posture == "gated"
            and cat.k_required > 0
            and cat.k_success >= cat.k_required
            and category not in NEVER_AUTO
            and category not in ALWAYS_GATED
        ):
            cat.posture = "automatic"
        course_cats[category] = cat
    else:
        cat = state.categories[category]
        cat.k_success += 1
        if (
            cat.posture == "gated"
            and cat.k_required > 0
            and cat.k_success >= cat.k_required
            and category not in NEVER_AUTO
            and category not in ALWAYS_GATED
        ):
            cat.posture = "automatic"
    return state


def refuse_proctoring_tool(tool_name: str) -> bool:
    """True when the tool name matches a hard-refuse proctoring adapter."""
    lowered = tool_name.lower()
    return any(frag in lowered for frag in PROCTORING_REFUSE)
