"""Save a degree-audit copy the student pasted from their own portal.

Writes ``{user_root}/inbox/degree-audit.md`` in the dated, sectioned shape that
``degree_audit.py`` and ``advisor.rs`` read (docs/handoff/degree-planning-scope-2026-09-13.md).
The student pastes each section separately, so nothing is guessed from an
unstructured blob: an empty section stays empty, never "complete". The previous
copy is kept as ``degree-audit.prev.md``. Standard library only; no portal login.
"""

from __future__ import annotations

import os
import re
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

from .model import StudyError, write_private_text

MAX_SECTION_CHARS = 20_000
MAX_LINES = 300
_YEAR_RE = re.compile(r"^\d{4}\s*-\s*\d{4}$")


def audit_path(user_root: Path) -> Path:
    return Path(user_root) / "inbox" / "degree-audit.md"


def _bullets(text: Any, field: str) -> list[str]:
    raw = str(text or "")
    if len(raw) > MAX_SECTION_CHARS:
        raise StudyError("validation", f"{field} is too long to be one audit section")
    out: list[str] = []
    for line in raw.splitlines():
        item = line.strip().lstrip("-*•").strip()
        # Front-matter or heading markers in a paste would change how the file is read.
        item = item.replace("---", "-").lstrip("#").strip()
        if item:
            out.append(item[:300])
    return out[:MAX_LINES]


def _taken_on(value: Any, today: date) -> date:
    raw = str(value or "").strip()
    if not raw:
        return today
    try:
        taken = date.fromisoformat(raw)
    except ValueError as exc:
        raise StudyError("validation", "The date the audit was taken should look like 2026-10-13.") from exc
    if taken > today:
        raise StudyError("validation", "The audit can't be from the future.")
    return taken


def write_audit(user_root: Path, params: dict[str, Any], *, today: date | None = None) -> dict[str, Any]:
    now = today or date.today()
    taken = _taken_on(params.get("taken_on"), now)
    catalog = " ".join(str(params.get("catalog_year") or "").split())
    if catalog and not _YEAR_RE.match(catalog):
        raise StudyError("validation", "Catalog year should look like 2025-2026.")
    complete = _bullets(params.get("complete"), "Complete")
    in_progress = _bullets(params.get("in_progress"), "In progress")
    still_needed = _bullets(params.get("still_needed"), "Still needed")
    credits_raw = params.get("remaining_credits")
    credits: float | None = None
    if credits_raw not in (None, ""):
        try:
            credits = float(credits_raw)
        except (TypeError, ValueError) as exc:
            raise StudyError("validation", "Credits left should be a number.") from exc
        if not 0 <= credits <= 300:
            raise StudyError("validation", "Credits left should be between 0 and 300.")
    if not (complete or in_progress or still_needed) and credits is None:
        raise StudyError("validation", "Paste at least one section of your audit.")

    def section(title: str, items: list[str]) -> str:
        return f"## {title}\n\n" + ("\n".join(f"- {i}" for i in items) if items else "(nothing pasted)") + "\n"

    credit_line = f"- Remaining credits: {credits:g}\n" if credits is not None else ""
    body = (
        "---\n"
        f"imported_on: {taken.isoformat()}\n"
        f'catalog_year: "{catalog}"\n'
        "source: student-paste\n"
        "---\n\n"
        "# Degree audit import\n\n"
        f"Pasted by the student from their own audit taken {taken.isoformat()}. Kairos never logs in to the student portal.\n\n"
        + section("Complete", complete)
        + "\n"
        + section("In-progress", in_progress)
        + "\n"
        + section("Unmet", still_needed)
        + "\n## Notes\n\n"
        + credit_line
    )
    path = audit_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        os.replace(path, path.with_name("degree-audit.prev.md"))
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, path)
    return {
        "saved": str(path.name),
        "imported_on": taken.isoformat(),
        "counts": {"complete": len(complete), "in_progress": len(in_progress), "still_needed": len(still_needed)},
    }


# ------------------------------------------------------------------ profile lines

PROFILE_FIELDS = {
    "program": "Declared major(s)",
    "catalog_year": "Catalog year",
    "target_term": "Target grad term",
}


def update_profile_fields(user_root: Path, params: dict[str, Any]) -> dict[str, Any]:
    """Set only the Program lines Advisor reads in ``USER.md``; every other line is left alone."""
    path = Path(user_root) / "USER.md"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = ["# USER.md", ""]
    changed: dict[str, str] = {}
    for key, label in PROFILE_FIELDS.items():
        if key not in params:
            continue
        value = " ".join(str(params.get(key) or "").split())[:120].replace("**", "")
        if key == "catalog_year" and value and not _YEAR_RE.match(value):
            raise StudyError("validation", "Catalog year should look like 2025-2026.")
        line = f"- **{label}:** {value}"
        for i, existing in enumerate(lines):
            if existing.strip().lstrip("- ").startswith(f"**{label}:**"):
                lines[i] = line
                break
        else:
            try:
                at = next(i for i, ln in enumerate(lines) if ln.strip() == "## Program") + 1
                while at < len(lines) and not lines[at].strip():
                    at += 1
            except StopIteration:
                lines += ["", "## Program", ""]
                at = len(lines)
            lines.insert(at, line)
        changed[key] = value
    if not changed:
        raise StudyError("validation", "Nothing to save.")
    write_private_text(path, "\n".join(lines).rstrip("\n") + "\n")
    return {"saved": changed}
