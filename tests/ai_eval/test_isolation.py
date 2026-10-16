"""Two students, one process: nothing of one may surface in the other."""

from __future__ import annotations

import json
import threading

from kairos_adapter import CANARIES, assemble_skill_turn, snapshot, study

from canvas_mcp.core.user_profile import OnboardingIdentity, apply_onboarding_identity


def _school(root, name: str, host: str) -> None:
    (root / "school").mkdir(parents=True, exist_ok=True)
    (root / "school" / "profile.json").write_text(json.dumps({"slug": "discovered", "display_name": name, "canvas_host": host}), encoding="utf-8")


def test_onboarding_school_name_comes_from_the_written_root(avery, blake, monkeypatch) -> None:
    _school(avery, "Avery State University", "canvas.avery.example.invalid")
    _school(blake, "Blake Community College", "canvas.blake.example.invalid")
    monkeypatch.setenv("DEV_USER_ROOT", str(avery))  # the boot-time profile
    apply_onboarding_identity(blake, OnboardingIdentity(name="Blake", school_slug="discovered"))
    text = (blake / "USER.md").read_text(encoding="utf-8")
    assert "Avery State University" not in text
    assert "Blake Community College" in text


def test_concurrent_students_do_not_cross(avery, blake) -> None:
    """20 interleaved study + prompt turns per student on threads."""
    errors: list[str] = []
    before_blake = snapshot(blake)

    def run(root, mine: str, other: str) -> None:
        for i in range(20):
            out = study(root, "ask-create", {"content": f"{mine} question {i}: derivative of x^2", "content_kind": "text", "session_goal": "answer_now"})
            blob = json.dumps(out)
            if other in blob:
                errors.append(f"{mine} saw {other} in ask")
            _skill, turn = assemble_skill_turn(root, "canvas-week-plan", "plan my week")
            if other in turn.rendered():
                errors.append(f"{mine} saw {other} in prompt")

    a = threading.Thread(target=run, args=(avery, CANARIES["avery-chen"], CANARIES["blake-okonkwo"]))
    b = threading.Thread(target=run, args=(blake, CANARIES["blake-okonkwo"], CANARIES["avery-chen"]))
    a.start(), b.start()
    a.join(), b.join()
    assert errors == []
    asks_a = list((avery / "study" / "asks").glob("*.json"))
    asks_b = list((blake / "study" / "asks").glob("*.json"))
    assert len(asks_a) == 20 and len(asks_b) == 20
    for path in asks_b:
        assert CANARIES["avery-chen"] not in path.read_text()
    changed = set(snapshot(blake)) - set(before_blake)
    # F17 (low): prompt assembly seeds calibration/learning-profile.yaml — a write on a read path.
    assert all(p.startswith("study/") or p == "calibration/learning-profile.yaml" for p in changed), changed


def test_empty_student_stays_empty(blake) -> None:
    _skill, turn = assemble_skill_turn(blake, "canvas-week-plan", "plan my week")
    user = turn.messages[-1].content
    assert "APPM" not in user and "ASEN" not in user
