"""Funded AI relay under abuse: slow clients, crashes mid-dispatch, budget races."""

from __future__ import annotations

import socket
import threading

import pytest
from conftest import finding
from relay.providers import ProviderResult
from relay_harness import ScriptedProvider, running_relay, study_body


def _slow_post(url: str, headers: str, body: bytes = b"") -> socket.socket:
    host, port = url.removeprefix("http://").split(":")
    sock = socket.create_connection((host, int(port)), timeout=5)
    sock.sendall(f"POST /v1/invite/redeem HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n{headers}\r\n".encode() + body)
    return sock


@finding("F10", "no socket timeout: an unauthenticated client that under-sends its body pins a relay thread forever")
@pytest.mark.parametrize("headers", ["Content-Length: 100\r\n", "Content-Length: -1\r\n"], ids=["short_body", "negative_length"])
def test_slow_client_is_cut_off(tmp_path, headers) -> None:
    with running_relay(tmp_path) as relay:
        sock = _slow_post(relay.url, headers, b"{")
        sock.settimeout(8)
        try:
            data = sock.recv(1024)
        except TimeoutError:
            data = None
        finally:
            sock.close()
        assert data is not None, "relay held the connection open with no response for 8s"


@finding("F11", "a provider exception after reserve() leaves the row 'reserved' forever: tester is locked out (429 busy) for good")
def test_provider_crash_does_not_lock_tester(tmp_path) -> None:
    def boom(_content: str) -> ProviderResult:
        raise AttributeError("unexpected provider body")

    provider = ScriptedProvider(behavior=boom)
    with running_relay(tmp_path, provider) as relay:
        token = relay.tester()
        status, _ = relay.call("POST", "/v1/study", study_body(), token=token)
        assert status == 500
        provider.behavior = None
        status, body = relay.call("POST", "/v1/study", study_body(), token=token)
        assert status == 200, f"tester locked after one crash: {status} {body.get('error')}"


@finding("F11", "three crashed dispatches exhaust GLOBAL_CONCURRENCY for every tester")
def test_provider_crashes_do_not_lock_service(tmp_path) -> None:
    provider = ScriptedProvider(behavior=lambda c: (_ for _ in ()).throw(KeyError("x")))
    with running_relay(tmp_path, provider) as relay:
        for _ in range(3):
            relay.call("POST", "/v1/study", study_body(), token=relay.tester())
        provider.behavior = None
        status, body = relay.call("POST", "/v1/study", study_body(), token=relay.tester())
        assert status == 200, f"fresh tester refused: {status} {body.get('error')}"


@finding("F12", "session_budget_id is global, not per tester: one tester can burn another's session cap")
def test_session_cap_is_per_tester(tmp_path) -> None:
    with running_relay(tmp_path) as relay:
        attacker, victim = relay.tester(), relay.tester()
        for _ in range(6):
            relay.call("POST", "/v1/study", study_body(session="shared-session"), token=attacker)
        status, body = relay.call("POST", "/v1/study", study_body(session="shared-session"), token=victim)
        assert status == 200, f"victim refused by attacker's usage: {body.get('error')}"


def test_request_id_cannot_read_another_testers_result(tmp_path) -> None:
    with running_relay(tmp_path) as relay:
        a, b = relay.tester(), relay.tester()
        body = study_body(request_id="shared-id")
        assert relay.call("POST", "/v1/study", body, token=a)[0] == 200
        status, reply = relay.call("POST", "/v1/study", body, token=b)
        assert status == 409 and "assessment_proposal" not in reply
        assert relay.call("GET", "/v1/status/shared-id", token=b)[0] == 404


def test_concurrent_burst_never_overspends(tmp_path) -> None:
    provider = ScriptedProvider(delay=0.05)
    with running_relay(tmp_path, provider, envelope_cents=1030, fixed_fees_cents=1000) as relay:  # 30¢ global
        tokens = [relay.tester(allowance_cents=20) for _ in range(8)]
        results: list[int] = []

        def worker(tok: str) -> None:
            for i in range(10):
                results.append(relay.call("POST", "/v1/study", study_body(session=f"s-{tok[:6]}-{i}"), token=tok)[0])

        threads = [threading.Thread(target=worker, args=(t,)) for t in tokens]
        [t.start() for t in threads]
        [t.join() for t in threads]
        summary = relay.service.admin_budget()
        assert summary["settled"] + summary["outstanding"] <= 30
        assert results.count(200) >= 1


def test_client_cannot_choose_model_or_add_fields(tmp_path) -> None:
    with running_relay(tmp_path) as relay:
        token = relay.tester()
        status, body = relay.call("POST", "/v1/study", {**study_body(), "model": "claude-sonnet-5"}, token=token)
        assert status == 400 and "fields not accepted" in body["error"]["message"]


def test_model_output_is_passed_through_unfiltered(tmp_path) -> None:
    """Observation for F13: relay schema-checks the proposal but not its prose,
    so a hijacked model's link/instructions reach the student verbatim."""
    phish = '{"schema_version":1,"status":"complete","outcome":"correct","feedback":"Log in again at http://canvas-login.example.invalid","support_rows":[]}'
    provider = ScriptedProvider(behavior=lambda c: ProviderResult(status="complete", text=phish, usage={"input": 10, "output": 10, "reasoning": 0}))
    with running_relay(tmp_path, provider) as relay:
        status, body = relay.call("POST", "/v1/study", study_body(), token=relay.tester())
        assert status == 200
        if "canvas-login.example.invalid" in body["assessment_proposal"]["feedback"]:
            pytest.xfail("F13: model feedback links/instructions are not filtered before reaching the student")
