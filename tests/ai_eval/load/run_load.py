"""Start the stub relay, run one headless Locust wave, write a summary.

    .venv/bin/python tests/ai_eval/load/run_load.py --name A --crash-rate 0 --users 40 --seconds 60
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "var" / "ai-eval" / "load"
LOCUST = REPO / "var" / "ai-eval" / "venv" / "bin" / "locust"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--crash-rate", type=float, default=0.0)
    ap.add_argument("--users", type=int, default=40)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--delay", type=float, default=0.15)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    info_path = OUT / f"{args.name}.info"
    info_path.unlink(missing_ok=True)
    server = subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("serve_fake_relay.py")), "--port-file", str(info_path), "--delay", str(args.delay), "--crash-rate", str(args.crash_rate)],
        stdout=subprocess.DEVNULL, stderr=open(OUT / f"{args.name}.server.log", "w"),
    )
    try:
        for _ in range(60):
            if info_path.exists() and info_path.stat().st_size:
                break
            time.sleep(0.5)
        info = json.loads(info_path.read_text())
        summary = OUT / f"{args.name}.summary.json"
        env = {**os.environ, "RELAY_ADMIN_TOKEN": info["admin_token"], "KAIROS_LOAD_SUMMARY": str(summary)}
        proc = subprocess.run(
            [str(LOCUST), "-f", str(Path(__file__).with_name("locustfile.py")), "--host", info["url"], "--headless",
             "-u", str(args.users), "-r", "10", "-t", f"{args.seconds}s", "--csv", str(OUT / args.name), "--only-summary"],
            env=env, capture_output=True, text=True, check=False,
        )
        (OUT / f"{args.name}.locust.log").write_text(proc.stdout + proc.stderr)
        data = json.loads(summary.read_text())
        data["locust_exit"] = proc.returncode
        data["config"] = vars(args)
        summary.write_text(json.dumps(data, indent=2))
        print(json.dumps({"wave": args.name, "exit": proc.returncode, "leaks": data["leaks"], "budget": data["budget"], "top": sorted(data["outcomes"].items(), key=lambda kv: -kv[1])[:8]}, indent=1))
        return proc.returncode
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
