"""Study core ↔ relay: provisional feedback, idempotent replay, payload minimization."""

from __future__ import annotations

import json
import sys
import threading
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from canvas_mcp.core.study.ai import _validate_relay_url
from canvas_mcp.core.study.model import StudyError
from canvas_mcp.core.study.service import StudyService

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "relay"))
from relay.app import make_handler  # noqa: E402
from relay.config import Config, inference_allowance_cents  # noqa: E402
from relay.providers import ProviderResult  # noqa: E402
from relay.service import RelayService  # noqa: E402
from relay.store import Store  # noqa: E402

Z = "America/Denver"
PACKETS = ROOT / "templates" / "study-packets"
GOOD = json.dumps({"schema_version": 1, "status": "complete", "outcome": "partial", "feedback": "Multiply by cos x.", "support_rows": [{"locator": "Q §chain", "quote": "The derivative of sin x is cos x", "status": "explicit_support"}]})


class Scripted:
    def __init__(self) -> None:
        self.script: list[ProviderResult] = []
        self.calls: list[str] = []

    def dispatch(self, *, model: str, user_content: str, max_output_tokens: int) -> ProviderResult:
        self.calls.append(user_content)
        if self.script:
            return self.script.pop(0)
        return ProviderResult(status="complete", text=GOOD, usage={"input": 900, "output": 120, "reasoning": 0}, finish_reason="end_turn")


@pytest.fixture
def relay(tmp_path: Path) -> Any:
    provider = Scripted()
    cfg = Config(db_path=str(tmp_path / "relay.sqlite3"), admin_token="admin", default_model="claude-haiku-4-5", envelope_cents=100, fixed_fees_cents=0, default_tester_allowance_cents=10)
    store = Store(cfg.db_path, global_allowance_cents=inference_allowance_cents(cfg))
    service = RelayService(cfg, store, providers={"anthropic": provider})
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service, cfg))
    th = threading.Thread(target=server.serve_forever, daemon=True)
    th.start()
    yield {"url": f"http://127.0.0.1:{server.server_address[1]}", "service": service, "provider": provider, "store": store}
    server.shutdown()


def T(text: str) -> datetime:
    return datetime.fromisoformat(text)


def svc(root: Path, at: str) -> StudyService:
    return StudyService(root, now=T(at), zone=Z)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://example.com",
        "https://trusted.example@attacker.example",
        "https://relay.example:bad",
    ],
)
def test_relay_url_validation_rejects_unsafe_or_ambiguous_urls(url: str) -> None:
    with pytest.raises(StudyError):
        _validate_relay_url(url)


@pytest.mark.parametrize("url", ["https://relay.example", "http://127.0.0.1:1421", "http://[::1]:1421"])
def test_relay_url_validation_allows_expected_urls(url: str) -> None:
    assert _validate_relay_url(url) == url


def assessed_attempt(root: Path) -> str:
    svc(root, "2026-09-18T09:00:00-06:00").import_packet(json.loads((PACKETS / "Q.json").read_text()))
    aid = svc(root, "2026-09-18T09:00:00-06:00").start("Q-1", "review")["attempt"]["attempt_id"]
    svc(root, "2026-09-18T09:02:00-06:00").submit(aid, "", {"inner": "sin x", "derivative": "4sin^3x"})
    return aid


def test_connect_feedback_and_minimal_payload(tmp_path: Path, relay: dict[str, Any]) -> None:
    root = tmp_path / "profile"
    (root / "USER.md").parent.mkdir(parents=True)
    (root / "USER.md").write_text("Name: PRIVATE-NAME-CANARY", encoding="utf-8")
    aid = assessed_attempt(root)
    s = svc(root, "2026-09-18T09:03:00-06:00")
    assert s.ai_status()["connected"] is False
    with pytest.raises(StudyError, match="not connected"):
        s.ai_feedback(aid)
    invite = relay["service"].admin_invite("t", 10)["invite_code"]
    s.ai_connect(relay["url"], invite)
    assert (root / "auth" / "relay.json").exists()
    with pytest.raises(StudyError, match="https"):
        s.ai_connect("http://example.com", "x")
    res = svc(root, "2026-09-18T09:04:00-06:00").ai_feedback(aid)
    assert res["status"] == "complete" and res["proposal"]["outcome"] == "partial"
    assert "provisional" in res["copy"]
    # The deterministic grade and schedule are untouched.
    state = svc(root, "2026-09-18T09:05:00-06:00").history("Q-1")
    assert state["attempts"][0]["grader"] == "deterministic" and state["attempts"][0]["outcome"] == "partial"
    assert state["attempts"][0]["proposals"][0]["status"] == "complete"
    # Payload minimization: the model saw the stem, source, key and answer — nothing else.
    sent = relay["provider"].calls[0]
    assert "4sin^3x" in sent and "sin x is cos x" in sent
    assert "PRIVATE-NAME-CANARY" not in sent and "MATH 1300" not in sent and "Q-1" not in sent
    usage = svc(root, "2026-09-18T09:06:00-06:00").ai_status()
    assert usage["connected"] and usage["settled"] >= 1


def test_timeout_replays_same_request_without_second_bill(tmp_path: Path, relay: dict[str, Any]) -> None:
    root = tmp_path / "profile"
    aid = assessed_attempt(root)
    invite = relay["service"].admin_invite("t", 10)["invite_code"]
    svc(root, "2026-09-18T09:03:00-06:00").ai_connect(relay["url"], invite)
    relay["provider"].script.append(ProviderResult(status="billing_unknown", error_code="timeout_or_unreachable"))
    first = svc(root, "2026-09-18T09:04:00-06:00").ai_feedback(aid)
    assert first["status"] == "billing_unknown" and "not send it twice" in first["copy"]
    again = svc(root, "2026-09-18T09:05:00-06:00").ai_feedback(aid)
    assert again["status"] == "billing_unknown" and again["request_id"] == first["request_id"]
    assert len(relay["provider"].calls) == 1  # replay never re-dispatches
    assert relay["store"].usage_summary()["outstanding"] > 0  # reservation held, not released
    fresh = svc(root, "2026-09-18T09:06:00-06:00").ai_feedback(aid, regenerate=True)
    assert fresh["status"] == "complete" and fresh["request_id"] != first["request_id"]
    assert len(relay["provider"].calls) == 2


def test_quota_and_revocation_copy(tmp_path: Path, relay: dict[str, Any]) -> None:
    root = tmp_path / "profile"
    aid = assessed_attempt(root)
    invite = relay["service"].admin_invite("t", 1)["invite_code"]  # 1 cent: below one bounded dispatch
    s = svc(root, "2026-09-18T09:03:00-06:00")
    s.ai_connect(relay["url"], invite)
    res = svc(root, "2026-09-18T09:04:00-06:00").ai_feedback(aid)
    assert res["status"] == "refused" and "allowance" in res["copy"]
    tester_id = json.loads((root / "auth" / "relay.json").read_text())["tester_id"]
    relay["service"].admin_revoke(tester_id)
    status = svc(root, "2026-09-18T09:05:00-06:00").ai_status()
    assert status["connected"] and status.get("revoked") is True
    assert svc(root, "2026-09-18T09:06:00-06:00").ai_disconnect()["connected"] is False
