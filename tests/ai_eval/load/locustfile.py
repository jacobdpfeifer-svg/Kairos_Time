"""Many beta testers on one relay: budget, isolation and lock-out under load.

    RELAY_ADMIN_TOKEN=... locust -f tests/ai_eval/load/locustfile.py --host http://127.0.0.1:PORT \
        --headless -u 40 -r 10 -t 60s --csv var/ai-eval/load/run

Only ever point this at ``serve_fake_relay.py`` (stub provider). Never at a
hosted relay with a real vendor key, and never at Canvas.
"""

from __future__ import annotations

import json
import os
import secrets
from collections import Counter

from locust import HttpUser, between, events, task

PRICING_VERSION = "2026-09-18"
OUTCOMES: Counter[str] = Counter()
LEAKS: list[str] = []


def body(rid: str, session: str) -> dict:
    return {
        "request_id": rid,
        "session_budget_id": session,
        "purpose": "feedback",
        "source_passages": [{"locator": "p", "text": "F = ma. " * 40}],
        "stem": "What is F if m=2 and a=3?",
        "rubric": "6",
        "submitted_answer": "6",
        "schema_version": 1,
        "pricing_version": PRICING_VERSION,
    }


class Tester(HttpUser):
    wait_time = between(0.2, 1.5)

    def on_start(self) -> None:
        if not self.host.startswith("http://127.0.0.1"):
            raise RuntimeError("locustfile refuses non-loopback hosts")
        admin = {"Authorization": f"Bearer {os.environ['RELAY_ADMIN_TOKEN']}"}
        inv = self.client.post("/admin/invites", json={"label": "load", "allowance_cents": 60}, headers=admin, name="admin_invite").json()
        red = self.client.post("/v1/invite/redeem", json={"code": inv["invite_code"]}, name="redeem").json()
        self.auth = {"Authorization": f"Bearer {red['session_token']}"}
        self.tester_id = red["tester_id"]
        self.session = "s-" + secrets.token_hex(4)
        self.sent = 0
        self.last_id = None

    def _study(self, rid: str, name: str) -> None:
        with self.client.post("/v1/study", json=body(rid, self.session), headers=self.auth, name=name, catch_response=True) as r:
            code = (r.json().get("error") or {}).get("code") if r.status_code != 200 else "ok"
            OUTCOMES[f"{name}:{r.status_code}:{code}"] += 1
            if r.status_code in (200, 409, 429, 402, 500):
                r.success()  # expected protocol outcomes; invariants are checked at the end
        self.sent += 1
        if self.sent % 6 == 0:
            self.session = "s-" + secrets.token_hex(4)

    @task(6)
    def ask(self) -> None:
        self.last_id = f"{self.tester_id}-{secrets.token_hex(4)}"
        self._study(self.last_id, "study")

    @task(2)
    def replay(self) -> None:
        if self.last_id:
            self._study(self.last_id, "study_replay")

    @task(1)
    def steal(self) -> None:
        """Probe another tester's request ids; any 200 with a proposal is a leak."""
        rid = "shared-" + secrets.token_hex(1)  # small space → collisions across testers
        with self.client.post("/v1/study", json=body(rid, self.session), headers=self.auth, name="study_collide", catch_response=True) as r:
            data = r.json()
            if r.status_code == 200 and data.get("replayed") and data.get("assessment_proposal"):
                owner = self.client.get(f"/v1/status/{rid}", headers=self.auth, name="status").status_code
                if owner == 404:
                    LEAKS.append(rid)
            r.success()

    @task(1)
    def usage(self) -> None:
        self.client.get("/v1/usage", headers=self.auth, name="usage")


@events.quitting.add_listener
def _report(environment, **_kw) -> None:
    admin = {"Authorization": f"Bearer {os.environ['RELAY_ADMIN_TOKEN']}"}
    import urllib.request

    req = urllib.request.Request(environment.host + "/admin/budget", headers=admin)
    budget = json.loads(urllib.request.urlopen(req, timeout=10).read())  # noqa: S310 - loopback only
    summary = {"outcomes": dict(OUTCOMES), "leaks": LEAKS, "budget": budget}
    out = os.environ.get("KAIROS_LOAD_SUMMARY")
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
    over = budget["settled"] + budget["outstanding"] > budget["inference_allowance_cents"]
    if LEAKS or over:
        environment.process_exit_code = 3
