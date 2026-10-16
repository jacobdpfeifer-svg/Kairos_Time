"""Mission Control (2026-10-15): email drafts never send; enrichment is minimal,
explicit, schema-checked, and tied to its brief's sources; profiles stay apart."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from canvas_mcp.core.study import brief_enrich
from canvas_mcp.core.study import email_drafts as e
from canvas_mcp.core.study.model import StudyError


def test_voice_or_text_intent_becomes_an_editable_draft_that_cannot_send(tmp_path: Path) -> None:
    out = e.create(tmp_path, {"intent": "ask prof about the midterm room", "to": "prof@example.edu", "subject": "Midterm room", "body": "Hi Professor,", "evidence": [{"id": "m1", "subject": "Room change", "body": "SECRET BODY"}], "connector": "outlook"})
    draft = out["draft"]
    assert draft["status"] == "draft" and draft["to"] == ["prof@example.edu"]
    assert draft["evidence"] == [{"id": "m1", "subject": "Room change", "kind": "email"}]  # never a raw body
    path = e.drafts_dir(tmp_path) / f"{draft['draft_id']}.json"
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    reviewed = e.review(tmp_path, draft["draft_id"])
    assert reviewed["draft"]["status"] == "reviewed"
    assert reviewed["send"] == {"available": False, "reason": "Sending is not connected on this device"}
    first = reviewed["fingerprint"]
    # Any edit returns to draft and changes what a confirmation would bind.
    edited = e.update(tmp_path, draft["draft_id"], {"body": "Hi Professor, quick question."})["draft"]
    assert edited["status"] == "draft"
    assert e.send_fingerprint(edited) != first
    with pytest.raises(StudyError) as info:
        e.send(tmp_path, draft["draft_id"], "any-token")
    assert info.value.code == "not_connected"


def test_draft_validation_and_discard(tmp_path: Path) -> None:
    with pytest.raises(StudyError):
        e.create(tmp_path, {"to": "not an address"})
    with pytest.raises(StudyError):
        e.update(tmp_path, "../../etc/passwd", {})
    d = e.create(tmp_path, {"to": "", "subject": "", "body": ""})["draft"]
    with pytest.raises(StudyError, match="recipient"):
        e.review(tmp_path, d["draft_id"])
    e.discard(tmp_path, d["draft_id"])
    assert e.list_drafts(tmp_path)["drafts"] == []


def test_two_profiles_cannot_read_each_others_drafts(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    d = e.create(a, {"to": "x@example.edu", "subject": "s", "body": "b"})["draft"]
    assert e.list_drafts(b)["drafts"] == []
    with pytest.raises(StudyError):
        e.get(b, d["draft_id"])


def _brief_root(root: Path, state: str = "ready") -> None:
    (root / "inbox" / "study-sources").mkdir(parents=True)
    (root / "inbox" / "briefs" / "v1").mkdir(parents=True)
    record = {
        "course": {"id": "101"},
        "items": [{"id": "item-a11", "title": "Problem Set 4", "description": "Problems 1-12 from Section 3.4. Show your work."}],
        "sources": [
            {"title": "Worked examples: chain rule", "text": "Example 1 ..."},
            {"title": "Unrelated lecture", "text": "Should not be sent"},
        ],
    }
    (root / "inbox" / "study-sources" / "101.json").write_text(json.dumps(record))
    brief = {"course_id": "101", "assignment_id": "a11", "title": "Problem Set 4", "kind": "math", "state": state, "source_fingerprint": "f" * 64, "requirements": ["Worth 20 points"], "evidence": [{"kind": "course_source", "label": "Worked examples: chain rule"}]}
    (root / "inbox" / "briefs" / "v1" / "101--a11.json").write_text(json.dumps(brief))
    # Outlook context exists on disk but must never be sent.
    (root / "inbox" / "connectors").mkdir(parents=True)
    (root / "inbox" / "connectors" / "outlook.json").write_text(json.dumps({"items": [{"subject": "PRIVATE MAIL"}]}))


def test_enrichment_sends_only_this_assignment_and_cited_sources(tmp_path: Path) -> None:
    _brief_root(tmp_path)
    seen: list[dict[str, Any]] = []

    def fake(root: Path, request: dict[str, Any]) -> dict[str, Any]:
        seen.append(request)
        return {"status": "complete", "brief_proposal": {"status": "complete", "sections": [{"id": "ai-order", "title": "Review order", "body": "- Chain rule first"}], "gaps": []}}

    out = brief_enrich.enrich(tmp_path, "101", "a11", session_budget_id="s1", dispatch=fake)
    assert out["status"] == "complete" and out["enrichment"]["sections"][0]["proposal"] is True
    payload = json.dumps(seen[0])
    assert seen[0]["purpose"] == "brief" and seen[0]["submitted_answer"] == ""
    assert "Worked examples" in payload and "Unrelated lecture" not in payload and "PRIVATE MAIL" not in payload
    overlay = json.loads((tmp_path / "inbox" / "briefs" / "v1" / "101--a11--enriched.json").read_text())
    assert overlay["source_fingerprint"] == "f" * 64


def test_enrichment_refuses_sparse_briefs_and_rejects_off_schema_output(tmp_path: Path) -> None:
    _brief_root(tmp_path, state="needs_source")
    with pytest.raises(StudyError):
        brief_enrich.enrich(tmp_path, "101", "a11", session_budget_id="s1", dispatch=lambda r, q: {})
    other = tmp_path / "other"
    _brief_root(other)
    out = brief_enrich.enrich(other, "101", "a11", session_budget_id="s1", dispatch=lambda r, q: {"status": "complete", "brief_proposal": {"sections": "nope"}})
    assert out["enrichment"] is None and out["status"] == "malformed"
    assert not (other / "inbox" / "briefs" / "v1" / "101--a11--enriched.json").exists()
    with pytest.raises(StudyError):
        brief_enrich.enrich(other, "../x", "a11", session_budget_id="s1", dispatch=lambda r, q: {})
