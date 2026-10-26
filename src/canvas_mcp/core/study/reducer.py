"""Pure fold from ordered events to a projection (revised spec §3).

``reduce(events)`` is deterministic and offline: no clock reads, no provider
calls, no file access. Corrections are collected first so a replay applies
them at the event they target — later valid work is recomputed, never erased.
Exam cutoffs are read from the assessment payload (snapshotted by the service
at write time) so replay does not depend on today's exam records.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .clock import calendar_add, expand_gap
from .model import (
    COOLDOWN_HOURS,
    ELAPSED_FLOOR_HOURS,
    AttemptState,
    Event,
    ItemState,
    Projection,
    parse_instant,
    valid_work_item_id,
)

ENCOUNTER_KINDS = ("practice", "exposure", "hint")


def _encounters_before(
    projection: Projection, objective_id: str, seq: int
) -> datetime | None:
    rows = projection.encounters.get(objective_id) or []
    best: datetime | None = None
    for row_seq, at, _kind in rows:
        if row_seq < seq and (best is None or at > best):
            best = at
    return best


def _add_encounter(projection: Projection, objective_id: str, seq: int, at: datetime, kind: str) -> None:
    projection.encounters.setdefault(objective_id, []).append((seq, at, kind))


def during_attempt(attempt: AttemptState) -> list[dict[str, Any]]:
    """Exposures logged between attempt start and submission (spec ``clean_during``)."""
    return [e for e in attempt.exposures if not e.get("after_submission")]


def _items_for_objective(projection: Projection, objective_id: str) -> list[ItemState]:
    return [s for s in projection.items.values() if s.objective_id == objective_id]


def _apply_cooldown(projection: Projection, objective_ids: list[str], at: datetime) -> None:
    until = at + timedelta(hours=COOLDOWN_HOURS)
    for oid in objective_ids:
        for state in _items_for_objective(projection, oid):
            if state.cooldown is None or until > state.cooldown:
                state.cooldown = until


def eligible(
    projection: Projection,
    state: ItemState,
    attempt: AttemptState,
    zone: str,
) -> tuple[bool, str]:
    """Spec §3.3 ``eligible``. Returns (eligible, reason-if-not)."""
    anchor = _encounters_before(projection, state.objective_id, attempt.start_seq)
    if anchor is None:
        return False, "first encounter"
    if state.due is None:
        return False, "no scheduled check"
    if attempt.started_at < state.due:
        return False, "started before the scheduled check"
    if attempt.started_at < calendar_add(anchor, state.gap_days, zone):
        return False, "planned gap not yet elapsed"
    if attempt.started_at - anchor < timedelta(hours=ELAPSED_FLOOR_HOURS):
        return False, "less than 12 hours since the last encounter"
    if attempt.mode != "review":
        return False, f"{attempt.mode} mode"
    if attempt.revealed or any(
        e.get("solution_bearing") in ("yes", "unknown") for e in during_attempt(attempt)
    ):
        return False, "solution-bearing material seen during the attempt"
    if attempt.hints:
        return False, "hint used"
    if attempt.assistance != "none":
        return False, "assistance reported"
    if attempt.clock_status != "trusted":
        return False, "clock uncertain"
    return True, ""


def classify(
    state: ItemState,
    attempt: AttemptState,
    *,
    outcome: str,
    grader: str,
    source_valid: bool,
    was_eligible: bool,
    fresh: bool,
    invalidated: bool,
) -> str:
    if invalidated or state.validity == "withdrawn":
        return "invalidated"
    if outcome in ("skipped", "interrupted", "uncertain") or grader == "pending":
        return "no_evidence"
    if attempt.clock_status != "trusted":
        return "clock_uncertain"
    if grader != "deterministic" or not source_valid:
        return "unverified_response"
    if attempt.mode == "learn":
        return "acquisition_only"
    if attempt.revealed or any(e.get("solution_bearing") == "yes" for e in during_attempt(attempt)):
        return "exposed_response"
    if attempt.hints:
        return "assisted_response"
    if attempt.assistance != "none" or any(
        e.get("solution_bearing") == "unknown" for e in during_attempt(attempt)
    ):
        return "unknown_assistance"
    if fresh:
        return "baseline_response"
    if not was_eligible:
        return "immediate_practice"
    return "delayed_independent_retrieval" if outcome == "correct" else "delayed_check"


def _schedule(
    state: ItemState,
    candidate: datetime,
    now: datetime,
    cutoff: datetime | None,
    exam_future: bool,
) -> None:
    """Apply a new date; never a past NextAt. Preserves explicit no-slot status."""
    if exam_future and cutoff is not None:
        if cutoff <= now:
            state.schedule_status = "no_pre_exam_slot"
            return
        candidate = min(candidate, cutoff)
    if candidate <= now:
        candidate = now + timedelta(minutes=1)
    state.due = candidate
    state.schedule_status = "scheduled"


def reduce(events: list[Event], *, projection: Projection | None = None) -> Projection:
    """Fold events in order. Pass an existing projection to continue from ``last_seq``."""
    proj = projection or Projection()
    corrections_by_event: dict[str, list[dict[str, Any]]] = {}
    corrections_by_attempt: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        if event.type == "correction":
            payload = event.payload
            target_event = payload.get("target_event_id")
            target_attempt = payload.get("target_attempt_id")
            if target_event:
                corrections_by_event.setdefault(str(target_event), []).append(payload)
            if target_attempt:
                corrections_by_attempt.setdefault(str(target_attempt), []).append(payload)

    for event in events:
        if event.seq <= proj.last_seq:
            continue
        _apply(proj, event, corrections_by_event, corrections_by_attempt)
        proj.last_seq = event.seq
    return proj


def _apply(
    proj: Projection,
    event: Event,
    corrections_by_event: dict[str, list[dict[str, Any]]],
    corrections_by_attempt: dict[str, list[dict[str, Any]]],
) -> None:
    p = event.payload
    t = event.type
    if t == "packet_imported":
        packet_id = str(p.get("packet_id"))
        proj.packets[packet_id] = {"version": int(p.get("version") or 1), "imported_at": event.at.isoformat()}
        for item_id, objective_id in (p.get("objective_map") or {}).items():
            if item_id not in proj.items:
                proj.items[item_id] = ItemState(item_id=item_id, objective_id=str(objective_id))
            proj.items[item_id].validity = "active"
            proj.items[item_id].last_event_seq = event.seq
        return
    if t == "packet_withdrawn":
        for item_id in p.get("item_ids") or []:
            if item_id in proj.items:
                proj.items[item_id].validity = "withdrawn"
                proj.items[item_id].last_event_seq = event.seq
        return
    if t == "clock_anomaly":
        proj.clock_anomalies += 1
        return
    if t == "attempt_started":
        attempt_id = str(p["attempt_id"])
        item_id = str(p["item_id"])
        for other in proj.attempts.values():
            if other.item_id == item_id and other.status == "open" and other.attempt_id != attempt_id:
                other.status = "interrupted"
        item_state = proj.items.get(item_id)
        linked = valid_work_item_id(p.get("work_item_id"))
        if item_state is not None and linked:
            item_state.work_item_id = linked
        proj.attempts[attempt_id] = AttemptState(
            attempt_id=attempt_id,
            item_id=item_id,
            objective_id=str(p.get("objective_id") or proj.items.get(item_id, ItemState(item_id, "")).objective_id),
            mode=str(p.get("mode") or "review"),
            started_at=event.at,
            start_seq=event.seq,
            clock_status=str(p.get("clock_status") or "trusted"),
            packet_version=int(p.get("packet_version") or 0),
        )
        for corr in corrections_by_attempt.get(attempt_id, []):
            if corr.get("reason_code") == "unknown_assistance":
                proj.attempts[attempt_id].assistance = "unknown"
                proj.attempts[attempt_id].corrections.append(str(corr.get("event_id") or ""))
        return
    if t == "work_item_linked":
        item_state = proj.items.get(str(p.get("item_id") or ""))
        linked = valid_work_item_id(p.get("work_item_id"))
        if item_state is not None and linked and not item_state.work_item_id:
            item_state.work_item_id = linked
        return
    if t == "draft_saved":
        attempt = proj.attempts.get(str(p.get("attempt_id")))
        if attempt is None or attempt.status not in ("open", "interrupted"):
            return
        revision = int(p.get("revision") or 0)
        # Strictly increasing: an equal revision from a stale writer is ignored,
        # so the newest saved text survives (audit A finding 6).
        if revision > attempt.draft_revision:
            attempt.draft = str(p.get("text") or "")
            attempt.draft_revision = revision
            attempt.draft_saved_at = event.at
            attempt.status = "open"
        return
    if t == "exposure":
        objective_ids = [str(o) for o in (p.get("objective_ids") or [])]
        record = {
            "seq": event.seq,
            "at": event.at.isoformat(),
            "kind": str(p.get("kind") or "source_read"),
            "solution_bearing": str(p.get("solution_bearing") or "unknown"),
            "surface": str(p.get("surface") or ""),
            "objective_ids": objective_ids,
        }
        exposure_attempt_id = p.get("attempt_id")
        exposed = proj.attempts.get(str(exposure_attempt_id)) if exposure_attempt_id else None
        substantive = record["solution_bearing"] in ("yes", "unknown") or record["kind"] == "hint"
        if exposed is not None and exposed.status in ("open", "interrupted"):
            if record["kind"] == "hint":
                exposed.hints += 1
            else:
                exposed.exposures.append(record)
                if record["kind"] == "reveal" and record["solution_bearing"] == "yes":
                    exposed.revealed = True
        elif exposed is not None:
            # After submission: feedback/reveal cannot contaminate the closed attempt.
            exposed.exposures.append({**record, "after_submission": True})
        if substantive:
            for oid in objective_ids:
                _add_encounter(proj, oid, event.seq, event.at, "hint" if record["kind"] == "hint" else "exposure")
                for sibling in _items_for_objective(proj, oid):
                    if sibling.anchor is None or event.at > sibling.anchor:
                        sibling.anchor = event.at
            _apply_cooldown(proj, objective_ids, event.at)
        return
    if t == "attempt_submitted":
        attempt = proj.attempts.get(str(p.get("attempt_id")))
        if attempt is None:
            return
        if attempt.status in ("submitted", "assessed"):
            return  # duplicate submission: first one owns the record
        attempt.status = "submitted"
        attempt.response = str(p.get("response_text") or "")
        attempt.fields = {str(k): str(v) for k, v in (p.get("fields") or {}).items()}
        attempt.submitted_at = event.at
        attempt.submit_seq = event.seq
        return
    if t == "assessment":
        _apply_assessment(proj, event, corrections_by_event)
        return
    if t == "plan_review":
        state = proj.items.get(str(p.get("item_id")))
        if state is None:
            return
        try:
            requested = parse_instant(p.get("requested_future_at"), "requested_future_at")
        except Exception:
            return
        if requested > event.at:
            state.due = requested
            state.schedule_status = "scheduled"
            state.last_event_seq = event.seq
        return
    if t == "ai_proposal":
        attempt = proj.attempts.get(str(p.get("attempt_id")))
        if attempt is not None:
            attempt.proposals.append(
                {
                    "request_id": str(p.get("request_id") or ""),
                    "status": str(p.get("status") or ""),
                    "proposal": p.get("proposal"),
                    "model_id": p.get("model_id"),
                    "error": p.get("error"),
                    "at": event.at.isoformat(),
                }
            )
        return
    if t == "correction":
        # Handled in the pre-pass; nothing to fold here.
        return


def _apply_assessment(
    proj: Projection, event: Event, corrections_by_event: dict[str, list[dict[str, Any]]]
) -> None:
    p = event.payload
    attempt = proj.attempts.get(str(p.get("attempt_id")))
    if attempt is None:
        return
    if attempt.assessment_event_id is not None:
        return  # already assessed: a second assessment is ignored (same acknowledgment)
    state = proj.items.get(attempt.item_id)
    if state is None:
        return
    zone = event.zone or "UTC"
    outcome = str(p.get("outcome") or "uncertain")
    grader = str(p.get("grader") or "pending")
    source_valid = bool(p.get("source_valid", True))
    invalidated = False
    for corr in corrections_by_event.get(event.event_id, []):
        code = corr.get("reason_code")
        if code == "invalid_assessment":
            invalidated = True
        elif code == "disagree":
            outcome = "uncertain"
        elif code == "unknown_assistance":
            attempt.assistance = "unknown"
        attempt.corrections.append(str(corr.get("event_id") or ""))

    fresh = not state.encountered
    was_eligible, _reason = eligible(proj, state, attempt, zone)
    label = classify(
        state,
        attempt,
        outcome=outcome,
        grader=grader,
        source_valid=source_valid,
        was_eligible=was_eligible,
        fresh=fresh,
        invalidated=invalidated,
    )
    attempt.status = "assessed"
    attempt.outcome = outcome
    attempt.grader = grader
    attempt.scope = str(p.get("scope") or "")
    attempt.evidence = label
    attempt.feedback = p.get("feedback") if isinstance(p.get("feedback"), dict) else None
    attempt.assessment_event_id = event.event_id
    state.last_event_seq = event.seq
    state.last_evidence = label
    state.last_outcome = outcome
    submitted_at = attempt.submitted_at or event.at

    if label in ("invalidated", "no_evidence"):
        return
    if label == "clock_uncertain":
        _add_encounter(proj, state.objective_id, event.seq, submitted_at, "practice")
        state.anchor = submitted_at
        state.encountered = True
        return
    # Any assessed answer is a substantive encounter, credited or not.
    _add_encounter(proj, state.objective_id, event.seq, submitted_at, "practice")
    for sibling in _items_for_objective(proj, state.objective_id):
        if sibling.anchor is None or submitted_at > sibling.anchor:
            sibling.anchor = submitted_at
    if label == "unverified_response":
        state.encountered = True
        return

    cutoff_raw = p.get("cutoff_at")
    cutoff: datetime | None = parse_instant(cutoff_raw, "cutoff_at") if cutoff_raw else None
    exam_future = bool(p.get("exam_future", False))
    exam_within_24h = bool(p.get("exam_within_24h", False))

    if fresh:
        state.encountered = True
        state.gap_days = 1
        state.hits = 0
        state.stability = "fragile"
        _schedule(state, calendar_add(submitted_at, 1, zone), submitted_at, cutoff, exam_future)
        return
    if not was_eligible:
        return  # hold stability and due
    if outcome == "correct":
        state.hits += 1
        state.stability = "holding" if state.hits == 1 else "durable"
        state.gap_days = expand_gap(state.gap_days)
        _schedule(state, calendar_add(submitted_at, state.gap_days, zone), submitted_at, cutoff, exam_future)
        return
    if outcome == "partial":
        state.hits = max(0, state.hits - 1)
        state.stability = "holding" if state.stability == "durable" else "fragile"
        state.gap_days = 1
        _schedule(state, calendar_add(submitted_at, 1, zone), submitted_at, cutoff, exam_future)
        return
    state.hits = 0
    state.stability = "fragile"
    state.gap_days = 1
    hours = 1 if exam_within_24h else 4
    _schedule(state, submitted_at + timedelta(hours=hours), submitted_at, cutoff, exam_future)
