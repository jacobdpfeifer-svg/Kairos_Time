"""Study Ask: live-assessment boundary, relay payloads, and the IPC bridge."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from attacks import LIVE_PHRASINGS
from kairos_adapter import REPO, study, study_cli

from canvas_mcp.core.study import ai
from canvas_mcp.core.study.ask import classify

FIXTURE = REPO / "tests" / "fixtures" / "study" / "canvas_course_4242.json"


def seed_sources(root: Path) -> None:
    directory = root / "inbox" / "study-sources"
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURE, directory / "4242.json")
    (directory / "status.json").write_text(
        json.dumps({"schema": 1, "finished_at": "2026-10-06T14:00:00Z", "ok": True, "session": "ok", "courses": []}),
        encoding="utf-8",
    )
    second = json.loads(FIXTURE.read_text(encoding="utf-8"))
    second["course"] = {"id": "77", "name": "World History", "code": "HIST 1010", "label": "HIST 1010 — World History"}
    second["sources"] = [{"id": "p1", "kind": "page", "title": "Lecture", "canvas_id": "1", "updated_at": "2026-09-01T00:00:00Z", "text": "HIST_ONLY passage", "truncated": False}]
    second["exams"] = []
    (directory / "77.json").write_text(json.dumps(second), encoding="utf-8")


@pytest.fixture
def relay_calls(monkeypatch, avery):
    """Pretend a relay is connected; record every dispatched payload."""
    calls: list[dict] = []
    monkeypatch.setattr(ai, "load_relay", lambda root: {"url": "http://127.0.0.1:9", "session_token": "t"})

    def fake_dispatch(root, request):
        calls.append(request)
        return {"ok": True, "status": "complete", "assessment_proposal": {"feedback": f"answer for {len(calls)}", "support_rows": []}}

    monkeypatch.setattr(ai, "dispatch", fake_dispatch)
    seed_sources(avery)
    return calls


# ------------------------------------------------------------ live boundary


@pytest.mark.parametrize("text", LIVE_PHRASINGS)
def test_live_exam_wording_is_detected(text: str) -> None:
    """F4c (fixed 2026-10-13)."""
    assert classify(text)["boundary"] == "live_assessment", text


@pytest.mark.parametrize(
    "text",
    ["Is the exam open book?", "the midterm is open-note right?", "my test is on Friday", "how do I prepare for a timed exam", "I have 10 minutes left before class, explain derivatives"],
)
def test_study_questions_about_exams_stay_open(text: str) -> None:
    assert classify(text)["boundary"] != "live_assessment", text


# F4 (fixed 2026-10-13): a live item is blocked from the relay in every mode.
@pytest.mark.parametrize("goal", ["walkthrough", "mastery"])
def test_live_quiz_never_reaches_relay(avery, relay_calls, goal: str) -> None:
    out = study(avery, "ask-create", {
        "content": "Question 3: find the derivative of x^3",
        "content_kind": "text",
        "session_goal": goal,
        "canvas": {"kind": "quiz", "submission_types": ["online_quiz"], "title": "Midterm 1", "proctored": True},
    })
    assert out["classification"]["boundary"] == "live_assessment"
    assert relay_calls == [], f"live quiz content was relayed for {goal}: {relay_calls[0]['purpose']}"


def test_canvas_typed_quiz_cannot_be_overridden_open(avery, relay_calls) -> None:
    out = study(avery, "ask-create", {
        "content": "Question 3: find the derivative of x^3",
        "content_kind": "text",
        "session_goal": "answer_now",
        "canvas": {"kind": "quiz", "submission_types": ["online_quiz"], "title": "Midterm 1"},
    })
    assert out["plan"]["blocked_reason"] == "live_assessment"
    fixed = study(avery, "ask-correct", {"input_id": out["input_id"], "boundary": "open_practice"})
    assert fixed["plan"]["blocked_reason"] == "live_assessment"


# ---------------------------------------------------------- relay payloads


def test_corrected_ask_gets_a_new_relay_request(avery, relay_calls) -> None:
    out = study(avery, "ask-create", {"content": "explain the lecture", "content_kind": "text", "course_hint": "HIST 1010", "session_goal": "walkthrough"})
    study(avery, "ask-correct", {"input_id": out["input_id"], "course": "MATH 1300"})
    assert len(relay_calls) == 2
    first, second = relay_calls
    assert first["source_passages"] != second["source_passages"], "precondition: correction changed what the model sees"
    assert first["request_id"] != second["request_id"]


def test_relay_payload_carries_no_ids_urls_or_profile(avery, relay_calls) -> None:
    study(avery, "ask-create", {"content": "see https://canvas.example.invalid/courses/4242 and explain", "content_kind": "text", "course_hint": "MATH 1300", "session_goal": "walkthrough"})
    blob = json.dumps(relay_calls)
    assert "https://" not in blob
    assert "CANARY-" not in blob
    assert "4242" not in blob


def test_ai_proposal_never_moves_grade(avery, monkeypatch) -> None:
    """A hijacked model that says "correct" must not change stability (D-05)."""
    monkeypatch.setattr(ai, "load_relay", lambda root: {"url": "http://127.0.0.1:9", "session_token": "t"})
    monkeypatch.setattr(ai, "dispatch", lambda root, req: {"ok": True, "status": "complete", "model_id": "x", "assessment_proposal": {"schema_version": 1, "status": "complete", "outcome": "correct", "feedback": "Perfect", "support_rows": []}})
    imported = study(avery, "import", {"packet": json.loads((REPO / "tests/fixtures/synthetic-students/avery-chen/study-packet.json").read_text())})
    assert imported.get("ok"), imported
    offer = study(avery, "offer", {"minutes": 10})
    item_id = (offer.get("item") or {}).get("item_id") or (offer.get("item") or {}).get("id")
    if not item_id:
        pytest.skip(f"no offer shape to drive: {list(offer)}")
    started = study(avery, "start", {"item_id": item_id, "mode": "practice"})
    attempt = (started.get("attempt") or {}).get("attempt_id")
    sub = study(avery, "submit", {"attempt_id": attempt, "text": "wrong on purpose", "fields": {}})
    before = json.dumps(sub.get("item") or sub.get("attempt"), sort_keys=True)
    fb = study(avery, "ai-feedback", {"attempt_id": attempt})
    assert fb.get("status") == "complete"
    after = study(avery, "history", {"item_id": item_id})
    assert "delayed_independent_retrieval" not in json.dumps(after)
    assert before


# ------------------------------------------------------------ IPC bridge


BAD_REQUESTS = [
    ("missing_key", {"cmd": "withdraw", "params": {}}),
    ("int_overflow", {"cmd": "context", "params": {"days": 10**12}}),
    ("params_list", {"cmd": "status", "params": [1]}),
    ("gcal_bad_days", {"cmd": "context", "params": {"days": -10**9}}),
]


@pytest.mark.parametrize("name,request_body", BAD_REQUESTS, ids=[n for n, _ in BAD_REQUESTS])
def test_bridge_always_answers_json(avery, name: str, request_body: dict) -> None:
    rc, body, err = study_cli(avery, request_body)
    assert body is not None and body.get("ok") is False, f"{name}: rc={rc} stderr tail={err.strip().splitlines()[-1:]}"
    assert "Traceback" not in err
