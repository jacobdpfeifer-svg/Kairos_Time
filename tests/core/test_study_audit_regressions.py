"""Regressions for the confirmed findings of the 2026-09-18 independent audit
of this build (candidate A). Each test failed before the repair."""

from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from canvas_mcp.core.study import checkers
from canvas_mcp.core.study.clock import calendar_add, exam_window
from canvas_mcp.core.study.model import Event, StudyError
from canvas_mcp.core.study.packets import validate_packet
from canvas_mcp.core.study.service import StudyService
from canvas_mcp.core.study.store import append_event, events_path, read_log

Z = "America/Denver"
PACKETS = Path(__file__).resolve().parents[2] / "templates" / "study-packets"


def T(text: str) -> datetime:
    return datetime.fromisoformat(text)


def packet(name: str) -> dict[str, Any]:
    return json.loads((PACKETS / f"{name}.json").read_text(encoding="utf-8"))


def svc(root: Path, at: str) -> StudyService:
    return StudyService(root, now=T(at), zone=Z)


# 1. permission scope and support refs are enforced


@pytest.mark.parametrize("scope", ["proctored", "live_assessment", "forbidden", ""])
def test_unpermitted_source_scope_is_refused(scope: str) -> None:
    raw = packet("P")
    raw["sources"][0]["permission_scope"] = scope or "nope"
    with pytest.raises(StudyError, match="permission_scope"):
        validate_packet(raw)


def test_support_refs_must_resolve() -> None:
    raw = packet("P")
    raw["items"][0]["key"]["support_refs"] = ["DOES-NOT-EXIST"]
    with pytest.raises(StudyError, match="does not resolve"):
        validate_packet(raw)
    # P3 is a passage label inside P1–P7; Q §chain is a locator; both resolve.
    validate_packet(packet("P"))
    validate_packet(packet("Q"))


# 2. a model-candidate key cannot earn deterministic delayed credit


def test_model_candidate_key_is_a_proposal(tmp_path: Path) -> None:
    raw = packet("R")
    raw["packet_id"] = "R-model"
    raw["provenance"] = "model_candidate"
    raw["items"][0]["id"] = "Rm-1"
    svc(tmp_path, "2026-09-16T09:00:00-06:00").import_packet(raw)
    aid = svc(tmp_path, "2026-09-16T09:00:00-06:00").start("Rm-1", "review")["attempt"]["attempt_id"]
    r = svc(tmp_path, "2026-09-16T09:02:00-06:00").submit(aid, "false", {"truth": "false"})
    assert r["assessment"]["grader"] == "model_proposed"
    assert r["assessment"]["evidence"] == "unverified_response"
    aid = svc(tmp_path, "2026-09-18T09:10:00-06:00").start("Rm-1", "review")["attempt"]["attempt_id"]
    r = svc(tmp_path, "2026-09-18T09:12:00-06:00").submit(aid, "false", {"truth": "false"})
    assert r["assessment"]["evidence"] == "unverified_response" and r["state"]["hits"] == 0
    # An independently validated derivation restores deterministic authority.
    raw["version"] = 2
    raw["items"][0]["key"]["validated_by"] = "independent_derivation"
    svc(tmp_path, "2026-09-18T09:13:00-06:00").import_packet(raw)
    aid = svc(tmp_path, "2026-09-18T09:14:00-06:00").start("Rm-1", "review")["attempt"]["attempt_id"]
    r = svc(tmp_path, "2026-09-18T09:15:00-06:00").submit(aid, "false", {"truth": "false"})
    assert r["assessment"]["grader"] == "deterministic"


# 3. a retried submission after a crash still logs the feedback exposure


def test_feedback_retry_after_crash_logs_exposure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(tmp_path, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    real_append = append_event

    def crash_before_feedback(root: Path, event: Event) -> Any:
        if event.event_id.endswith(":feedback"):
            raise RuntimeError("simulated crash after assessment commit")
        return real_append(root, event)

    monkeypatch.setattr("canvas_mcp.core.study.service.append_event", crash_before_feedback)
    with pytest.raises(RuntimeError):
        svc(tmp_path, "2026-09-18T09:02:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    monkeypatch.undo()
    assert not any(e.type == "exposure" for e in read_log(tmp_path).events)
    r = svc(tmp_path, "2026-09-18T09:03:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    assert r["duplicate"] and r["key"]["derivative"]
    events = read_log(tmp_path).events
    assert [e.payload["kind"] for e in events if e.type == "exposure"] == ["feedback"]
    assert svc(tmp_path, "2026-09-18T09:04:00-06:00").history("Q-1")["state"]["cooldown"] == "2026-09-19T03:03:00+00:00"


# 4. a packet revision cannot change in-flight grading


def test_packet_revision_does_not_regrade_open_attempt(tmp_path: Path) -> None:
    svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("P"))
    aid = svc(tmp_path, "2026-09-18T09:00:00-06:00").start("P-1", "review")["attempt"]["attempt_id"]
    v2 = copy.deepcopy(packet("P"))
    v2["version"] = 2
    v2["items"][0]["fields"][0]["checker"]["value"] = 9
    svc(tmp_path, "2026-09-18T09:01:00-06:00").import_packet(v2)
    r = svc(tmp_path, "2026-09-18T09:02:00-06:00").submit(aid, "9 m", {"compression": "9 m", "conserved": "false"})
    assert r["assessment"]["grader"] == "abstained" and r["assessment"]["outcome"] == "uncertain"
    assert r["source_changed"] is True and r["key"]["historical_version"] == 1
    assert r["key"]["compression"] == "0.155 m"  # the version the attempt started under
    assert r["state"]["hits"] == 0
    # A fresh attempt is graded against version 2.
    aid2 = svc(tmp_path, "2026-09-18T09:05:00-06:00").start("P-1", "review")["attempt"]["attempt_id"]
    r2 = svc(tmp_path, "2026-09-18T09:06:00-06:00").submit(aid2, "9 m", {"compression": "9 m", "conserved": "false"})
    assert r2["assessment"]["outcome"] == "correct" and not r2["source_changed"]


# 5. checkers reject mathematically wrong answers


def test_numeric_and_expression_grammar() -> None:
    assert checkers.check_field({"type": "numeric", "value": 2, "tolerance_pct": 1}, "Not 2; the answer is 99")[1] is False
    assert checkers.check_field({"type": "numeric", "value": 2, "tolerance_pct": 1}, "x = 2")[1] is True
    assert checkers.check_field({"type": "expression", "accept": ["23"]}, "2*3")[1] is False
    assert checkers.check_field({"type": "expression", "accept": ["2*3"]}, "2 * 3")[1] is True
    assert checkers.check_field({"type": "expression", "accept": ["4sin^3(x)cos(x)"]}, "4 sin³x · cos x")[1] is True


# 6. stale draft writers cannot overwrite newer work


def test_stale_draft_writer_is_rejected(tmp_path: Path) -> None:
    svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(tmp_path, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    stale = svc(tmp_path, "2026-09-18T09:01:00-06:00")
    newer = svc(tmp_path, "2026-09-18T09:01:30-06:00")
    newer.draft(aid, "newer")
    with pytest.raises(StudyError) as info:
        stale.draft(aid, "older")
    assert info.value.code == "draft_revision_conflict"
    assert svc(tmp_path, "2026-09-18T09:02:00-06:00").history("Q-1")["attempts"][0]["draft"] == "newer"
    with pytest.raises(StudyError):
        svc(tmp_path, "2026-09-18T09:02:30-06:00").draft(aid, "x", expected_revision=0)


# 7. spring DST gap normalizes forward


def test_spring_gap_normalizes_forward() -> None:
    assert calendar_add(T("2026-03-07T02:30:00-07:00"), 1, Z) == T("2026-03-08T03:30:00-06:00")
    assert calendar_add(T("2026-10-31T01:30:00-06:00"), 1, Z) == T("2026-11-01T01:30:00-07:00")


def test_exam_window_uses_start_and_preserves_timezone_confidence() -> None:
    window = exam_window({
        "id": "exam-2", "value": "window",
        "starts_at": "2026-10-08T00:45:00Z", "ends_at": "2026-10-08T02:15:00Z",
        "zone": Z, "source": "module_page", "confidence": "high",
    })
    assert window.cutoff == T("2026-10-08T00:45:00+00:00")
    assert window.ends_at == T("2026-10-08T02:15:00+00:00")
    assert window.source == "module_page" and window.confidence == "high"

    due_only = exam_window({"id": "exam-3", "value": "known_instant", "at": "2026-10-08T02:15:00Z", "zone": Z, "source": "canvas_due_at", "confidence": "low"})
    assert due_only.cutoff == T("2026-10-08T01:15:00+00:00")


# 8. item ids are global; collisions are refused


def test_item_id_collision_across_packets(tmp_path: Path) -> None:
    svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    other = packet("R")
    other["items"][0]["id"] = "Q-1"
    with pytest.raises(StudyError) as info:
        svc(tmp_path, "2026-09-18T09:01:00-06:00").import_packet(other)
    assert info.value.code == "conflict"


# 9. import is crash-safe: event first, then commit; pending snapshots repaired


def test_import_crash_between_event_and_commit_is_repaired(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("canvas_mcp.core.study.service.commit_packet", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("crash")))
    with pytest.raises(RuntimeError):
        svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    monkeypatch.undo()
    assert list((tmp_path / "study" / "packets").glob("*.pending"))
    s = svc(tmp_path, "2026-09-18T09:01:00-06:00")  # repair on load
    assert "Q" in s.packets and not list((tmp_path / "study" / "packets").glob("*.pending"))
    assert s.offer()["kind"] == "offer"


def test_import_write_failure_leaves_nothing_registered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("canvas_mcp.core.study.service.append_event", lambda *a, **k: (_ for _ in ()).throw(StudyError("persistence_failed", "disk")))
    with pytest.raises(StudyError):
        svc(tmp_path, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    monkeypatch.undo()
    s = svc(tmp_path, "2026-09-18T09:01:00-06:00")
    assert not s.packets and not list((tmp_path / "study" / "packets").glob("*"))


# 10. interior corruption is not treated as a torn tail


def test_interior_corruption_is_never_truncated(tmp_path: Path) -> None:
    for eid in ("e1", "e2", "e3"):
        append_event(tmp_path, Event(event_id=eid, type="clock_anomaly", at=T("2026-09-18T09:00:00-06:00"), zone=Z, payload={"note": eid}))
    path = events_path(tmp_path)
    lines = path.read_bytes().split(b"\n")
    lines[1] = b'{"broken": tru'
    path.write_bytes(b"\n".join(lines))
    log = read_log(tmp_path)
    assert [e.event_id for e in log.events] == ["e1", "e3"] and log.corrupt_interior
    with pytest.raises(StudyError, match="damaged record"):
        append_event(tmp_path, Event(event_id="e4", type="clock_anomaly", at=T("2026-09-18T09:00:00-06:00"), zone=Z, payload={}))
    assert b"e3" in path.read_bytes()  # valid later history untouched


# 11. a request-supplied clock is ignored outside the test harness


def test_ipc_clock_override_is_gated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from canvas_mcp.core.study.cli import _bridge_now

    monkeypatch.delenv("KAIROS_ALLOW_TEST_CLOCK", raising=False)
    assert _bridge_now({"now": "2030-01-01T00:00:00+00:00"}) is None
    monkeypatch.setenv("KAIROS_ALLOW_TEST_CLOCK", "1")
    assert _bridge_now({"now": "2030-01-01T00:00:00+00:00"}) == T("2030-01-01T00:00:00+00:00")


def test_live_audit_d8_course_notation_and_fractions_are_not_marked_incorrect() -> None:
    """2026-10-07 live run: correct answers in the course's own notation were
    recorded as incorrect evidence."""
    interval = {"type": "expression", "accept": ["(-inf,2)U(2,inf)"]}
    for answer in ("(-∞, 2) ∪ (2, ∞)", "(-inf,2)U(2,inf)", "(-infinity, 2) U (2, infinity)"):
        assert checkers.check_field(interval, answer)[1], answer
    assert not checkers.check_field(interval, "(-∞, 2)")[1]

    half = {"type": "numeric", "value": 0.5, "tolerance_pct": 2}
    for answer in ("1/2", "x = 1/2", "0.5", " 1 / 2 "):
        assert checkers.check_field(half, answer)[1], answer
    assert checkers.check_field(half, "1/3")[1] is False
    assert checkers.check_field(half, "not 2; it is 99")[2] == "state one value, not several numbers"
    assert checkers.check_field(half, "1/0")[1] is False


def test_live_audit_d5_long_syllabus_imports_clipped_not_failed(tmp_path: Path) -> None:
    """2026-10-07 live run: a 31k-character syllabus failed the whole course import."""
    record = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "study" / "ui-round1" / "1300.json").read_text())
    record["sources"][0]["text"] = "Core topics: chain rule. " * 1300
    sources = tmp_path / "inbox" / "study-sources"
    sources.mkdir(parents=True)
    (sources / "1300.json").write_text(json.dumps(record))
    service = StudyService(tmp_path, zone="America/Denver")
    result = service.canvas_import("1300", None)
    assert result["sources"] == len(record["sources"])
    packet = next(p for p in service.packets_view()["packets"] if p["packet_id"] == result["packet_id"])
    syllabus = next(s for s in packet["sources"] if s["id"] == record["sources"][0]["id"])
    assert syllabus["chars"] <= 20000
    assert "first 20,000 characters" in syllabus["locator"]
