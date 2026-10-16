"""W0 foundation tests: tenants, user_root, ledger, permissions."""

from __future__ import annotations

import pytest

from canvas_mcp.core.ledger import (
    Ledger,
    LedgerSchemaError,
    UndoPtr,
    append_ledger,
    validate_entry,
)
from canvas_mcp.core.permissions import (
    CATEGORIES,
    NEVER_AUTO,
    allow_write,
    bump_k_success,
    default_permissions,
    load_permissions,
    refuse_proctoring_tool,
    resolve_posture,
    save_permissions,
)
from canvas_mcp.core.tenants import clear_school_cache, list_schools, load_school
from canvas_mcp.core.user_root import ensure_user_root, resolve_user_root, user_path


def test_load_cu_boulder_school():
    clear_school_cache()
    school = load_school("cu-boulder")
    assert school.slug == "cu-boulder"
    assert "colorado.edu" in school.canvas_base_url
    assert school.timezone == "America/Denver"
    assert list(school.course_file_map) == []
    assert "local-first" in school.legal_notice.lower()
    assert school.grade_scale["A-"] == 3.7
    assert school.grade_scale["B+"] == 3.3
    assert "degree_audit" in school.policy_links
    assert "colorado.edu" in school.policy_links["degree_audit"]
    assert "cu-boulder" in list_schools()


def test_template_slug_not_loadable():
    with pytest.raises(ValueError):
        load_school("_template")


def test_user_root_dev_override(tmp_path, monkeypatch):
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path / "dev-user"))
    root = resolve_user_root("ignored", create=True)
    assert root == (tmp_path / "dev-user").resolve()
    assert (root / "ledger.jsonl").is_file()
    assert (root / "calibration").is_dir()


@pytest.mark.parametrize("parts", [("inbox", "..", "..", "outside.txt"), ("/tmp", "outside.txt")])
def test_user_path_cannot_escape_root(tmp_path, monkeypatch, parts):
    monkeypatch.setenv("DEV_USER_ROOT", str(tmp_path))
    with pytest.raises(ValueError, match="inside the user root"):
        user_path("ignored", *parts)


def test_permissions_ignore_corrupt_counter_values(tmp_path):
    ensure_user_root(tmp_path)
    path = tmp_path / "calibration" / "permissions.yaml"
    path.write_text(
        "categories:\n"
        "  canvas_submit:\n"
        "    k_required: not-a-number\n"
        "    k_success: -20\n"
        "skill_counters:\n"
        "  promotion: broken\n",
        encoding="utf-8",
    )
    state = load_permissions(tmp_path)
    assert state.categories["canvas_submit"].k_required == 3
    assert state.categories["canvas_submit"].k_success == 0
    assert state.skill_counters["promotion"] == 0


def test_ledger_pinned_schema(tmp_path):
    ensure_user_root(tmp_path)
    row = append_ledger(
        tmp_path,
        actor="daemon",
        tool="gcal.create_event",
        target="calendar/primary",
        why="Moved study block after flight change",
        outcome="success",
        category="calendar",
        skill=None,
        preview_hash=None,
        undo_ptr=UndoPtr(kind="gcal_event", id="evt_1", prior=None),
    )
    validate_entry(row)
    rows = Ledger(tmp_path).read_all()
    assert len(rows) == 1
    assert rows[0]["undo_ptr"]["kind"] == "gcal_event"
    assert set(rows[0].keys()) >= {
        "ts",
        "actor",
        "skill",
        "tool",
        "target",
        "preview_hash",
        "why",
        "outcome",
        "undo_ptr",
        "category",
    }


def test_ledger_rejects_bad_outcome(tmp_path):
    with pytest.raises(LedgerSchemaError):
        validate_entry(
            {
                "ts": "x",
                "actor": "a",
                "skill": None,
                "tool": "t",
                "target": "t",
                "preview_hash": None,
                "why": "w",
                "outcome": "nope",
                "undo_ptr": None,
                "category": "calendar",
            }
        )


def test_permissions_defaults_and_never_auto(tmp_path):
    ensure_user_root(tmp_path)
    state = load_permissions(tmp_path)
    # calendar (event writes) is gated by design (2026-09-13 addendum to
    # docs/handoff/canvas-focus-pivot-2026-09-11.md) — every write requires a
    # per-instance human confirm, no automatic posture.
    assert state.categories["calendar"].posture == "gated"
    assert state.categories["canvas_submit"].posture == "gated"
    for cat in NEVER_AUTO:
        assert state.categories[cat].posture == "never"
        ok, _ = allow_write(state, cat, confirmed=True)
        assert not ok


def test_permissions_gated_requires_confirm(tmp_path):
    state = default_permissions()
    ok, reason = allow_write(state, "canvas_submit", confirmed=False)
    assert not ok
    ok, reason = allow_write(state, "canvas_submit", confirmed=True)
    assert ok


def test_bump_k_escalates(tmp_path):
    state = default_permissions()
    state.categories["skill_promotion"].k_required = 2
    state.categories["skill_promotion"].k_success = 0
    state = bump_k_success(state, "skill_promotion", course_id="c1")
    state = bump_k_success(state, "skill_promotion", course_id="c1")
    assert state.courses["c1"]["skill_promotion"].posture == "automatic"
    save_permissions(tmp_path, state)
    reloaded = load_permissions(tmp_path)
    assert reloaded.courses["c1"]["skill_promotion"].k_success == 2


def test_canvas_visible_writes_never_load_as_automatic(tmp_path):
    ensure_user_root(tmp_path)
    (tmp_path / "calibration" / "permissions.yaml").write_text(
        "categories:\n"
        "  canvas_submit: {posture: automatic}\n"
        "  canvas_discussion_post: {posture: automatic}\n"
        "courses:\n"
        "  c1:\n"
        "    canvas_quiz_submit: {posture: automatic}\n",
        encoding="utf-8",
    )
    state = load_permissions(tmp_path)
    for cat in ("canvas_submit", "canvas_discussion_post"):
        assert state.categories[cat].posture == "gated"
        assert allow_write(state, cat, confirmed=False)[0] is False
    assert resolve_posture(state, "canvas_quiz_submit", course_id="c1") == "gated"


def test_bump_k_cannot_escalate_always_gated():
    state = default_permissions()
    for cat in ("email_send", "calendar", "canvas_submit", "canvas_quiz_submit", "canvas_discussion_post"):
        state.categories[cat].k_required = 1
        state.categories[cat].k_success = 0
        state.categories[cat].posture = "gated"
        state = bump_k_success(state, cat, course_id="c1")
        assert state.courses["c1"][cat].posture == "gated"
        assert state.courses["c1"][cat].k_success == 1
        # Global path too
        state = bump_k_success(state, cat)
        assert state.categories[cat].posture == "gated"


def test_refuse_proctoring():
    assert refuse_proctoring_tool("honorlock_launch")
    assert refuse_proctoring_tool("open_lockdown_browser")
    assert not refuse_proctoring_tool("submit_assignment")


def test_all_categories_covered():
    state = default_permissions()
    assert set(state.categories) == set(CATEGORIES)
