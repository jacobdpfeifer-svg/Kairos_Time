"""Reducer fixtures F01–F32 from the revised study-session spec (§3.5).

Expected values are written out by hand from the specification tables, not
computed with the reducer's own helpers, so a wrong transition fails here.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from canvas_mcp.core.study.model import Event, ItemState, Projection
from canvas_mcp.core.study.reducer import eligible, reduce

Z = "America/Denver"
ITEM = "B-1"
OBJ = "obj-b"


def T(text: str) -> datetime:
    return datetime.fromisoformat(text)


def base_b(
    *,
    due: str | None = "2026-09-18T09:00:00-06:00",
    anchor: str | None = "2026-09-15T09:00:00-06:00",
    gap: int = 3,
    hits: int = 0,
    stability: str = "fragile",
) -> Projection:
    proj = Projection()
    state = ItemState(item_id=ITEM, objective_id=OBJ)
    state.due = T(due) if due else None
    state.anchor = T(anchor) if anchor else None
    state.gap_days = gap
    state.hits = hits
    state.stability = stability
    state.encountered = anchor is not None
    state.schedule_status = "scheduled" if due else "unscheduled"
    proj.items[ITEM] = state
    if anchor:
        proj.encounters[OBJ] = [(0, T(anchor), "practice")]
    proj.last_seq = 0
    return proj


class Log:
    def __init__(self) -> None:
        self.events: list[Event] = []
        self.seq = 0

    def add(self, type_: str, at: str, payload: dict, event_id: str | None = None) -> Event:
        self.seq += 1
        ev = Event(event_id=event_id or f"e{self.seq}", type=type_, at=T(at), zone=Z, payload=payload, seq=self.seq)
        self.events.append(ev)
        return ev

    def attempt(self, aid: str, start: str, mode: str = "review", clock: str = "trusted") -> None:
        self.add("attempt_started", start, {"attempt_id": aid, "item_id": ITEM, "objective_id": OBJ, "mode": mode, "clock_status": clock})

    def submit(self, aid: str, at: str) -> None:
        self.add("attempt_submitted", at, {"attempt_id": aid, "response_text": "x", "fields": {}}, event_id=f"{aid}:submit")

    def assess(self, aid: str, at: str, outcome: str = "correct", grader: str = "deterministic", **extra: object) -> Event:
        payload = {"attempt_id": aid, "outcome": outcome, "grader": grader, "scope": "s", "source_valid": True, **extra}
        return self.add("assessment", at, payload, event_id=f"{aid}:assess")

    def exposure(self, at: str, kind: str, solution: str = "yes", aid: str | None = None) -> None:
        self.add("exposure", at, {"attempt_id": aid, "objective_ids": [OBJ], "kind": kind, "solution_bearing": solution, "surface": kind})


def run(proj: Projection, log: Log) -> Projection:
    return reduce(log.events, projection=proj)


def attempt_a(log: Log, aid: str = "a1", outcome: str = "correct", **extra: object) -> None:
    log.attempt(aid, "2026-09-18T09:00:00-06:00")
    log.submit(aid, "2026-09-18T09:03:00-06:00")
    log.assess(aid, "2026-09-18T09:03:00-06:00", outcome, **extra)


def test_f01_due_clean_correct_advances() -> None:
    proj, log = base_b(), Log()
    attempt_a(log)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert (s.stability, s.hits, s.gap_days) == ("holding", 1, 7)
    assert s.due == T("2026-09-25T09:03:00-06:00")
    assert proj.attempts["a1"].evidence == "delayed_independent_retrieval"


def test_f02_not_yet_due_holds() -> None:
    proj, log = base_b(due="2026-09-19T09:00:00-06:00"), Log()
    attempt_a(log)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert (s.stability, s.hits, s.gap_days) == ("fragile", 0, 3)
    assert s.due == T("2026-09-19T09:00:00-06:00")
    assert s.anchor == T("2026-09-18T09:03:00-06:00")
    assert proj.attempts["a1"].evidence == "immediate_practice"


def test_f03_pre_attempt_excerpt_resets_anchor_and_cooldown() -> None:
    proj, log = base_b(), Log()
    log.exposure("2026-09-18T08:59:00-06:00", "source_read", "yes")
    attempt_a(log)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a1"].evidence == "immediate_practice"
    assert s.due == T("2026-09-18T09:00:00-06:00")
    assert s.hits == 0
    assert s.cooldown == T("2026-09-18T20:59:00-06:00")


def test_f04_hint_is_assisted() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.exposure("2026-09-18T09:01:00-06:00", "hint", "no", aid="a1")
    log.submit("a1", "2026-09-18T09:03:00-06:00")
    log.assess("a1", "2026-09-18T09:03:00-06:00")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a1"].evidence == "assisted_response"
    assert (s.stability, s.hits, s.due) == ("fragile", 0, T("2026-09-18T09:00:00-06:00"))
    assert s.anchor == T("2026-09-18T09:03:00-06:00")


def test_f05_f06_reveal_then_immediate_then_clean_days_later() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.exposure("2026-09-18T09:01:00-06:00", "reveal", "yes", aid="a1")
    log.submit("a1", "2026-09-18T09:03:00-06:00")
    log.assess("a1", "2026-09-18T09:03:00-06:00")
    log.attempt("a2", "2026-09-18T09:04:00-06:00")
    log.submit("a2", "2026-09-18T09:05:00-06:00")
    log.assess("a2", "2026-09-18T09:05:00-06:00")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "exposed_response"
    assert proj.attempts["a2"].evidence == "immediate_practice"
    s = proj.items[ITEM]
    assert s.hits == 0 and s.due == T("2026-09-18T09:00:00-06:00")
    assert s.cooldown == T("2026-09-18T21:01:00-06:00")
    # F06: Sep 21 09:10 clean attempt — more than 3 local days after the 09:05 practice
    log.attempt("a3", "2026-09-21T09:10:00-06:00")
    log.submit("a3", "2026-09-21T09:14:00-06:00")
    log.assess("a3", "2026-09-21T09:14:00-06:00")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a3"].evidence == "delayed_independent_retrieval"
    assert (s.stability, s.hits, s.gap_days) == ("holding", 1, 7)
    assert s.due == T("2026-09-28T09:14:00-06:00")


def test_f07_partial_demotes_durable() -> None:
    proj, log = base_b(hits=2, stability="durable"), Log()
    attempt_a(log, outcome="partial")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert (s.stability, s.hits, s.gap_days) == ("holding", 1, 1)
    assert s.due == T("2026-09-19T09:03:00-06:00")


def test_f08_incorrect_near_exam_offers_in_one_hour() -> None:
    proj, log = base_b(hits=1, stability="holding"), Log()
    attempt_a(log, outcome="incorrect", cutoff_at="2026-09-18T13:00:00-06:00", exam_future=True, exam_within_24h=True)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert (s.stability, s.hits, s.gap_days) == ("fragile", 0, 1)
    assert s.due == T("2026-09-18T10:03:00-06:00")
    assert proj.attempts["a1"].evidence == "delayed_check"


def test_f09_skip_holds_due_and_earns_nothing() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.assess("a1", "2026-09-18T09:01:00-06:00", "skipped", "abstained")
    log.attempt("a2", "2026-09-18T09:02:00-06:00")
    log.assess("a2", "2026-09-18T09:03:00-06:00", "skipped", "abstained")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert s.due == T("2026-09-18T09:00:00-06:00") and s.hits == 0
    assert s.anchor == T("2026-09-15T09:00:00-06:00")
    assert proj.attempts["a1"].evidence == "no_evidence"


def test_f18_dst_crossing_uses_local_days() -> None:
    proj, log = base_b(due="2026-10-31T20:00:00-06:00", anchor="2026-10-30T20:00:00-06:00", gap=1), Log()
    log.attempt("a1", "2026-10-31T20:00:00-06:00")
    log.submit("a1", "2026-10-31T20:05:00-06:00")
    log.assess("a1", "2026-10-31T20:05:00-06:00", cutoff_at="2026-11-04T23:00:00-07:00", exam_future=True)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert s.gap_days == 3
    assert s.due == T("2026-11-03T20:05:00-07:00")
    assert s.due - T("2026-10-31T20:05:00-06:00") == timedelta(hours=73)


def test_f19_duplicate_event_id_is_ignored_by_replay() -> None:
    log = Log()
    attempt_a(log)
    first = run(base_b(), log)
    # Replaying the same events (same ids) from the cached projection changes nothing.
    again = reduce(log.events, projection=first)
    assert again.items[ITEM].to_dict() == first.items[ITEM].to_dict()
    assert again.items[ITEM].hits == 1


def test_f21_fresh_item_baseline() -> None:
    proj, log = base_b(due=None, anchor=None, gap=1), Log()
    attempt_a(log)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a1"].evidence == "baseline_response"
    assert (s.stability, s.hits, s.gap_days) == ("fragile", 0, 1)
    assert s.due == T("2026-09-19T09:03:00-06:00")


def test_f22_cutoff_already_passed_gives_no_pre_exam_slot() -> None:
    proj, log = base_b(), Log()
    attempt_a(log, cutoff_at="2026-09-18T08:30:00-06:00", exam_future=True, exam_within_24h=True)
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert s.schedule_status == "no_pre_exam_slot"
    assert s.due == T("2026-09-18T09:00:00-06:00")  # held, never a past NextAt
    assert (s.stability, s.hits) == ("holding", 1)


def test_f24_start_before_due_is_practice_even_if_submitted_after() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T08:59:00-06:00")
    log.submit("a1", "2026-09-18T09:03:00-06:00")
    log.assess("a1", "2026-09-18T09:03:00-06:00")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "immediate_practice"
    assert proj.items[ITEM].hits == 0


def test_f25_resume_keeps_original_attempt_and_credit() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.add("draft_saved", "2026-09-18T09:01:00-06:00", {"attempt_id": "a1", "revision": 1, "text": "partial draft"})
    # crash at 09:02; resume at 09:10 reuses a1
    log.submit("a1", "2026-09-18T09:15:00-06:00")
    log.assess("a1", "2026-09-18T09:15:00-06:00")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a1"].evidence == "delayed_independent_retrieval"
    assert s.due == T("2026-09-25T09:15:00-06:00")


def test_f25b_resume_after_reveal_before_crash_gets_no_credit() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.exposure("2026-09-18T09:01:00-06:00", "reveal", "yes", aid="a1")
    log.submit("a1", "2026-09-18T09:15:00-06:00")
    log.assess("a1", "2026-09-18T09:15:00-06:00")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "exposed_response"
    assert proj.items[ITEM].hits == 0


def test_f26_model_only_grade_is_unverified() -> None:
    proj, log = base_b(), Log()
    attempt_a(log, grader="model_proposed")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "unverified_response"
    s = proj.items[ITEM]
    assert s.hits == 0 and s.due == T("2026-09-18T09:00:00-06:00")


def test_f26b_stale_source_is_unverified() -> None:
    proj, log = base_b(), Log()
    attempt_a(log, source_valid=False)
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "unverified_response"
    assert proj.items[ITEM].hits == 0


def test_f29_clock_uncertain_records_no_temporal_evidence() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-25T09:00:00-06:00", clock="uncertain")
    log.submit("a1", "2026-09-25T09:03:00-06:00")
    log.assess("a1", "2026-09-25T09:03:00-06:00")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert proj.attempts["a1"].evidence == "clock_uncertain"
    assert s.hits == 0 and s.due == T("2026-09-18T09:00:00-06:00")


def test_f30_caps_by_exam_distance() -> None:
    expectations = {
        "2026-09-18T23:00:00-06:00": "2026-09-18T23:00:00-06:00",  # tomorrow
        "2026-09-20T23:00:00-06:00": "2026-09-20T23:00:00-06:00",  # 3d
        "2026-09-24T23:00:00-06:00": "2026-09-24T23:00:00-06:00",  # 7d
        "2026-10-02T23:00:00-06:00": "2026-09-25T09:03:00-06:00",  # 15d: gap wins
    }
    for cutoff, expected in expectations.items():
        proj, log = base_b(), Log()
        attempt_a(log, cutoff_at=cutoff, exam_future=True)
        proj = run(proj, log)
        assert proj.items[ITEM].due == T(expected), cutoff


def test_f31_late_attempt_is_one_success_not_several() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-29T09:00:00-06:00")
    log.submit("a1", "2026-09-29T09:03:00-06:00")
    log.assess("a1", "2026-09-29T09:03:00-06:00")
    proj = run(proj, log)
    s = proj.items[ITEM]
    assert (s.stability, s.hits, s.gap_days) == ("holding", 1, 7)
    assert s.due == T("2026-10-06T09:03:00-06:00")


def test_f32_help_report_after_credit_replays_without_penalty() -> None:
    log = Log()
    attempt_a(log)
    credited = run(base_b(), log)
    assert credited.items[ITEM].hits == 1
    log.add("correction", "2026-09-18T09:04:00-06:00", {"target_attempt_id": "a1", "target_event_id": "a1:assess", "reason_code": "unknown_assistance"})
    replayed = run(base_b(), log)
    s = replayed.items[ITEM]
    assert replayed.attempts["a1"].evidence == "unknown_assistance"
    assert (s.stability, s.hits) == ("fragile", 0)
    assert s.due == T("2026-09-18T09:00:00-06:00")
    assert s.anchor == T("2026-09-18T09:03:00-06:00")


def test_correction_replay_preserves_later_valid_work() -> None:
    log = Log()
    attempt_a(log)  # credited -> gap 7, due Sep 25
    log.attempt("a2", "2026-09-25T09:10:00-06:00")
    log.submit("a2", "2026-09-25T09:12:00-06:00")
    log.assess("a2", "2026-09-25T09:12:00-06:00")
    before = run(base_b(), log)
    assert before.items[ITEM].hits == 2
    # Invalidate the FIRST assessment (bad key). a2 must be re-evaluated, not erased.
    log.add("correction", "2026-09-26T09:00:00-06:00", {"target_event_id": "a1:assess", "reason_code": "invalid_assessment"})
    after = run(base_b(), log)
    assert after.attempts["a1"].evidence == "invalidated"
    assert "a2" in after.attempts and after.attempts["a2"].status == "assessed"
    # With a1 invalidated, the item was still due Sep 18 (held) and a2 came 10 days
    # after the Sep 15 anchor with gap 3 -> a2 is the first eligible success.
    assert after.attempts["a2"].evidence == "delayed_independent_retrieval"
    assert after.items[ITEM].hits == 1


def test_feedback_after_submission_does_not_contaminate_attempt() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00")
    log.submit("a1", "2026-09-18T09:03:00-06:00")
    log.assess("a1", "2026-09-18T09:03:00-06:00")
    log.exposure("2026-09-18T09:03:05-06:00", "feedback", "yes", aid="a1")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "delayed_independent_retrieval"
    assert proj.items[ITEM].cooldown == T("2026-09-18T21:03:05-06:00")


def test_learn_mode_is_acquisition_only_even_when_correct() -> None:
    proj, log = base_b(), Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00", mode="learn")
    log.exposure("2026-09-18T09:00:25-06:00", "example", "yes", aid="a1")
    log.submit("a1", "2026-09-18T09:07:00-06:00")
    log.assess("a1", "2026-09-18T09:07:00-06:00")
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "acquisition_only"
    assert proj.items[ITEM].hits == 0


def test_eligibility_floor_twelve_hours() -> None:
    proj = base_b(due="2026-09-18T09:00:00-06:00", anchor="2026-09-18T03:00:00-06:00", gap=1)
    log = Log()
    # gap of 1 local day from 03:00 is Sep 19 03:00 -> not eligible at 09:00 on Sep 18
    attempt_a(log)
    proj = run(proj, log)
    assert proj.attempts["a1"].evidence == "immediate_practice"


def test_attempt_can_name_a_work_item_without_rewriting_history() -> None:
    proj = base_b()
    log = Log()
    log.add(
        "attempt_started",
        "2026-09-18T09:00:00-06:00",
        {
            "attempt_id": "a1",
            "item_id": ITEM,
            "objective_id": OBJ,
            "mode": "review",
            "work_item_id": "canvas:cu-boulder:1300:assignment:101",
        },
    )
    proj = run(proj, log)
    assert proj.items[ITEM].work_item_id == "canvas:cu-boulder:1300:assignment:101"
    assert "answer" not in proj.items[ITEM].to_dict()
    historical = base_b()
    old = Log()
    old.attempt("a1", "2026-09-18T09:00:00-06:00")
    historical = run(historical, old)
    assert historical.items[ITEM].work_item_id is None
    assert "work_item_id" not in historical.items[ITEM].to_dict()
    rejected = base_b()
    bad = Log()
    bad.add(
        "attempt_started",
        "2026-09-18T09:00:00-06:00",
        {
            "attempt_id": "a1",
            "item_id": ITEM,
            "objective_id": OBJ,
            "mode": "review",
            "work_item_id": "canvas:totally:invalid",
        },
    )
    rejected = run(rejected, bad)
    assert rejected.items[ITEM].work_item_id is None


def test_eligible_reports_reason() -> None:
    proj = base_b()
    log = Log()
    log.attempt("a1", "2026-09-18T09:00:00-06:00", mode="practice")
    proj = run(proj, log)
    ok, reason = eligible(proj, proj.items[ITEM], proj.attempts["a1"], Z)
    assert not ok and reason == "practice mode"
