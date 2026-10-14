"""Parse student-pasted Buff Portal / DegreeWorks audit text.

Never scrapes live SIS HTML. Requirement claims must cite imported_on.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .skill_router import parse_frontmatter

STALE_DAYS = 90

_SECTION_RE = re.compile(
    r"(?im)^\s*#{0,3}\s*(complete|completed|in[- ]?progress|unmet|not complete|still needed|"
    r"unfulfilled|remaining)\s*:?\s*$"
)
_CREDITS_RE = re.compile(
    r"(?i)(?:credits?\s+(?:still\s+)?(?:needed|remaining|required)|"
    r"remaining\s+credits?|hours?\s+needed)\s*[:=]?\s*(\d+(?:\.\d+)?)"
)


@dataclass
class DegreeAudit:
    imported_on: date | None
    catalog_year: str
    source: str
    body: str
    sections: dict[str, str] = field(default_factory=dict)
    remaining_credits: float | None = None
    stale: bool = False
    stale_days: int | None = None

    def banner(self) -> str:
        if not self.imported_on:
            return (
                "Degree audit import missing imported_on — treat all requirement "
                "claims as unverified; confirm in Buff Portal."
            )
        stamp = self.imported_on.isoformat()
        if self.stale:
            return (
                f"As of {stamp} (stale — >{STALE_DAYS} days), confirm every "
                "requirement claim in Buff Portal before registering."
            )
        return (
            f"As of {stamp} (catalog year {self.catalog_year or 'unknown'}) — "
            "confirm in Buff Portal before registering."
        )


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def split_sections(body: str) -> dict[str, str]:
    """Best-effort splitter on Complete / In-progress / Unmet headings.

    A real audit export commonly repeats a heading once per requirement
    block (multiple "Unmet"/"Still needed" blocks); normalized keys are
    appended rather than overwritten so a later block never silently
    discards an earlier one's text.
    """
    text = body or ""
    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        return {"body": text.strip()}

    sections: dict[str, str] = {}
    for i, match in enumerate(matches):
        key = _normalize_section_key(match.group(1))
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end].strip()
        if not chunk:
            continue
        if key in sections:
            sections[key] = f"{sections[key]}\n\n{chunk}"
        else:
            sections[key] = chunk
    return sections


def _normalize_section_key(label: str) -> str:
    low = re.sub(r"[^a-z]+", "", label.lower())
    if low.startswith("complete") and "inprogress" not in low:
        return "complete"
    if "progress" in low:
        return "in_progress"
    return "unmet"


# Template hints like "(optional number — e.g. `Remaining credits: 42`)" are
# examples, not the student's total.
_EXAMPLE_HINT_RE = re.compile(r"\([^()]*\be\.g\.[^()]*\)", re.IGNORECASE)


def extract_remaining_credits(text: str) -> float | None:
    match = _CREDITS_RE.search(_EXAMPLE_HINT_RE.sub("", text or ""))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def load_degree_audit(
    path: Path,
    *,
    today: date | None = None,
) -> DegreeAudit | None:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(text)
    imported = _parse_date(str(fm.get("imported_on") or ""))
    now = today or date.today()
    stale = False
    stale_days: int | None = None
    if imported:
        stale_days = (now - imported).days
        stale = stale_days > STALE_DAYS
    sections = split_sections(body)
    # Prefer the "unmet" section for the remaining-credits total — a stray
    # "N credits needed" phrase inside an already-satisfied block elsewhere
    # in the paste must not outrank the actual outstanding total.
    remaining = extract_remaining_credits(sections.get("unmet", ""))
    if remaining is None:
        remaining = extract_remaining_credits(body)
    return DegreeAudit(
        imported_on=imported,
        catalog_year=str(fm.get("catalog_year") or "").strip(),
        source=str(fm.get("source") or "buff-portal-paste").strip(),
        body=body.strip(),
        sections=sections,
        remaining_credits=remaining,
        stale=stale,
        stale_days=stale_days,
    )


def pacing_credits_per_term(
    remaining_credits: float | None,
    terms_remaining: int | None,
) -> float | None:
    """Credits/term needed to hit a target term. None if inputs missing."""
    if remaining_credits is None or terms_remaining is None:
        return None
    if terms_remaining <= 0:
        return None
    return round(remaining_credits / terms_remaining, 2)


def audit_to_dict(audit: DegreeAudit) -> dict[str, Any]:
    return {
        "imported_on": audit.imported_on.isoformat() if audit.imported_on else None,
        "catalog_year": audit.catalog_year,
        "source": audit.source,
        "stale": audit.stale,
        "stale_days": audit.stale_days,
        "banner": audit.banner(),
        "remaining_credits": audit.remaining_credits,
        "sections": {k: v[:2000] for k, v in audit.sections.items()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse dated degree-audit import")
    parser.add_argument("--user-root", type=Path, default=None)
    parser.add_argument(
        "--path",
        type=Path,
        default=None,
        help="Explicit degree-audit.md path (default: {user_root}/inbox/degree-audit.md)",
    )
    args = parser.parse_args(argv)
    if args.path:
        path = args.path
    else:
        if args.user_root:
            root = args.user_root
        else:
            from .user_root import resolve_user_root

            root = resolve_user_root("dev", create=False)
        path = root / "inbox" / "degree-audit.md"

    audit = load_degree_audit(path)
    import json

    if audit is None:
        print(json.dumps({"error": "missing", "path": str(path)}, indent=2))
        return 1
    print(json.dumps(audit_to_dict(audit), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
