"""Copy a synthetic persona into a fresh user root for audits and harness runs.

    uv run python tests/fixtures/synthetic-students/make_root.py avery-chen --week dense
    DEV_USER_ROOT=var/audit-user-roots/avery-chen uv run python -m canvas_mcp.core.gpa

Output defaults to ``var/audit-user-roots/<persona>/`` (gitignored). The
factory refuses any output under the OS app-support root so a run can never
touch a real student profile. It never writes feed URLs or credentials.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "src"))

from canvas_mcp.core.user_root import (  # noqa: E402
    default_app_support_root,
    ensure_user_root,
)

WEEKS = {"normal": "week.md", "stale": "week-stale.md", "dense": "week-dense.md"}

# persona file → user-root path. Missing sources are skipped (Blake has only USER.md).
LAYOUT = {
    "USER.md": "USER.md",
    "grades.yaml": "inbox/grades.yaml",
    "degree-audit.md": "inbox/degree-audit.md",
    "credit-hours.yaml": "calibration/credit-hours.yaml",
    "completed-terms.yaml": "calibration/completed-terms.yaml",
    "study-packet.json": "fixture-packets/study-packet.json",
}


def personas() -> list[str]:
    return sorted(p.name for p in HERE.iterdir() if (p / "USER.md").is_file())


def build(
    persona: str,
    out: Path,
    *,
    week: str = "normal",
    with_audit: bool = True,
    clean: bool = True,
    now: datetime | None = None,
) -> Path:
    src = HERE / persona
    if not (src / "USER.md").is_file():
        raise SystemExit(f"unknown persona {persona!r}; have {personas()}")
    out = out.expanduser().resolve()
    support = default_app_support_root().resolve()
    if out == support or support in out.parents:
        raise SystemExit(f"refusing to write under the real app-support root: {support}")
    if clean and out.exists():
        shutil.rmtree(out)
    ensure_user_root(out)

    for name, rel in LAYOUT.items():
        if name == "degree-audit.md" and not with_audit:
            continue
        path = src / name
        if path.is_file():
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)

    # Onboarding writes the slug twice: USER.md (Python) and school_slug (Rust,
    # read by habit's timezone). Mirror both so either reader sees the persona.
    slug = re.search(r"\*\*School slug:\*\*\s*(\S+)", (src / "USER.md").read_text(encoding="utf-8"))
    if slug:
        (out / "school_slug").write_text(slug.group(1), encoding="utf-8")

    week_src = src / WEEKS[week]
    if week_src.is_file():
        shutil.copy2(week_src, out / "inbox" / "week.md")
    courses = src / "courses"
    if courses.is_dir():
        for path in sorted(courses.glob("*.md")):
            shutil.copy2(path, out / "inbox" / "courses" / path.name)
    write_study_sources(src, out, now or datetime.now(timezone.utc))
    return out


def write_study_sources(src: Path, out: Path, now: datetime) -> None:
    """Resolve the persona's relative due dates against `now` so briefs (and
    Today) see a live week: ``cd browser && DEV_USER_ROOT=<out> npm run briefs``."""
    path = src / "study-sources.json"
    if not path.is_file():
        return
    iso = lambda hours: (now + timedelta(hours=hours)).isoformat(timespec="seconds").replace("+00:00", "Z")  # noqa: E731
    dest = out / "inbox" / "study-sources"
    dest.mkdir(parents=True, exist_ok=True)
    for rec in json.loads(path.read_text(encoding="utf-8"))["courses"]:
        cid = rec["course"]["id"]
        for item in rec["items"]:
            item["due_at"] = iso(item.pop("due_in_hours")) if "due_in_hours" in item else None
            item.setdefault("course_id", cid)
            item.setdefault("completed", False)
            item.setdefault("html_url", f"https://canvas.example.edu/courses/{cid}/assignments/{item['canvas_id']}")
        for exam in rec.get("exams", []):
            exam["due_at"] = iso(exam.pop("due_in_hours")) if "due_in_hours" in exam else None
        record = {"schema": 2, "fetched_at": iso(-1), "term": None, "generated_items": [], "truncated": False, **rec}
        (dest / f"{cid}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("persona", choices=personas())
    parser.add_argument("--week", choices=sorted(WEEKS), default="normal")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--no-audit", action="store_true", help="omit inbox/degree-audit.md")
    args = parser.parse_args(argv)
    out = args.out or REPO / "var" / "audit-user-roots" / args.persona
    root = build(args.persona, out, week=args.week, with_audit=not args.no_audit)
    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
