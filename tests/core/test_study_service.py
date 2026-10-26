"""Study service, store, checkers, packets, selection: six spec sessions plus adversarial paths."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from canvas_mcp.core.study import checkers
from canvas_mcp.core.study.cli import main as study_main
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


# --- packets -----------------------------------------------------------------


def test_all_shipped_packets_validate() -> None:
    for path in sorted(PACKETS.glob("*.json")):
        data = validate_packet(json.loads(path.read_text(encoding="utf-8")))
        assert data["packet_id"] == path.stem
        for source in data["sources"]:
            assert source["hash"].startswith("sha256:")


def test_packet_rejects_answer_bearing_locator_and_unsupported_key() -> None:
    raw = packet("Q")
    raw["items"][0]["neutral_locator"] = "Q answer key"
    with pytest.raises(StudyError, match="must not mention answers"):
        validate_packet(raw)
    raw = packet("Q")
    raw["items"][0]["key"]["support_refs"] = []
    with pytest.raises(StudyError, match="without support_refs"):
        validate_packet(raw)
    with pytest.raises(StudyError, match="at least one source"):
        validate_packet({"packet_id": "X", "sources": []})


# --- checkers ------------------------------------------------------------------


def test_expression_checker_accepts_equivalent_spellings() -> None:
    spec = {"type": "expression", "accept": ["4sin^3(x)cos(x)", "4(sinx)^3cosx"]}
    for answer in ("4 sin³x cos x", "4sin^3(x)·cos(x)", "y' = 4 sin^3 x cos x", "4(sin x)^3 cos x"):
        assert checkers.check_field(spec, answer)[1], answer
    assert not checkers.check_field(spec, "4 sin^3 x")[1]


def test_numeric_and_truth_checkers() -> None:
    num = {"type": "numeric", "value": 0.154982, "tolerance_pct": 2}
    assert checkers.check_field(num, "x = 0.155 m")[1]
    assert checkers.check_field(num, "0.1917 m")[1] is False
    assert checkers.check_field(num, "no number")[2] == "no number found"
    tf = {"type": "true_false", "accept": "false"}
    assert checkers.check_field(tf, "False. It reverses the conditioning.")[1]
    assert checkers.check_field(tf, "True")[1] is False
    assert checkers.check_field(tf, "maybe") == (True, False, "answer did not state true or false")


def test_grade_abstains_without_scorable_fields() -> None:
    grade = checkers.grade([{"id": "r", "label": "Response", "checker": {"type": "none"}}], {}, "anything")
    assert (grade.outcome, grade.grader) == ("uncertain", "abstained")
    unknown = checkers.grade([{"id": "r", "label": "R", "checker": {"type": "semantic"}}], {}, "x")
    assert unknown.grader == "abstained"  # unknown scope is not a pass


# --- store ---------------------------------------------------------------------


def _ev(eid: str, payload: dict[str, Any] | None = None) -> Event:
    return Event(event_id=eid, type="clock_anomaly", at=T("2026-09-18T09:00:00-06:00"), zone=Z, payload=payload or {"note": "n"})


def test_store_duplicate_and_conflict(tmp_path: Path) -> None:
    first = append_event(tmp_path, _ev("e1"))
    assert first.status == "recorded" and first.seq == 1
    again = append_event(tmp_path, _ev("e1"))
    assert again.status == "duplicate" and again.seq == 1
    with pytest.raises(StudyError, match="different content") as info:
        append_event(tmp_path, _ev("e1", {"note": "other"}))
    assert info.value.code == "conflict"
    assert len(read_log(tmp_path).events) == 1


def test_store_partial_tail_is_rejected_then_repaired(tmp_path: Path) -> None:
    append_event(tmp_path, _ev("e1"))
    path = events_path(tmp_path)
    with open(path, "ab") as handle:
        handle.write(b'{"seq": 2, "event_id": "e2", "type": "clock_anom')
    log = read_log(tmp_path)
    assert [e.event_id for e in log.events] == ["e1"] and log.partial_tail
    result = append_event(tmp_path, _ev("e3"))
    assert result.seq == 2
    log = read_log(tmp_path)
    assert [e.event_id for e in log.events] == ["e1", "e3"] and not log.partial_tail


def test_store_persistence_failure_is_explicit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    append_event(tmp_path, _ev("e1"))
    real_open = open

    def failing_open(path: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if str(path).endswith("events.jsonl") and "a" in mode:
            raise OSError(28, "No space left on device")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", failing_open)
    with pytest.raises(StudyError) as info:
        append_event(tmp_path, _ev("e2"))
    assert info.value.code == "persistence_failed"
    monkeypatch.undo()
    assert [e.event_id for e in read_log(tmp_path).events] == ["e1"]
    # Retry with the same id succeeds once the disk is back.
    assert append_event(tmp_path, _ev("e2")).status == "recorded"


# --- sessions S1–S6 ----------------------------------------------------------------


def test_s1_novice_learn_partial_then_next_day_independent(tmp_path: Path) -> None:
    root = tmp_path
    assert svc(root, "2026-09-18T19:00:00-06:00").offer()["kind"] == "missing_source"
    svc(root, "2026-09-18T19:00:00-06:00").import_packet(packet("Q"))
    offer = svc(root, "2026-09-18T19:00:00-06:00").offer(minutes=10)
    assert offer["kind"] == "offer" and offer["item"]["id"] == "Q-1"
    assert "key" not in offer["item"] and "example" not in offer["item"]
    started = svc(root, "2026-09-18T19:00:00-06:00").start("Q-1", "learn", minutes=10)
    aid = started["attempt"]["attempt_id"]
    assert started["example"]["text"].startswith("y = (3x")
    assert started["attempt"]["exposures"][0]["kind"] == "example"
    svc(root, "2026-09-18T19:05:00-06:00").draft(aid, "Inner function is sin x.")
    resumed = svc(root, "2026-09-18T19:05:30-06:00").start("Q-1", "learn", minutes=10)
    assert resumed["resumed"] and resumed["attempt"]["attempt_id"] == aid
    assert resumed["attempt"]["draft"] == "Inner function is sin x."
    result = svc(root, "2026-09-18T19:06:55-06:00").submit(
        aid, "Inner function is sin x. The outer power gives 4sin³x.", {"inner": "sin x", "derivative": "4sin³x"}
    )
    a = result["assessment"]
    assert (a["outcome"], a["grader"], a["evidence"]) == ("partial", "deterministic", "acquisition_only")
    assert "cos x" in result["feedback"]
    assert result["key"]["provenance_label"] == "synthetic template derivation"
    state = result["state"]
    assert (state["stability"], state["hits"], state["gap_days"]) == ("fragile", 0, 1)
    assert state["due"] == "2026-09-20T01:06:55+00:00"  # Sep 19 19:06:55 Denver
    # Same-day retry is practice; a clean answer the next evening is a delayed check.
    later = svc(root, "2026-09-19T19:10:00-06:00")
    offer = later.offer()
    assert offer["kind"] == "offer" and offer["mode"] == "review" and offer["item"]["id"] == "Q-1"
    aid2 = later.start("Q-1", "review")["attempt"]["attempt_id"]
    result = svc(root, "2026-09-19T19:13:00-06:00").submit(aid2, "", {"inner": "sin x", "derivative": "4 sin^3(x) cos(x)"})
    assert result["assessment"]["evidence"] == "delayed_independent_retrieval"
    assert result["state"]["stability"] == "holding" and result["state"]["gap_days"] == 3


def test_s2_scoped_species_check_capped_by_exam(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-17T09:00:00-06:00").import_packet(packet("C"))
    # baseline on Sep 17 -> due Sep 18 09:00; correct on Sep 18 09:05 -> holding gap 3 -> due Sep 21 09:05
    aid = svc(root, "2026-09-17T09:00:00-06:00").start("C-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-17T09:02:00-06:00").submit(aid, "HF", {"species": "HF"})
    aid = svc(root, "2026-09-18T09:05:00-06:00").start("C-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T09:07:00-06:00").submit(aid, "F-", {"species": "F−"})
    assert r["assessment"]["evidence"] == "delayed_independent_retrieval"
    assert r["state"]["due"] == "2026-09-21T15:07:00+00:00"
    # Sep 21 09:00 review; explanation is not scored; expanded gap 7 is capped to Sep 23 23:00 Denver
    aid = svc(root, "2026-09-21T09:10:00-06:00").start("C-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-21T09:12:50-06:00").submit(aid, "F−. It accepts H+ from HCl and forms HF.", {"species": "F−", "explanation": "It accepts H+"})
    assert r["assessment"]["outcome"] == "correct" and r["assessment"]["scope"] == "Species consumed"
    assert r["state"]["stability"] == "durable" and r["state"]["gap_days"] == 7
    assert r["state"]["due"] == "2026-09-24T05:00:00+00:00"  # Sep 23 23:00 MDT cutoff
    assert r["state"]["cooldown"] == "2026-09-22T03:12:50+00:00"  # 21:12:50 Denver


def test_s3_physics_incorrect_baseline_then_reveal_repair(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T20:00:00-06:00").import_packet(packet("P"))
    started = svc(root, "2026-09-18T20:00:00-06:00").start("P-1", "review", minutes=10)
    aid = started["attempt"]["attempt_id"]
    assert "example" not in started
    r = svc(root, "2026-09-18T20:04:25-06:00").submit(
        aid,
        "I used mgh=kx²/2. With h=.75m, x=√(29.4/800)=.1917m. Mechanical energy is conserved.",
        {"compression": "0.1917 m", "conserved": "true"},
    )
    a = r["assessment"]
    assert (a["outcome"], a["evidence"]) == ("incorrect", "baseline_response")
    assert r["state"]["due"] == "2026-09-20T02:04:25+00:00"  # Sep 19 20:04:25 Denver
    assert "P3" in r["key"]["explanation"]
    # The repair after the reveal moves the anchor; independent check no earlier than Sep 19 20:08.
    revealed = svc(root, "2026-09-18T20:08:00-06:00").reveal(aid)
    assert revealed["sources"][0]["locator"] == "P1–P7"
    state = svc(root, "2026-09-18T20:08:30-06:00").history("P-1")["state"]
    assert state["anchor"] == "2026-09-19T02:08:00+00:00"
    assert state["independent_check_no_earlier_than"] == "2026-09-20T02:08:00+00:00"


def test_s4_essay_self_check_no_credit_then_plan(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T14:00:00-06:00").import_packet(packet("W"))
    started = svc(root, "2026-09-18T14:00:00-06:00").start("W-1", "learn")
    aid = started["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T14:03:30-06:00").submit(
        aid, "The university should extend the buses because visits rose 18%. This proves buses made students study more.", {}, self_outcome="partial"
    )
    a = r["assessment"]
    assert (a["outcome"], a["grader"], a["evidence"]) == ("partial", "student_self", "unverified_response")
    assert r["state"]["due"] is None and r["state"]["hits"] == 0
    planned = svc(root, "2026-09-18T14:05:00-06:00").plan("W-1", "2026-09-19T14:00:00-06:00")
    assert planned["state"]["due"] == "2026-09-19T20:00:00+00:00"
    assert planned["state"]["hits"] == 0
    with pytest.raises(StudyError, match="future"):
        svc(root, "2026-09-18T14:05:00-06:00").plan("W-1", "2026-09-18T13:00:00-06:00")


def test_s5_exam_tomorrow_empty_cache_learn_capped(tmp_path: Path) -> None:
    root = tmp_path
    s = svc(root, "2026-09-18T18:00:00-06:00")
    assert s.offer(cram=True)["kind"] == "missing_source"
    s.import_packet(packet("M"))
    offer = svc(root, "2026-09-18T18:01:00-06:00").offer(cram=True, minutes=10, mode="learn")
    assert offer["kind"] == "offer" and offer["mode"] == "learn"
    assert offer["why"].startswith("This is explicitly in your guide")
    aid = svc(root, "2026-09-18T18:01:30-06:00").start("M-1", "learn", minutes=10)["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T18:06:30-06:00").submit(aid, "", {"inner_derivative": "2", "derivative": "14(2x+1)^6"})
    assert r["assessment"]["evidence"] == "acquisition_only"
    assert r["state"]["due"] == "2026-09-19T15:00:00+00:00"  # capped to 09:00 Denver, one hour before 10:00
    assert r["next"]["due"] == "2026-09-19T15:00:00+00:00"
    # After the exam, cram has no slot; ordinary offer still works.
    after = svc(root, "2026-09-19T11:00:00-06:00")
    assert after.offer(cram=True, new_session=True)["kind"] == "no_pre_exam_slot"
    assert after.offer(new_session=True)["kind"] in ("offer", "no_review_needed")


def test_s6_overdue_miss_then_repair(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-07T11:00:00-06:00").import_packet(packet("R"))
    aid = svc(root, "2026-09-07T11:00:00-06:00").start("R-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-07T11:02:00-06:00").submit(aid, "false", {"truth": "false"})
    aid = svc(root, "2026-09-08T11:05:00-06:00").start("R-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-08T11:07:00-06:00").submit(aid, "false", {"truth": "false"})
    assert r["state"]["stability"] == "holding" and r["state"]["due"] == "2026-09-11T17:07:00+00:00"
    # A week passes. One overdue check, one miss: fragile, +4h, no backlog.
    aid = svc(root, "2026-09-18T11:00:00-06:00").start("R-1", "review", minutes=10)["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T11:04:25-06:00").submit(aid, "True. There is a 3% chance the null is right.", {"truth": "true"})
    a = r["assessment"]
    assert (a["outcome"], a["evidence"]) == ("incorrect", "delayed_check")
    assert (r["state"]["stability"], r["state"]["hits"], r["state"]["gap_days"]) == ("fragile", 0, 1)
    assert r["state"]["due"] == "2026-09-18T21:04:25+00:00"  # 15:04:25 Denver
    assert "reverses the conditioning" in r["feedback"]
    # Automatic offer waits for cooldown (23:04 Denver), explicit practice allowed.
    s = svc(root, "2026-09-18T15:05:00-06:00")
    auto = s.offer(new_session=True)
    assert auto["kind"] == "no_review_needed" and auto["next_at"] == "2026-09-19T05:04:25+00:00"
    assert auto["alternatives"][0]["mode"] == "practice"
    assert s.offer(mode="practice")["kind"] == "offer"


# --- selection fixtures ---------------------------------------------------------


def test_f09_f10_skips_hold_due_and_stop_the_session(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    s = svc(root, "2026-09-18T09:00:00-06:00")
    first = s.offer()["item"]["id"]
    aid = s.start(first, "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T09:01:00-06:00").skip(aid)
    assert r["attempt"]["evidence"] == "no_evidence" and r["state"]["due"] is None
    second = svc(root, "2026-09-18T09:02:00-06:00").offer()
    assert second["kind"] == "offer" and second["item"]["id"] != first
    aid = svc(root, "2026-09-18T09:02:00-06:00").start(second["item"]["id"], "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:03:00-06:00").skip(aid)
    stop = svc(root, "2026-09-18T09:03:30-06:00").offer()
    assert stop["kind"] == "no_eligible_item" and stop["action"] == "stop"


def test_f12_f13_f14_f15_empty_and_exam_states(tmp_path: Path) -> None:
    root = tmp_path
    s = svc(root, "2026-09-18T09:00:00-06:00")
    assert s.offer(cram=True)["kind"] == "missing_source"  # F13: import first
    raw = packet("R")
    raw["items"] = []
    raw["exams"] = [{"id": "R-exam", "value": "unknown"}]
    s.import_packet(raw)
    s = svc(root, "2026-09-18T09:01:00-06:00")
    assert s.offer()["kind"] == "no_eligible_item"  # F12: sources, no items
    assert s.offer()["action"] == "create"
    s.set_exam({"id": "R-exam", "value": "date_only", "date": "2026-02-30", "zone": Z})
    s = svc(root, "2026-09-18T09:02:00-06:00")
    assert s.status()["exams"][0]["cutoff_at"] is None  # malformed -> unknown
    raw2 = packet("Q")
    s.import_packet(raw2)
    s.set_exam({"id": "Q-exam", "value": "unknown"})
    s = svc(root, "2026-09-18T09:03:00-06:00")
    assert s.offer(cram=True, course="MATH 1300 (synthetic)")["kind"] == "needs_exam_date"  # F14
    assert s.offer(course="MATH 1300 (synthetic)")["kind"] == "offer"  # ordinary still available
    s.set_exam({"id": "Q-exam", "value": "date_only", "date": "2026-09-10", "zone": Z})
    s = svc(root, "2026-09-18T09:04:00-06:00")
    assert s.offer(cram=True, course="MATH 1300 (synthetic)")["kind"] == "no_pre_exam_slot"  # F15


def test_f16_moved_exam_recaps_effective_due_without_touching_evidence(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-17T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(root, "2026-09-17T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-17T09:01:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    aid = svc(root, "2026-09-18T09:05:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T09:08:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    assert r["state"]["due"] == "2026-09-21T15:08:00+00:00"  # gap 3
    before = svc(root, "2026-09-18T12:00:00-06:00").history("Q-1")["state"]
    s = svc(root, "2026-09-18T12:00:00-06:00")
    s.set_exam({"id": "Q-exam", "value": "date_only", "date": "2026-09-20", "zone": Z, "objective_scope": ["chain-rule"], "course": "MATH 1300 (synthetic)"})
    after = svc(root, "2026-09-18T12:00:00-06:00").history("Q-1")["state"]
    assert after["due"] == before["due"] and after["hits"] == before["hits"]
    assert after["effective_due"] == "2026-09-20T05:00:00+00:00"  # Sep 19 23:00 Denver


def test_f20_withdrawn_packet_gives_recovery_not_crash(tmp_path: Path) -> None:
    root = tmp_path
    s = svc(root, "2026-09-18T09:00:00-06:00")
    s.import_packet(packet("Q"))
    s.withdraw_packet("Q", "unsupported key")
    r = svc(root, "2026-09-18T09:01:00-06:00").offer()
    assert r["kind"] == "no_eligible_item" and "withdrawn" in r["reason"]


def test_f23_cooldown_after_source_read_allows_explicit_practice(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-17T09:00:00-06:00").import_packet(packet("R"))
    aid = svc(root, "2026-09-17T09:00:00-06:00").start("R-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-17T09:01:00-06:00").submit(aid, "false", {"truth": "false"})
    s = svc(root, "2026-09-18T09:00:00-06:00")
    shown = s.read_source("R", "R")
    assert "p-value" in shown["source"]["text"]
    s = svc(root, "2026-09-18T09:00:30-06:00")
    auto = s.offer(new_session=True)
    assert auto["kind"] == "no_review_needed" and auto["next_at"] == "2026-09-19T03:00:00+00:00"
    assert s.offer(mode="practice")["mode"] == "practice"


# --- adversarial / recovery -------------------------------------------------------


def test_reveal_logs_exposure_before_returning_key(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(root, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-18T09:01:00-06:00").reveal(aid)
    assert r["key"]["derivative"].startswith("4 sin")
    assert r["attempt"]["revealed"] is True
    events = read_log(root).events
    assert events[-1].type == "exposure" and events[-1].payload["kind"] == "reveal"
    r = svc(root, "2026-09-18T09:03:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    assert r["assessment"]["evidence"] == "exposed_response"


def test_reveal_write_failure_returns_no_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(root, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    real_open = open

    def failing_open(path: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if str(path).endswith("events.jsonl") and "a" in mode:
            raise OSError(28, "disk full")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", failing_open)
    with pytest.raises(StudyError) as info:
        svc(root, "2026-09-18T09:01:00-06:00").reveal(aid)
    assert info.value.code == "persistence_failed"


def test_hint_then_help_report_and_disagree(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-17T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(root, "2026-09-17T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-17T09:01:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    s = svc(root, "2026-09-18T09:05:00-06:00")
    aid = s.start("Q-1", "review")["attempt"]["attempt_id"]
    hint = svc(root, "2026-09-18T09:06:00-06:00").hint(aid)
    assert "sin x" in hint["hint"] and hint["attempt"]["hints"] == 1
    r = svc(root, "2026-09-18T09:07:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    assert r["assessment"]["evidence"] == "assisted_response" and r["state"]["hits"] == 0
    # A clean credited attempt, then a late help report removes the credit without penalty.
    aid = svc(root, "2026-09-19T09:10:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-19T09:12:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    assert r["state"]["hits"] == 1
    reported = svc(root, "2026-09-19T09:13:00-06:00").report_help(aid, "used my notes")
    assert reported["attempt"]["evidence"] == "unknown_assistance" and reported["state"]["hits"] == 0
    assert reported["attempt"]["fields"]["derivative"]  # the answer is never deleted
    # Disagree on an assessment makes it uncertain; the record survives.
    aid = svc(root, "2026-09-20T09:10:00-06:00").start("Q-2", "review")["attempt"]["attempt_id"]
    r = svc(root, "2026-09-20T09:12:00-06:00").submit(aid, "14(2x+1)^6")
    assert r["assessment"]["outcome"] == "correct"
    d = svc(root, "2026-09-20T09:13:00-06:00").disagree(aid, "I think the key is wrong")
    assert d["attempt"]["outcome"] == "uncertain" and d["attempt"]["evidence"] == "no_evidence"


def test_new_attempt_interrupts_old_open_one_and_keeps_draft_history(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    s = svc(root, "2026-09-18T09:00:00-06:00")
    aid = s.start("Q-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:01:00-06:00").draft(aid, "half")
    status = svc(root, "2026-09-18T09:02:00-06:00").status()
    assert status["open_attempts"][0]["draft"] == "half"
    # Skip to close it, start again -> new attempt id, history retained.
    svc(root, "2026-09-18T09:02:30-06:00").skip(aid)
    aid2 = svc(root, "2026-09-18T09:03:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    assert aid2 != aid
    history = svc(root, "2026-09-18T09:04:00-06:00").history("Q-1")
    assert [a["status"] for a in history["attempts"]] == ["open", "assessed"]  # newest first
    assert history["total"] == 2


def test_projection_replay_matches_cached_state(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    aid = svc(root, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:02:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3(x)cos(x)"})
    cached = json.loads((root / "study" / "projection.json").read_text(encoding="utf-8"))
    (root / "study" / "projection.json").unlink()
    rebuilt = svc(root, "2026-09-18T09:03:00-06:00").projection.to_dict()
    assert rebuilt["items"] == cached["items"] and rebuilt["last_seq"] == cached["last_seq"]


def test_stale_source_blocks_scoring(tmp_path: Path) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    path = root / "study" / "packets" / "Q.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["sources"][0]["text"] += " (edited later)"
    path.write_text(json.dumps(raw), encoding="utf-8")
    s = svc(root, "2026-09-18T09:01:00-06:00")
    assert s.status()["packets"][0]["stale_sources"] == ["Q"]
    assert s.offer()["kind"] == "no_eligible_item"


def test_import_conflict_requires_version_bump(tmp_path: Path) -> None:
    s = svc(tmp_path, "2026-09-18T09:00:00-06:00")
    s.import_packet(packet("Q"))
    with pytest.raises(StudyError) as info:
        svc(tmp_path, "2026-09-18T09:01:00-06:00").import_packet(packet("Q"))
    assert info.value.code == "conflict"
    bumped = packet("Q")
    bumped["version"] = 2
    assert svc(tmp_path, "2026-09-18T09:02:00-06:00").import_packet(bumped)["version"] == 2


def test_clock_anomaly_marks_attempt_uncertain(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    clock = root / "study" / "clock.json"
    clock.write_text(json.dumps({"wall": (datetime.now().astimezone() - timedelta(days=7)).isoformat(), "mono": 0.0}), encoding="utf-8")
    monkeypatch.setattr("canvas_mcp.core.study.clock._sleep_aware_monotonic", lambda: 1.0)
    s = StudyService(root, zone=Z)  # real clock path: wall jumped 7 days vs 1s monotonic
    assert s.clock_status == "uncertain"
    started = s.start("Q-1", "review")
    assert started["attempt"]["clock_status"] == "uncertain"
    assert any(e.type == "clock_anomaly" for e in read_log(root).events)
    # The anomaly does not latch: the next invocation re-samples and is trusted.
    monkeypatch.setattr("canvas_mcp.core.study.clock._sleep_aware_monotonic", lambda: 2.0)
    assert StudyService(root, zone=Z).clock_status == "trusted"


def test_resume_records_a_work_item_the_first_start_omitted(tmp_path: Path) -> None:
    root = tmp_path
    s = svc(root, "2026-09-18T09:00:00-06:00")
    s.import_packet(packet("Q"))
    s.start("Q-1", "review", work_item_id="canvas:totally:invalid")
    assert s.projection.items["Q-1"].work_item_id is None
    resumed = s.start("Q-1", "review", work_item_id="canvas:cu-boulder:1300:assignment:101")
    assert resumed["resumed"] is True
    assert s.projection.items["Q-1"].work_item_id == "canvas:cu-boulder:1300:assignment:101"
    s.start("Q-1", "review", work_item_id="canvas:cu-boulder:1300:assignment:102")
    assert s.projection.items["Q-1"].work_item_id == "canvas:cu-boulder:1300:assignment:101"


def test_cli_envelope_and_errors(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = str(tmp_path)
    assert study_main(["--user-root", root, "--zone", Z, "--now", "2026-09-18T09:00:00-06:00", "status"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["ok"] and out["items"]["active"] == 0
    assert study_main(["--user-root", root, "--now", "2026-09-18T09:00:00-06:00", "import", "--path", str(PACKETS / "Q.json")]) == 0
    capsys.readouterr()
    assert study_main(["--user-root", root, "--now", "2026-09-18T09:00:00-06:00", "start", "--item", "nope"]) == 1
    err = json.loads(capsys.readouterr().out.strip().splitlines()[0])
    assert err["ok"] is False and err["error"]["code"] == "not_found"
    assert study_main(["--user-root", root, "--now", "2026-09-18T09:00:00-06:00", "offer", "--mode", "bogus"]) == 1


def test_two_profiles_do_not_share_study_state(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    svc(a, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    assert svc(b, "2026-09-18T09:00:00-06:00").offer()["kind"] == "missing_source"
    assert not os.path.exists(b / "study" / "events.jsonl")


def test_reload_offers_the_unfinished_attempt_first(tmp_path: Path) -> None:
    """A saved draft is offered before anything else, even after a reload in
    the same session (the UI defect found in the 2026-09-18 walkthrough)."""
    root = tmp_path
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(packet("Q"))
    s = svc(root, "2026-09-18T09:00:00-06:00")
    first = s.offer()["item"]["id"]
    aid = s.start(first, "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:01:00-06:00").submit(aid, "", {"inner": "x", "derivative": "y"})
    other = svc(root, "2026-09-18T09:02:00-06:00").offer()["item"]["id"]
    assert other != first
    aid2 = svc(root, "2026-09-18T09:02:00-06:00").start(other, "practice")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:03:00-06:00").draft(aid2, "half an answer")
    # "Reload": a fresh offer in the same session must surface the open attempt.
    offer = svc(root, "2026-09-18T09:04:00-06:00").offer()
    assert offer["kind"] == "offer" and offer["item"]["id"] == other
    assert offer["resume"]["attempt_id"] == aid2 and offer["resume"]["draft"] == "half an answer"
    assert offer["mode"] == "practice"
    resumed = svc(root, "2026-09-18T09:04:30-06:00").start(other, "practice")
    assert resumed["resumed"] and resumed["attempt"]["attempt_id"] == aid2
