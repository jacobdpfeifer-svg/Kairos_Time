"""Serve the real relay on loopback with a stub provider, for Locust.

    python tests/ai_eval/load/serve_fake_relay.py --port 8799 --delay 0.2 --crash-rate 0.0

Prints one JSON line {"url", "admin_token", "db"} then serves until killed.
``--crash-rate`` makes that fraction of dispatches raise (F11 under load).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services" / "relay"))

from relay.providers import ProviderResult  # noqa: E402
from relay_harness import GOOD, ScriptedProvider, running_relay  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port-file", default="")
    ap.add_argument("--delay", type=float, default=0.2)
    ap.add_argument("--crash-rate", type=float, default=0.0)
    ap.add_argument("--envelope-cents", type=int, default=5000)
    args = ap.parse_args()

    rng = random.Random(1012)
    lock = threading.Lock()

    def behavior(_content: str) -> ProviderResult:
        with lock:
            crash = rng.random() < args.crash_rate
        if crash:
            raise RuntimeError("stub provider crash")
        return ProviderResult(status="complete", text=GOOD, usage={"input": 900, "output": 300, "reasoning": 0}, finish_reason="end_turn", http_status=200)

    tmp = Path(tempfile.mkdtemp(prefix="kairos-relay-load-"))
    with running_relay(tmp, ScriptedProvider(behavior=behavior, delay=args.delay), envelope_cents=args.envelope_cents) as relay:
        info = {"url": relay.url, "admin_token": relay.admin, "db": str(tmp / "relay.sqlite3")}
        print(json.dumps(info), flush=True)
        if args.port_file:
            Path(args.port_file).write_text(json.dumps(info))
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
