"""Local GPA estimates from Canvas grades + student credit-hours.

Pure arithmetic. Never writes synced files. Not official transcript / SAP /
major GPA — always label output as a local estimate.
"""

from __future__ import annotations

import argparse
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# US 4.0 fallback when schools/{slug}.yaml omits grade_scale.
DEFAULT_GRADE_SCALE: dict[str, float] = {
    "A+": 4.0,
    "A": 4.0,
    "A-": 3.7,
    "B+": 3.3,
    "B": 3.0,
    "B-": 2.7,
    "C+": 2.3,
    "C": 2.0,
    "C-": 1.7,
    "D+": 1.3,
    "D": 1.0,
    "D-": 0.7,
    "F": 0.0,
}

# Non-quality grades excluded from quality hours (CU catalog-aligned set + common).
EXCLUDED_LETTERS = frozenset(
    {
        "P",
        "P+",
        "NC",
        "W",
        "I",
        "IP",
        "S",
        "U",
        "T",
        "AU",
        "NR",
        "N/A",
        "NA",
        "",
    }
)


@dataclass(frozen=True)
class CourseGrade:
    code: str
    letter: str
    credits: float | None = None
    name: str = ""
    percent: float | None = None


@dataclass
class GpaResult:
    gpa: float | None
    quality_points: float
    quality_hours: float
    included: list[CourseGrade] = field(default_factory=list)
    skipped: list[tuple[CourseGrade, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.gpa is not None and self.quality_hours > 0


def normalize_letter(letter: str | None) -> str:
    raw = str(letter or "").strip().upper()
    # Canvas sometimes returns "A-" with weird spaces or "A -".
    raw = re.sub(r"\s+", "", raw)
    return raw


def _build_scale_table(scale: Mapping[str, float]) -> dict[str, float]:
    return {normalize_letter(k): float(v) for k, v in scale.items()}


def _build_credit_lookup(credit_hours: Mapping[str, float]) -> dict[str, float]:
    return {_norm_code(k): float(v) for k, v in credit_hours.items()}


def letter_to_points(
    letter: str | None,
    scale: Mapping[str, float] | None = None,
) -> float | None:
    """Map a letter grade to quality points. Unknown → None (caller skips)."""
    norm = normalize_letter(letter)
    if not norm or norm in EXCLUDED_LETTERS:
        return None
    table = _build_scale_table(scale or DEFAULT_GRADE_SCALE)
    return table.get(norm)


def missing_credits(
    codes: list[str],
    credit_hours: Mapping[str, float],
) -> list[str]:
    lookup = _build_credit_lookup(credit_hours)
    missing: list[str] = []
    for code in codes:
        key = _norm_code(code)
        if key not in lookup:
            missing.append(code)
    return missing


def _norm_code(code: str) -> str:
    raw = str(code or "").upper()
    match = re.search(r"[A-Z]{2,8}\s*[-_ ]?\s*\d{3,5}", raw)
    if match:
        return re.sub(r"[^A-Z0-9]", "", match.group(0))
    return re.sub(r"[^A-Z0-9]", "", raw)


def term_gpa(
    courses: list[CourseGrade],
    credit_hours: Mapping[str, float] | None = None,
    scale: Mapping[str, float] | None = None,
) -> GpaResult:
    """Σ(quality points × credits) / Σ(credits) for one term."""
    hours_map = credit_hours or {}
    scale_map = scale or DEFAULT_GRADE_SCALE
    scale_table = _build_scale_table(scale_map)
    hours_lookup = _build_credit_lookup(hours_map)
    included: list[CourseGrade] = []
    skipped: list[tuple[CourseGrade, str]] = []
    qp = 0.0
    qh = 0.0

    for course in courses:
        letter = normalize_letter(course.letter)
        if letter in EXCLUDED_LETTERS:
            if not letter and course.percent is not None:
                reason = f"letter grade unavailable (percent {course.percent:g})"
            else:
                reason = f"non-quality grade {letter or '(empty)'}"
            skipped.append((course, reason))
            continue
        points = scale_table.get(letter)
        if points is None:
            skipped.append((course, f"unknown letter {letter or '(empty)'}"))
            continue
        if course.credits is not None:
            try:
                credits = float(course.credits)
            except (TypeError, ValueError):
                credits = None
        else:
            credits = hours_lookup.get(_norm_code(course.code))
        if credits is None:
            skipped.append((course, "missing credit hours"))
            continue
        included.append(
            CourseGrade(
                code=course.code,
                letter=letter,
                credits=credits,
                name=course.name,
                percent=course.percent,
            )
        )
        qp += points * credits
        qh += credits

    gpa = round(qp / qh, 3) if qh > 0 else None
    return GpaResult(
        gpa=gpa,
        quality_points=round(qp, 3),
        quality_hours=round(qh, 3),
        included=included,
        skipped=skipped,
    )


def cumulative_gpa(
    completed_terms: list[list[CourseGrade]],
    current: list[CourseGrade] | None = None,
    credit_hours: Mapping[str, float] | None = None,
    scale: Mapping[str, float] | None = None,
) -> GpaResult:
    """Merge prior terms + optional current-term courses into one GPA."""
    merged: list[CourseGrade] = []
    for term in completed_terms:
        merged.extend(term)
    if current:
        merged.extend(current)
    return term_gpa(merged, credit_hours=credit_hours, scale=scale)


def what_if(
    base_courses: list[CourseGrade],
    overrides: Mapping[str, str],
    credit_hours: Mapping[str, float] | None = None,
    scale: Mapping[str, float] | None = None,
    extra: list[CourseGrade] | None = None,
) -> GpaResult:
    """Local override map (code → letter). Never mutates synced grade files.

    Preserves every base course (including a repeated code, e.g. a retake
    recorded once per term) rather than collapsing by code — an override
    for one course must not silently drop an unrelated duplicate entry.
    """
    norm_overrides = {_norm_code(code): letter for code, letter in overrides.items()}
    matched_codes: set[str] = set()
    courses: list[CourseGrade] = []
    for course in base_courses:
        key = _norm_code(course.code)
        if key in norm_overrides:
            matched_codes.add(key)
            courses.append(
                CourseGrade(
                    code=course.code,
                    letter=norm_overrides[key],
                    credits=course.credits,
                    name=course.name,
                )
            )
        else:
            courses.append(course)
    for code, letter in overrides.items():
        if _norm_code(code) not in matched_codes:
            courses.append(CourseGrade(code=code, letter=letter))
    if extra:
        courses.extend(extra)
    return term_gpa(courses, credit_hours=credit_hours, scale=scale)


def load_credit_hours(path: Path) -> dict[str, float]:
    if not path.is_file():
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for k, v in raw.items():
        if str(k).startswith("#"):
            continue
        try:
            out[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def load_completed_terms(path: Path) -> list[list[CourseGrade]]:
    if not path.is_file():
        return []
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError:
        return []
    terms_raw = raw.get("terms") if isinstance(raw, dict) else raw
    if not isinstance(terms_raw, list):
        return []
    terms: list[list[CourseGrade]] = []
    for term in terms_raw:
        if not isinstance(term, dict):
            continue
        courses: list[CourseGrade] = []
        for row in term.get("courses") or []:
            if not isinstance(row, dict) or not row.get("code"):
                continue
            credits = row.get("credits")
            try:
                credits_f = float(credits) if credits is not None else None
            except (TypeError, ValueError):
                credits_f = None
            courses.append(
                CourseGrade(
                    code=str(row["code"]),
                    letter=str(row.get("letter") or ""),
                    credits=credits_f,
                    name=str(row.get("name") or ""),
                    percent=float(row["percent"]) if row.get("percent") is not None else None,
                )
            )
        if courses:
            terms.append(courses)
    return terms


def load_grades_yaml(path: Path) -> list[CourseGrade]:
    if not path.is_file():
        return []
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError:
        return []
    if not isinstance(raw, dict):
        return []
    courses: list[CourseGrade] = []
    for row in raw.get("courses") or []:
        if not isinstance(row, dict) or not row.get("code"):
            continue
        courses.append(
            CourseGrade(
                code=str(row["code"]),
                letter=str(row.get("letter") or ""),
                name=str(row.get("name") or ""),
                percent=float(row["percent"]) if row.get("percent") is not None else None,
            )
        )
    return courses


def scale_for_school(slug: str | None) -> dict[str, float]:
    if not slug:
        return dict(DEFAULT_GRADE_SCALE)
    try:
        from .tenants import load_school

        school = load_school(slug)
        if school.grade_scale:
            return dict(school.grade_scale)
    except (ImportError, OSError, ValueError, TypeError):
        # A missing or malformed optional school profile falls back to the
        # standard scale; never let a personalization file break GPA display.
        return dict(DEFAULT_GRADE_SCALE)
    return dict(DEFAULT_GRADE_SCALE)


def estimate_from_user_root(
    user_root: Path,
    *,
    school_slug: str | None = None,
    overrides: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Convenience for skills/CLI: read inbox + calibration, return summary dict."""
    root = Path(user_root)
    credits = load_credit_hours(root / "calibration" / "credit-hours.yaml")
    history = load_completed_terms(root / "calibration" / "completed-terms.yaml")
    current = load_grades_yaml(root / "inbox" / "grades.yaml")
    scale = scale_for_school(school_slug)

    term = term_gpa(current, credit_hours=credits, scale=scale)
    cum = cumulative_gpa(history, current=current, credit_hours=credits, scale=scale)
    what_if_result = None
    if overrides:
        base = []
        for term_courses in history:
            base.extend(term_courses)
        base.extend(current)
        what_if_result = what_if(base, overrides, credit_hours=credits, scale=scale)

    missing = missing_credits([c.code for c in current], credits)
    return {
        "label": "local estimate from Canvas + credit-hours.yaml — not official transcript/SAP",
        "term": _result_dict(term),
        "cumulative": _result_dict(cum),
        "what_if": _result_dict(what_if_result) if what_if_result else None,
        "missing_credit_hours": missing,
    }


def _result_dict(result: GpaResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {
        "gpa": result.gpa,
        "quality_points": result.quality_points,
        "quality_hours": result.quality_hours,
        "included": [
            {"code": c.code, "letter": c.letter, "credits": c.credits, "percent": c.percent}
            for c in result.included
        ],
        "skipped": [
            {"code": c.code, "letter": c.letter, "percent": c.percent, "reason": reason}
            for c, reason in result.skipped
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local GPA estimate (read-only)")
    parser.add_argument(
        "--user-root",
        type=Path,
        help="User root containing inbox/ and calibration/",
    )
    parser.add_argument("--school", default=None, help="School slug for grade_scale")
    parser.add_argument(
        "--what-if",
        action="append",
        default=[],
        metavar="CODE=LETTER",
        help="Local override (repeatable); never writes files",
    )
    args = parser.parse_args(argv)
    if not args.user_root:
        from .user_root import resolve_user_root

        root = resolve_user_root("dev", create=False)
    else:
        root = args.user_root

    overrides: dict[str, str] = {}
    for item in args.what_if:
        if "=" not in item:
            raise SystemExit(f"Bad --what-if {item!r}; expected CODE=LETTER")
        code, _, letter = item.partition("=")
        overrides[code.strip()] = letter.strip()

    import json

    print(
        json.dumps(
            estimate_from_user_root(
                root,
                school_slug=args.school,
                overrides=overrides or None,
            ),
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
