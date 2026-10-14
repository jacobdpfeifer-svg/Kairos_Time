"""Run one beta-readiness wave and record it locally (JSON + Markdown + SQLite).

    .venv/bin/python tests/ai_eval/run_wave.py                 # deterministic layers
    .venv/bin/python tests/ai_eval/run_wave.py --baseline      # + existing pytest/browser/vitest
    .venv/bin/python tests/ai_eval/run_wave.py --load          # + Locust relay waves
    ANTHROPIC_API_KEY=... .venv/bin/python tests/ai_eval/run_wave.py --model   # + Sonnet 4.6 layers

Output: var/ai-eval/waves/<UTC stamp>/{summary.json,summary.md,results.sqlite}
and a row per test outcome in var/ai-eval/history.sqlite across waves.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PY = REPO / ".venv" / "bin" / "python"
EVAL_PY = REPO / "var" / "ai-eval" / "venv" / "bin" / "python"
PROMPTFOO = ["npx", "--prefix", str(Path.home() / ".cache" / "kairos-promptfoo"), "promptfoo"]


def sh(cmd: list[str], cwd: Path = REPO, env: dict | None = None, timeout: int = 1800) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True, text=True, timeout=timeout, check=False)
    return proc.returncode, proc.stdout + proc.stderr


def junit(path: Path, layer: str) -> list[dict]:
    rows = []
    for case in ET.parse(path).getroot().iter("testcase"):
        outcome, detail = "passed", ""
        for child in case:
            if child.tag in ("failure", "error"):
                outcome, detail = "failed", (child.get("message") or "")[:500]
            elif child.tag == "skipped":
                msg = child.get("message") or ""
                outcome = "xfail" if child.get("type") == "pytest.xfail" or "xfail" in msg.lower() or msg.startswith("F") else "skipped"
                detail = msg[:500]
        rows.append({"layer": layer, "test": f"{case.get('classname')}::{case.get('name')}", "outcome": outcome, "detail": detail, "seconds": float(case.get("time") or 0)})
    return rows


def pytest_layer(out: Path, layer: str, target: list[str], python: Path = PY, env: dict | None = None) -> list[dict]:
    xml = out / f"{layer}.xml"
    rc, log = sh([str(python), "-m", "pytest", *target, "-q", "-p", "no:cacheprovider", f"--junitxml={xml}", "-o", "junit_family=xunit2"], env=env)
    (out / f"{layer}.log").write_text(log)
    return junit(xml, layer) if xml.exists() else [{"layer": layer, "test": "collection", "outcome": "failed", "detail": log[-500:], "seconds": 0}]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--load", action="store_true")
    ap.add_argument("--model", action="store_true")
    args = ap.parse_args()

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out = REPO / "var" / "ai-eval" / "waves" / stamp
    out.mkdir(parents=True, exist_ok=True)
    commit = sh(["git", "rev-parse", "--short", "HEAD"])[1].strip()
    dirty = bool(sh(["git", "status", "--porcelain"])[1].strip())
    rows: list[dict] = []
    extra: dict = {}

    if args.baseline:
        rows += pytest_layer(out, "baseline_pytest", ["tests", "services/relay/tests", "--ignore=tests/ai_eval"])
        for name, cmd, cwd in (("baseline_browser", ["npm", "test"], REPO / "browser"), ("baseline_vitest", ["npx", "vitest", "run"], REPO / "app")):
            rc, log = sh(cmd, cwd=cwd)
            (out / f"{name}.log").write_text(log)
            rows.append({"layer": name, "test": name, "outcome": "passed" if rc == 0 else "failed", "detail": log[-300:], "seconds": 0})

    rows += pytest_layer(out, "deterministic", ["tests/ai_eval", "--ignore=tests/ai_eval/deepeval", "--ignore=tests/ai_eval/test_model_redteam.py"])

    if args.load:
        for name, rate in (("A", "0"), ("B", "0.02")):
            rc, log = sh([str(PY), "tests/ai_eval/load/run_load.py", "--name", name, "--crash-rate", rate, "--users", "40", "--seconds", "60"], timeout=600)
            summary = json.loads((REPO / "var/ai-eval/load" / f"{name}.summary.json").read_text())
            extra[f"load_{name}"] = summary
            ok = sum(v for k, v in summary["outcomes"].items() if k.endswith(":200:ok"))
            busy = sum(v for k, v in summary["outcomes"].items() if ":429:busy" in k)
            served = ok / max(1, ok + busy)
            outcome = "failed" if rc != 0 or summary["leaks"] else ("xfail" if served < 0.8 else "passed")
            rows.append({"layer": "load", "test": f"wave_{name}_crash_{rate}", "outcome": outcome,
                         # F18: busy refusals with no queue; F11: crashed dispatches pin global slots.
                         "detail": ("F18/F11 availability: " if outcome == "xfail" else "") + f"ok={ok} busy={busy} leaks={len(summary['leaks'])} settled+outstanding={summary['budget']['settled'] + summary['budget']['outstanding']}¢", "seconds": 60})

    if args.model:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("--model needs ANTHROPIC_API_KEY", file=sys.stderr)
            return 2
        rows += pytest_layer(out, "model_redteam", ["tests/ai_eval/test_model_redteam.py"])
        rows += pytest_layer(out, "deepeval", ["tests/ai_eval/deepeval"], python=EVAL_PY)
        rc, log = sh([*PROMPTFOO, "eval", "-c", "promptfooconfig.yaml", "--no-share", "-o", str(out / "promptfoo.json")], cwd=REPO / "tests/ai_eval/promptfoo", env={"PROMPTFOO_DISABLE_TELEMETRY": "1"})
        (out / "promptfoo.log").write_text(log)
        rows.append({"layer": "promptfoo", "test": "promptfooconfig.yaml", "outcome": "passed" if rc == 0 else "failed", "detail": log[-300:], "seconds": 0})

    counts: dict[str, dict[str, int]] = {}
    for r in rows:
        counts.setdefault(r["layer"], {}).setdefault(r["outcome"], 0)
        counts[r["layer"]][r["outcome"]] += 1
    summary = {"stamp": stamp, "commit": commit, "dirty_tree": dirty, "counts": counts, "rows": rows, **extra}
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    lines = [f"# AI-eval wave {stamp}", "", f"Commit `{commit}`{' (dirty tree)' if dirty else ''}.", "", "| Layer | Passed | Pinned weakness (xfail) | Failed | Skipped |", "|---|---|---|---|---|"]
    for layer, c in counts.items():
        lines.append(f"| {layer} | {c.get('passed', 0)} | {c.get('xfail', 0)} | {c.get('failed', 0)} | {c.get('skipped', 0)} |")
    lines += ["", "## Pinned weaknesses", ""] + [f"- `{r['test'].split('::')[-1]}` — {r['detail']}" for r in rows if r["outcome"] == "xfail"]
    lines += ["", "## Failures", ""] + ([f"- `{r['test']}` — {r['detail'][:200]}" for r in rows if r["outcome"] == "failed"] or ["- none"])
    (out / "summary.md").write_text("\n".join(lines) + "\n")

    for db in (out / "results.sqlite", REPO / "var" / "ai-eval" / "history.sqlite"):
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE IF NOT EXISTS results(stamp TEXT, commit_sha TEXT, layer TEXT, test TEXT, outcome TEXT, detail TEXT, seconds REAL)")
        con.executemany("INSERT INTO results VALUES(?,?,?,?,?,?,?)", [(stamp, commit, r["layer"], r["test"], r["outcome"], r["detail"], r["seconds"]) for r in rows])
        con.commit()
        con.close()
    print(out / "summary.md")
    print(json.dumps(counts, indent=1))
    return 1 if any(r["outcome"] == "failed" for r in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
