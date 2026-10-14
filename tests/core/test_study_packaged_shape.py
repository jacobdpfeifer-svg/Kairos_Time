"""The study core exactly as the desktop app spawns it (app/src-tauri/src/runtime.rs
``study_command``): top-level ``study`` package, cwd = ``src/canvas_mcp/core``,
``-s``, no PYTHONPATH, ``--user-root``, JSON request on stdin."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

CORE = Path(__file__).resolve().parents[2] / "src" / "canvas_mcp" / "core"


def _run(root: Path, cmd: str, params: dict | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in {"PYTHONPATH", "PYTHONHOME"}}
    env["PYTHONNOUSERSITE"] = "1"
    proc = subprocess.run(
        [sys.executable, "-s", "-m", "study", "--user-root", str(root), "--json", "run"],
        cwd=CORE,
        input=json.dumps({"cmd": cmd, "params": params or {}}),
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip().startswith("{")]
    assert lines, f"no reply (exit {proc.returncode}): {proc.stderr[-800:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("cmd", ["connectors-status", "status", "templates", "canvas-sources", "library-list", "library-ingest"])
def test_packaged_shape_answers_settings_and_study_commands(tmp_path: Path, cmd: str) -> None:
    reply = _run(tmp_path, cmd)
    assert reply.get("ok") is True, reply


def test_packaged_shape_connector_status_never_reports_connected_without_tokens(tmp_path: Path) -> None:
    reply = _run(tmp_path, "connectors-status")
    states = {name: row["state"] for name, row in reply["connectors"].items()}
    assert set(states) == {"gcal", "outlook"}
    assert "connected" not in states.values()
