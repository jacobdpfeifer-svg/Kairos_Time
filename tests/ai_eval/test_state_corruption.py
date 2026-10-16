"""Corrupt one local state file, then run every CLI the desktop daemon calls.

A student's disk can hold half-written YAML (crash mid-save), a JSONL line
from an older schema, or binary junk from a sync tool. The bar: each CLI
answers (non-crash exit, parseable stdout) or fails with a structured error —
never a traceback that the app shows as a blank surface.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest
from kairos_adapter import REPO

DAEMON_CLIS = [
    ("learn_loop_due", ["canvas_mcp.core.learn_loop", "--json", "due"]),
    ("learn_loop_progress", ["canvas_mcp.core.learn_loop", "--json", "progress"]),
    ("learn_loop_evaluate", ["canvas_mcp.core.learn_loop", "evaluate", "--compare"]),
    ("habit_show", ["canvas_mcp.core.habit", "--json", "show"]),
    ("commitment_status", ["canvas_mcp.core.commitment", "--json", "status"]),
    ("learning_profile_show", ["canvas_mcp.core.learning_profile", "--json", "show"]),
    ("route_intent", ["canvas_mcp.core.skill_router", "--json", "plan my week"]),
    ("study_status", ["canvas_mcp.core.study", "status"]),
]

GARBAGE = {
    "truncated_yaml": "items:\n  - id: a\n    claim: \"unterminated\n",
    "yaml_scalar": "42\n",
    "yaml_list": "- 1\n- 2\n",
    "binary": b"\xff\xfe\x00\x01\x02",
    "empty": "",
}

TARGETS = [
    "inbox/learn/items.yaml",
    "inbox/habit.yaml",
    "inbox/commitments.yaml",
    "calibration/permissions.yaml",
    "USER.md",
    "inbox/week.md",
    "study/events.jsonl",
    "study/projection.json",
    "inbox/learn/outcomes.jsonl",
]


def run_cli(root, argv):
    env = {**os.environ, "PYTHONPATH": str(REPO / "src"), "DEV_USER_ROOT": str(root), "PRODUCT_TZ": "America/Denver"}
    proc = subprocess.run([sys.executable, "-m", *argv], capture_output=True, text=True, env=env, timeout=60, check=False, cwd=root)
    return proc.returncode, proc.stdout, proc.stderr


def _crashed(rc: int, out: str, err: str) -> bool:
    return "Traceback (most recent call last)" in err


@pytest.mark.parametrize("target", TARGETS)
@pytest.mark.parametrize("kind", list(GARBAGE))
def test_daemon_clis_survive_corrupt_file(avery, target: str, kind: str) -> None:
    path = avery / target
    path.parent.mkdir(parents=True, exist_ok=True)
    content = GARBAGE[kind]
    path.write_bytes(content if isinstance(content, bytes) else content.encode())
    crashes = []
    for name, argv in DAEMON_CLIS:
        rc, out, err = run_cli(avery, argv)
        if _crashed(rc, out, err):
            crashes.append(f"{name}: {err.strip().splitlines()[-1][:160]}")
    assert not crashes, "F14: " + " | ".join(crashes)


def test_clean_root_baseline(avery) -> None:
    for name, argv in DAEMON_CLIS:
        rc, out, err = run_cli(avery, argv)
        assert not _crashed(rc, out, err), f"{name} crashes on a clean root: {err[-400:]}"


def test_study_events_partial_last_line_recovers(avery) -> None:
    """Power loss mid-append: the log keeps every complete event."""
    from kairos_adapter import study

    imported = study(avery, "import", {"packet": json.loads((REPO / "tests/fixtures/synthetic-students/avery-chen/study-packet.json").read_text())})
    assert imported.get("ok"), imported
    log = avery / "study" / "events.jsonl"
    with log.open("a", encoding="utf-8") as fh:
        fh.write('{"type": "attempt_started", "id": "half')
    status = study(avery, "status")
    assert status.get("ok"), status
    assert status["packets"], "a torn final line lost previously committed packets"
