"""Student-owned week plan state: local writes, undo, and nothing that reorders itself."""

from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

from canvas_mcp.core import week_plan as wp

REPO = Path(__file__).resolve().parents[2]


def run(root: Path, cmd: str, **params):
    return wp.handle(root, {"cmd": cmd, "params": params})


def test_hours_carry_forward_and_validate(tmp_path: Path) -> None:
    out = run(tmp_path, "hours", week="2026-10-12", hours=12)
    assert out["state"]["weeks"]["2026-10-12"]["hours"] == 12
    assert out["state"]["default_hours"] == 12
    with pytest.raises(wp.PlanError):
        run(tmp_path, "hours", week="2026-10-13", hours=5)  # not a Monday
    with pytest.raises(wp.PlanError):
        run(tmp_path, "hours", week="2026-10-12", hours=500)


def test_defer_and_undo(tmp_path: Path) -> None:
    out = run(tmp_path, "defer", item_id="item-a77", to="2026-10-16")
    assert out["state"]["deferrals"]["item-a77"]["to"] == "2026-10-16"
    out = run(tmp_path, "undefer", item_id="item-a77")
    assert "item-a77" not in out["state"]["deferrals"]
    with pytest.raises(wp.PlanError):
        run(tmp_path, "defer", item_id="../etc/passwd", to="2026-10-16")


def test_accepted_plan_is_stamped_and_replaces_deferrals(tmp_path: Path) -> None:
    run(tmp_path, "defer", item_id="item-a1", to="2026-10-15")
    out = run(tmp_path, "accept", week="2026-10-12", days={"item-a1": "2026-10-14", "item-a2": "2026-10-16"})
    accepted = out["state"]["weeks"]["2026-10-12"]["accepted"]
    assert accepted["days"] == {"item-a1": "2026-10-14", "item-a2": "2026-10-16"}
    assert accepted["at"].endswith("Z")
    assert out["state"]["deferrals"] == {}
    # Showing the plan again never changes it.
    again = run(tmp_path, "show")
    assert again["state"]["weeks"]["2026-10-12"]["accepted"] == accepted
    out = run(tmp_path, "unaccept", week="2026-10-12")
    assert "accepted" not in out["state"]["weeks"]["2026-10-12"]


def test_estimates_are_corrected_or_cleared(tmp_path: Path) -> None:
    assert run(tmp_path, "estimate", item_id="item-a1", minutes=90)["state"]["estimates"]["item-a1"] == 90
    assert "item-a1" not in run(tmp_path, "estimate", item_id="item-a1", minutes=None)["state"]["estimates"]
    with pytest.raises(wp.PlanError):
        run(tmp_path, "estimate", item_id="item-a1", minutes=2)


def test_capture_done_and_remove_with_undo(tmp_path: Path) -> None:
    out = run(tmp_path, "capture", title="  Read chapter 5  ", day="2026-10-16", course="CHEM 1113", source="typed")
    row = out["saved"]
    assert row["title"] == "Read chapter 5"
    assert row["id"].startswith("cap-")
    assert [r["title"] for r in out["items"]] == ["Read chapter 5"]
    done = run(tmp_path, "done", item_id=row["id"])
    assert done["items"][0]["done_at"]
    undone = run(tmp_path, "done", item_id=row["id"], undo=True)
    assert undone["items"][0]["done_at"] is None
    assert run(tmp_path, "remove", item_id=row["id"])["items"] == []
    assert run(tmp_path, "remove", item_id=row["id"], undo=True)["items"][0]["id"] == row["id"]
    with pytest.raises(wp.PlanError):
        run(tmp_path, "done", item_id="item-a77")  # Canvas rows are not ours to mark


def test_pile_moves_and_always_per_course(tmp_path: Path) -> None:
    out = run(tmp_path, "pile", key="ann:1", pile="fyi")
    assert out["state"]["pile_moves"]["ann:1"] == "fyi"
    out = run(tmp_path, "pile", key="ann:2", pile="needs_you", always=True, course="CSCI 1300", kind="announcement")
    assert out["piles"]["courses"]["CSCI 1300"]["announcement"] == "needs_you"
    with pytest.raises(wp.PlanError):
        run(tmp_path, "pile", key="x", pile="trash")


def test_corrupt_files_read_as_empty(tmp_path: Path) -> None:
    wp.plan_dir(tmp_path).mkdir(parents=True)
    wp.week_path(tmp_path).write_text("{not json", encoding="utf-8")
    wp.items_path(tmp_path).write_text('{"id": "cap-1", "title": "ok"}\nnot json\n', encoding="utf-8")
    out = run(tmp_path, "show")
    assert out["state"]["deferrals"] == {}
    assert [r["id"] for r in out["items"]] == ["cap-1"]


def test_cli_reports_errors_as_json(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"cmd": "defer", "params": {"item_id": "x", "to": "soon"}})))
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    assert wp.main(["--user-root", str(tmp_path), "--json", "run"]) == 0
    assert json.loads(buf.getvalue()) == {"ok": False, "error": "to must look like 2026-10-14"}


_REAL_REBUILD = wp._rebuild_work_state


@pytest.fixture(autouse=True)
def _no_work_state_spawn(monkeypatch) -> None:
    """Plan mutations kick off a Node rebuild. Unit tests stay runtime-free."""
    monkeypatch.setattr(wp, "_rebuild_work_state", lambda user_root: None)


def test_work_state_rebuild_uses_packaged_runtime_paths(tmp_path: Path, monkeypatch) -> None:
    scripts = tmp_path / "runtime" / "browser" / "scripts"
    scripts.mkdir(parents=True)
    script = scripts / "rebuild-work-state.mjs"
    script.write_text("// fixture", encoding="utf-8")
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_popen(args: list[str], **kwargs: object) -> None:
        calls.append((args, kwargs))

    monkeypatch.setenv("KAIROS_BROWSER_SCRIPTS", str(scripts))
    monkeypatch.setenv("KAIROS_NODE", "/runtime/node")
    monkeypatch.setattr(wp.subprocess, "Popen", fake_popen)
    _REAL_REBUILD(tmp_path)
    assert calls == [
        (
            ["/runtime/node", str(script), "--user-root", str(tmp_path)],
            {"stdin": wp.subprocess.DEVNULL, "stdout": wp.subprocess.DEVNULL},
        )
    ]


def test_a_plan_mutation_does_not_wait_for_the_projection(tmp_path: Path, monkeypatch) -> None:
    """The reply must not be withheld for a derived rebuild."""
    started: list[Path] = []
    monkeypatch.setattr(wp, "_rebuild_work_state", started.append)
    reply = wp.handle(tmp_path, {"cmd": "estimate", "params": {"item_id": "item-a1", "minutes": 30}})
    assert reply["ok"] is True
    assert started == [tmp_path]


def test_runs_stdlib_only_from_the_core_dir(tmp_path: Path) -> None:
    """The packaged app runs `-m week_plan` with cwd canvas_mcp/core and no PYTHONPATH."""
    proc = subprocess.run(
        [sys.executable, "-s", "-m", "week_plan", "--user-root", str(tmp_path), "--json", "run"],
        input=json.dumps({"cmd": "show"}),
        capture_output=True,
        text=True,
        cwd=REPO / "src" / "canvas_mcp" / "core",
        env={"PATH": "/usr/bin:/bin"},
        check=True,
    )
    assert json.loads(proc.stdout)["ok"] is True
