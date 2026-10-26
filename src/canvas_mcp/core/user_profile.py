"""Write onboarding-collected identity/program answers into USER.md.

USER.md is agent-read context (see AGENTS.md "Brain: USER.md triage"), never
machine-parsed by GPA/course-plan/degree-progress code — this only needs to
render well-formed markdown matching the ``templates/USER.md`` section
shape, the same way ``learning_profile.py`` already owns "## Learning
profile". Before this module existed, onboarding never wrote these
sections at all (audit finding, 2026-09-13): the template said "written
during onboarding" but only "## Learning profile" and a flat
``priorities.txt`` were ever populated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .private_files import write_private_text

_REPO_ROOT = Path(__file__).resolve().parents[3]
_USER_MD_TEMPLATE = _REPO_ROOT / "templates" / "USER.md"
_CALIBRATION_TEMPLATES = (
    "priority-rubric.md",
    "credit-hours.yaml",
    "completed-terms.yaml",
    "courses-of-interest.md",
)

_MIN_RANKED_LINES = 3
_MAX_AIM_ITEMS = 12
_MAX_AIM_CHARS = 120
_ADD_IN_SETTINGS = "(add in Settings)"
_YEARS_AT_SCHOOL_RE = re.compile(
    r"-\s*\*\*Years at school \(goal\):\*\*\s*(.+)",
    re.IGNORECASE,
)


@dataclass
class OnboardingIdentity:
    name: str = ""
    institution: str = ""
    school_slug: str = ""
    major: str = ""
    minor: str = ""
    catalog_year: str = ""
    target_grad_term: str = ""
    interests: list[str] = field(default_factory=list)
    good_standing_gpa: str = ""
    scholarship_min_gpa: str = ""
    career_priorities: list[str] = field(default_factory=list)
    values: list[str] = field(default_factory=list)
    transfer_notes: str = ""


def _seed_user_md_if_missing(user_md: Path) -> None:
    """Onboarding may save identity before USER.md exists (mirrors
    learning_profile._seed_user_md_if_missing — kept separate here since that
    one is private to its own module's ``_USER_MD_HEADING`` contract)."""
    if user_md.is_file():
        return
    user_md.parent.mkdir(parents=True, exist_ok=True)
    if _USER_MD_TEMPLATE.is_file():
        body = _USER_MD_TEMPLATE.read_text(encoding="utf-8")
    else:
        body = "# USER.md\n\n## Identity\n\n"
    write_private_text(user_md, body)


def _seed_calibration_files(user_root: Path) -> None:
    """Create missing student-owned calibration files without overwriting edits."""
    calibration = Path(user_root) / "calibration"
    calibration.mkdir(parents=True, exist_ok=True)
    for name in _CALIBRATION_TEMPLATES:
        target = calibration / name
        source = _REPO_ROOT / "templates" / "calibration" / name
        if target.exists() or not source.is_file():
            continue
        write_private_text(target, source.read_text(encoding="utf-8"))


def _replace_section(text: str, heading: str, block: str) -> str:
    """Replace one ``## Heading`` section's body, up to the next ``## `` or EOF."""
    heading_idx = text.find(heading)
    if heading_idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        return f"{text}{sep}\n{block}"
    next_idx = text.find("\n## ", heading_idx + len(heading))
    before = text[:heading_idx]
    after = text[next_idx:] if next_idx != -1 else ""
    return f"{before}{block}{after}"


def _ranked_block(heading: str, items: list[str]) -> str:
    filled = [item.strip() for item in items if item.strip()]
    count = max(len(filled), _MIN_RANKED_LINES)
    lines = [heading, ""]
    for i in range(count):
        lines.append(f"{i + 1}. {filled[i] if i < len(filled) else ''}")
    return "\n".join(lines) + "\n"


def _institution_for(identity: OnboardingIdentity, user_root: Path) -> str:
    """Prefer explicit institution; else schools/{slug}.yaml display_name.

    The fallback reads the school saved under ``user_root`` (the profile being
    written), never the process's boot profile: onboarding one student must
    not stamp another student's school into their USER.md (finding F16).
    """
    if identity.institution.strip():
        return identity.institution.strip()
    slug = identity.school_slug.strip()
    if not slug or slug == "waitlist":
        return ""
    try:
        from .tenants import load_school

        return load_school(slug).display_name.strip()
    except (FileNotFoundError, OSError, ValueError):
        pass
    # A school discovered at onboarding has no curated yaml; use the saved profile.
    try:
        from .tenants import school_for_user

        school = school_for_user(Path(user_root))
        return school.display_name.strip() if school else ""
    except (OSError, ValueError, TypeError):
        return ""


def _existing_years_at_school(text: str) -> str:
    """Keep template/prior Years-at-school when onboarding does not collect it."""
    match = _YEARS_AT_SCHOOL_RE.search(text)
    if not match:
        return "(e.g. 4)"
    value = match.group(1).strip()
    return value or "(e.g. 4)"


def apply_onboarding_identity(user_root: Path, identity: OnboardingIdentity) -> Path:
    """Render Identity/Program/Interests/Academic floors/Career priorities/
    Values/Transfer notes into USER.md, leaving every other section
    (Advising notes, Throwaway, Learning profile, Automation posture,
    Communication preferences) untouched. Empty Values leaves that section
    alone instead of overwriting with a multi-select placeholder."""
    user_md = Path(user_root) / "USER.md"
    _seed_user_md_if_missing(user_md)
    _seed_calibration_files(user_root)
    text = user_md.read_text(encoding="utf-8", errors="replace")
    years_at_school = _existing_years_at_school(text)
    institution = _institution_for(identity, user_root)

    goals = ", ".join(p.strip() for p in identity.career_priorities if p.strip())
    identity_block = (
        "## Identity\n\n"
        f"- **Student:** {identity.name.strip() or '(name)'}\n"
        f"- **Institution:** {institution or '(from school registry)'}\n"
        f"- **School slug:** {identity.school_slug.strip() or '(unset)'}\n"
        f"- **Goals:** {goals or _ADD_IN_SETTINGS}\n"
    )
    text = _replace_section(text, "## Identity", identity_block)

    program_block = (
        "## Program\n\n"
        f"- **Declared major(s):** {identity.major.strip() or _ADD_IN_SETTINGS}\n"
        f"- **Minor(s) / certificate(s):** {identity.minor.strip() or '(optional)'}\n"
        "- **Catalog year:** "
        f"{identity.catalog_year.strip() or '(student-stated — from Buff Portal; not inferred from Canvas)'}\n"
        f"- **Target grad term:** {identity.target_grad_term.strip() or '(e.g. Spring 2028)'}\n"
        f"- **Years at school (goal):** {years_at_school}\n"
    )
    text = _replace_section(text, "## Program", program_block)

    text = _replace_section(
        text, "## Interests (ranked)", _ranked_block("## Interests (ranked)", identity.interests)
    )

    floors_block = (
        "## Academic floors\n\n"
        "Student-supplied targets only — not official eligibility rulings. "
        "Confirm scholarships/SAP with Scholarship Services / Financial Aid.\n\n"
        f"- **Good-standing target GPA:** {identity.good_standing_gpa.strip() or '2.0'}\n"
        "- **Scholarship min GPA:** "
        f"{identity.scholarship_min_gpa.strip() or '(optional — from award terms)'}\n"
        "- **Grad-school / other floor:** (optional)\n"
    )
    text = _replace_section(text, "## Academic floors", floors_block)

    text = _replace_section(
        text,
        "## Career priorities (ranked)",
        _ranked_block("## Career priorities (ranked)", identity.career_priorities),
    )

    values_filled = [v.strip() for v in identity.values if v.strip()]
    if values_filled:
        values_block = "## Values about college\n\n" + "\n".join(
            f"- {v}" for v in values_filled
        ) + "\n"
        text = _replace_section(text, "## Values about college", values_block)

    if identity.transfer_notes.strip():
        notes = [
            f"- {line.strip()}"
            for line in identity.transfer_notes.splitlines()
            if line.strip()
        ]
        transfer_block = "## Transfer / credit notes\n\n" + "\n".join(notes) + "\n"
        text = _replace_section(text, "## Transfer / credit notes", transfer_block)

    write_private_text(user_md, text)
    return user_md


def _clean_items(items: list[str] | None) -> list[str] | None:
    """None means the caller did not send this list. A sent list drops blanks."""
    if items is None:
        return None
    cleaned: list[str] = []
    for raw in items:
        text = " ".join(str(raw).split())
        text = text.replace("**", "").replace(";", ",").lstrip("#").strip()
        if not text:
            continue
        cleaned.append(text[:_MAX_AIM_CHARS])
        if len(cleaned) >= _MAX_AIM_ITEMS:
            break
    return cleaned


def _set_bold_line(text: str, label: str, value: str) -> str:
    """Replace one `- **Label:**` line, or insert it under `## Identity`."""
    pattern = re.compile(
        rf"^([ \t]*-[ \t]*\*\*{re.escape(label)}:\*\*[ \t]*)(.*)$",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if match:
        return text[: match.start(2)] + value + text[match.end(2) :]
    line = f"- **{label}:** {value}\n"
    heading = "## Identity"
    idx = text.find(heading)
    if idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        return f"{text}{sep}\n{heading}\n\n{line}"
    next_idx = text.find("\n## ", idx + len(heading))
    if next_idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        return f"{text}{sep}{line}"
    return text[:next_idx] + "\n" + line + text[next_idx:]


def _set_plain_line(text: str, label: str, value: str) -> str:
    """Replace `- Label:` in the priority rubric, appending the line if it is new."""
    pattern = re.compile(
        rf"^([ \t]*-[ \t]*{re.escape(label)}:[ \t]*)(.*)$",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if match:
        return text[: match.start(2)] + value + text[match.end(2) :]
    line = f"- {label}: {value}\n"
    heading = "## Student overrides"
    idx = text.find(heading)
    if idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        return f"{text}{sep}\n{heading}\n\n{line}"
    next_idx = text.find("\n## ", idx + len(heading))
    if next_idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        return f"{text}{sep}{line}"
    return text[:next_idx] + "\n" + line + text[next_idx:]


def _bullet_block(heading: str, items: list[str]) -> str:
    lines = [heading, ""]
    lines.extend(f"- {item}" for item in items)
    return "\n".join(lines) + "\n"


def stamp_school(user_root: Path, school_slug: str) -> Path:
    """Seed USER.md and calibration, then set Institution and School slug only.

    Choosing a school must not rewrite Program, aims, or course weights the
    student already saved. A blank institution leaves that line as it is.
    """
    user_md = Path(user_root) / "USER.md"
    _seed_user_md_if_missing(user_md)
    _seed_calibration_files(user_root)
    text = user_md.read_text(encoding="utf-8", errors="replace")
    slug = school_slug.strip()
    if slug:
        text = _set_bold_line(text, "School slug", slug)
        institution = _institution_for(OnboardingIdentity(school_slug=slug), Path(user_root))
        if institution:
            text = _set_bold_line(text, "Institution", institution)
    write_private_text(user_md, text)
    return user_md


def save_aims(
    user_root: Path,
    *,
    career: list[str] | None = None,
    interests: list[str] | None = None,
    worth: list[str] | None = None,
    light: list[str] | None = None,
) -> Path:
    """Write the Settings "What to weigh" answers.

    A list that was not sent is left alone, so saving aims does not wipe the
    major or a section the form did not include. Light courses are written to
    both the priority rubric and USER.md's throwaway section.
    """
    user_md = Path(user_root) / "USER.md"
    career_items = _clean_items(career)
    interest_items = _clean_items(interests)
    worth_items = _clean_items(worth)
    light_items = _clean_items(light)
    if not any((career_items, interest_items, worth_items, light_items)):
        return user_md
    _seed_user_md_if_missing(user_md)
    _seed_calibration_files(user_root)
    text = user_md.read_text(encoding="utf-8", errors="replace")
    if career_items:
        text = _set_bold_line(text, "Goals", ", ".join(career_items))
        text = _replace_section(
            text,
            "## Career priorities (ranked)",
            _ranked_block("## Career priorities (ranked)", career_items),
        )
    if interest_items:
        text = _replace_section(
            text,
            "## Interests (ranked)",
            _ranked_block("## Interests (ranked)", interest_items),
        )
    if light_items:
        text = _replace_section(
            text,
            "## Throwaway / low-attention courses",
            _bullet_block("## Throwaway / low-attention courses", light_items),
        )
    write_private_text(user_md, text)
    if worth_items or light_items:
        rubric = Path(user_root) / "calibration" / "priority-rubric.md"
        rubric_text = rubric.read_text(encoding="utf-8", errors="replace") if rubric.is_file() else ""
        if worth_items:
            rubric_text = _set_plain_line(
                rubric_text, "Worth-by-default courses", "; ".join(worth_items)
            )
        if light_items:
            rubric_text = _set_plain_line(
                rubric_text, "Throwaway / low-attention courses", "; ".join(light_items)
            )
        write_private_text(rubric, rubric_text)
    return user_md


def main(argv: list[str] | None = None) -> int:
    """CLI entry for the Tauri onboarding "Profile" step.

    Usage::

        python -m canvas_mcp.core.user_profile save \\
            --name "Avery Student" --school-slug cu-boulder \\
            --institution "University of Colorado Boulder" \\
            --major "Computer Science" --catalog-year 2025 \\
            --target-grad-term "Spring 2028" \\
            --interest "backend infra" --interest "ML systems" \\
            --career-priority "startup" --career-priority "software" \\
            --good-standing-gpa 2.0 --values "hands-on" --values "flexible schedule" \\
            --transfer-notes "AP Calc BC credit for MATH 1300"
    """
    import argparse
    import json

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(
        description="Write onboarding identity/program answers into USER.md"
    )
    parser.add_argument(
        "--user-root", type=Path, default=None, help="Override user root (else DEV_USER_ROOT / default)"
    )
    parser.add_argument("--json", action="store_true", help="Print JSON")
    sub = parser.add_subparsers(dest="cmd", required=True)

    save = sub.add_parser("save", help="Write onboarding identity answers")
    save.add_argument("--name", default="")
    save.add_argument("--institution", default="")
    save.add_argument("--school-slug", default="")
    save.add_argument("--major", default="")
    save.add_argument("--minor", default="")
    save.add_argument("--catalog-year", default="")
    save.add_argument("--target-grad-term", default="")
    save.add_argument("--interest", action="append", default=[], dest="interests")
    save.add_argument("--good-standing-gpa", default="")
    save.add_argument("--scholarship-min-gpa", default="")
    save.add_argument(
        "--career-priority", action="append", default=[], dest="career_priorities"
    )
    save.add_argument("--values", action="append", default=[])
    save.add_argument("--transfer-notes", default="")

    stamp = sub.add_parser("stamp", help="Write the chosen school into USER.md")
    stamp.add_argument("--school-slug", default="")

    aims = sub.add_parser("aims", help="Write Settings answers for what to weigh")
    aims.add_argument("--career-priority", action="append", default=None, dest="career_priorities")
    aims.add_argument("--interest", action="append", default=None, dest="interests")
    aims.add_argument("--worth", action="append", default=None)
    aims.add_argument("--light", action="append", default=None)

    args = parser.parse_args(argv)
    root = args.user_root
    if root is None:
        root = resolve_user_root("dev", create=True)

    if args.cmd == "stamp":
        path = stamp_school(root, args.school_slug)
    elif args.cmd == "aims":
        path = save_aims(
            root,
            career=args.career_priorities,
            interests=args.interests,
            worth=args.worth,
            light=args.light,
        )
    else:
        identity = OnboardingIdentity(
            name=args.name,
            institution=args.institution,
            school_slug=args.school_slug,
            major=args.major,
            minor=args.minor,
            catalog_year=args.catalog_year,
            target_grad_term=args.target_grad_term,
            interests=list(args.interests),
            good_standing_gpa=args.good_standing_gpa,
            scholarship_min_gpa=args.scholarship_min_gpa,
            career_priorities=list(args.career_priorities),
            values=list(args.values),
            transfer_notes=args.transfer_notes,
        )
        path = apply_onboarding_identity(root, identity)

    if args.json:
        print(json.dumps({"ok": True, "path": str(path)}))
    else:
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
