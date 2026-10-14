"""Tests for dated degree-audit import parsing."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from canvas_mcp.core.degree_audit import (
    extract_remaining_credits,
    load_degree_audit,
    pacing_credits_per_term,
    split_sections,
)

SAMPLE = """---
imported_on: 2026-06-01
catalog_year: "2024-2025"
source: buff-portal-paste
---

# Degree audit

## Complete

MATH 1300 — done

## In-progress

CSCI 1300 — IP

## Unmet

CSCI 2270 Data Structures
Remaining credits: 48
"""


def test_split_sections():
    sections = split_sections(SAMPLE.split("---", 2)[-1])
    assert "complete" in sections
    assert "in_progress" in sections
    assert "unmet" in sections
    assert "MATH 1300" in sections["complete"]
    assert "CSCI 2270" in sections["unmet"]


def test_load_degree_audit_fresh(tmp_path: Path):
    path = tmp_path / "degree-audit.md"
    path.write_text(SAMPLE, encoding="utf-8")
    audit = load_degree_audit(path, today=date(2026, 7, 1))
    assert audit is not None
    assert audit.imported_on == date(2026, 6, 1)
    assert audit.catalog_year == "2024-2025"
    assert audit.remaining_credits == 48.0
    assert not audit.stale
    assert "2026-06-01" in audit.banner()


def test_load_degree_audit_stale(tmp_path: Path):
    path = tmp_path / "degree-audit.md"
    path.write_text(SAMPLE, encoding="utf-8")
    audit = load_degree_audit(path, today=date(2026, 12, 1))
    assert audit is not None
    assert audit.stale
    assert "stale" in audit.banner().lower()


def test_extract_remaining_credits():
    assert extract_remaining_credits("Remaining credits: 42") == 42.0
    assert extract_remaining_credits("no numbers here") is None


def test_template_example_is_not_a_remaining_total():
    template = Path(__file__).resolve().parents[2] / "templates" / "inbox" / "degree-audit.md"
    audit = load_degree_audit(template, today=date(2026, 10, 13))
    assert audit is not None
    assert audit.imported_on is None
    assert audit.remaining_credits is None
    assert extract_remaining_credits("Remaining credits needed: 96 (e.g. `Remaining credits: 42`)") == 96.0


def test_split_sections_appends_repeated_headings():
    text = (
        "## Unmet\n\nBlock A: 3 credits needed\n\n"
        "## Unmet\n\nBlock B: CSCI 2270\n"
    )
    sections = split_sections(text)
    assert "Block A" in sections["unmet"]
    assert "Block B" in sections["unmet"]


def test_remaining_credits_prefers_unmet_section_over_stray_mentions():
    text = (
        "## Complete\n\nGenEd writing: 3 credits needed historically, now done\n\n"
        "## Unmet\n\nRemaining credits: 48\n"
    )
    audit_sections = split_sections(text)
    assert extract_remaining_credits(audit_sections["unmet"]) == 48.0


def test_pacing():
    assert pacing_credits_per_term(48, 4) == 12.0
    assert pacing_credits_per_term(48, None) is None
    assert pacing_credits_per_term(None, 4) is None
