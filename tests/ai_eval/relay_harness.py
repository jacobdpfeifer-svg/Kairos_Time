"""Run the real relay HTTP surface on loopback with a scripted provider.

Shared by the pytest attacks and the Locust load file. No vendor key, no
spend: the provider is a stub whose behavior each test chooses.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import kairos_adapter  # noqa: F401  (puts services/relay on sys.path)
from relay.app import make_handler
from relay.config import PRICING_VERSION, Config, inference_allowance_cents
from relay.providers import ProviderResult
from relay.service import RelayService
from relay.store import Store

GOOD = json.dumps({"schema_version": 1, "status": "complete", "outcome": "partial", "feedback": "Check step 2.", "support_rows": []})


@dataclass
class ScriptedProvider:
    behavior: Callable[[str], ProviderResult] | None = None
    delay: float = 0.0
    calls: int = 0

    def dispatch(self, *, model: str, user_content: str, max_output_tokens: int) -> ProviderResult:
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        if self.behavior:
            return self.behavior(user_content)
        return ProviderResult(status="complete", text=GOOD, usage={"input": 500, "output": 200, "reasoning": 0}, finish_reason="end_turn", http_status=200)


@dataclass
class Relay:
    url: str
    admin: str
    service: RelayService
    provider: ScriptedProvider
    server: ThreadingHTTPServer

    def call(self, method: str, path: str, body: Any = None, token: str | None = None, timeout: float = 10) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method)
        if data is not None:
            req.add_header("content-type", "application/json")
        if token:
            req.add_header("authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    def tester(self, allowance_cents: int | None = None) -> str:
        _, inv = self.call("POST", "/admin/invites", {"label": "eval", "allowance_cents": allowance_cents}, token=self.admin)
        _, red = self.call("POST", "/v1/invite/redeem", {"code": inv["invite_code"]})
        return red["session_token"]


def study_body(request_id: str | None = None, session: str = "s1", **extra: Any) -> dict:
    return {
        "request_id": request_id or "r-" + secrets.token_hex(6),
        "session_budget_id": session,
        "purpose": "feedback",
        "source_passages": [{"locator": "p", "text": "Newton's second law: F = ma."}],
        "stem": "What is F if m=2 and a=3?",
        "rubric": "answer: 6",
        "submitted_answer": "6",
        "schema_version": 1,
        "pricing_version": PRICING_VERSION,
        **extra,
    }


@contextmanager
def running_relay(tmp: Path, provider: ScriptedProvider | None = None, **cfg: Any) -> Iterator[Relay]:
    admin = secrets.token_hex(16)
    config = Config(db_path=str(tmp / "relay.sqlite3"), admin_token=admin, anthropic_key="", host="127.0.0.1", port=0, **cfg)
    store = Store(config.db_path, global_allowance_cents=inference_allowance_cents(config))
    provider = provider or ScriptedProvider()
    service = RelayService(config, store, providers={"anthropic": provider})
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service, config))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield Relay(f"http://127.0.0.1:{server.server_address[1]}", admin, service, provider, server)
    finally:
        server.shutdown()
        server.server_close()
