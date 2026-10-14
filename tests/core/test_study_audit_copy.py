"""A pasted degree-audit copy is saved dated and sectioned, never guessed into "complete"."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from canvas_mcp.core.degree_audit import load_degree_audit
from canvas_mcp.core.study.audit_copy import audit_path, write_audit
from canvas_mcp.core.study.model import StudyError

TODAY = date(2026, 10, 13)


def test_writes_a_dated_sectioned_copy_the_parsers_read(tmp_path: Path) -> None:
    out = write_audit(
        tmp_path,
        {
            "taken_on": "2026-10-12",
            "catalog_year": "2025-2026",
            "complete": "WRTG 1150\n- MATH 1300",
            "in_progress": "APPM 2360",
            "still_needed": "## Upper-division humanities\nASEN senior design",
            "remaining_credits": "42",
        },
        today=TODAY,
    )
    assert out["counts"] == {"complete": 2, "in_progress": 1, "still_needed": 2}
    audit = load_degree_audit(audit_path(tmp_path), today=TODAY)
    assert audit is not None
    assert audit.imported_on == date(2026, 10, 12)
    assert audit.catalog_year == "2025-2026"
    assert audit.remaining_credits == 42
    assert "- Upper-division humanities" in audit.sections["unmet"]
    assert not audit.stale


def test_keeps_the_previous_copy_and_refuses_empty_or_future(tmp_path: Path) -> None:
    write_audit(tmp_path, {"still_needed": "One"}, today=TODAY)
    write_audit(tmp_path, {"still_needed": "Two"}, today=TODAY)
    assert "One" in (tmp_path / "inbox" / "degree-audit.prev.md").read_text(encoding="utf-8")
    with pytest.raises(StudyError):
        write_audit(tmp_path, {}, today=TODAY)
    with pytest.raises(StudyError):
        write_audit(tmp_path, {"still_needed": "x", "taken_on": "2027-01-01"}, today=TODAY)
    with pytest.raises(StudyError):
        write_audit(tmp_path, {"still_needed": "x", "catalog_year": "next year"}, today=TODAY)


def test_an_empty_section_is_said_plainly(tmp_path: Path) -> None:
    write_audit(tmp_path, {"in_progress": "APPM 2360"}, today=TODAY)
    text = audit_path(tmp_path).read_text(encoding="utf-8")
    assert "## Complete\n\n(nothing pasted)" in text
    assert "## Unmet\n\n(nothing pasted)" in text


def test_profile_fields_touch_only_their_lines(tmp_path: Path) -> None:
    from canvas_mcp.core.study.audit_copy import update_profile_fields

    (tmp_path / "USER.md").write_text(
        "# USER\n\n- **Name:** Avery\n\n## Program\n\n- **Declared major(s):** (fill during onboarding)\n- **Minor(s) / certificate(s):** Music\n",
        encoding="utf-8",
    )
    update_profile_fields(tmp_path, {"program": "Aerospace Engineering", "target_term": "Spring 2029"})
    text = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "- **Declared major(s):** Aerospace Engineering" in text
    assert "- **Target grad term:** Spring 2029" in text
    assert "- **Name:** Avery" in text and "- **Minor(s) / certificate(s):** Music" in text
    with pytest.raises(StudyError):
        update_profile_fields(tmp_path, {"catalog_year": "soon"})
