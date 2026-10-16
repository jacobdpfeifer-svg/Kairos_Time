"""Client side of funded AI help (Phase 5).

Everything the model sees is selected here, locally: item sources (clipped),
the stem, a compact rubric, and the committed answer. No profile, no course
ids, no Canvas URLs, no tokens. The relay holds the vendor secret; this module
holds only the tester's session token in ``{user_root}/auth/relay.json``.

A proposal is stored as an ``ai_proposal`` event. It never changes stability
or the deterministic grade (DECISIONS D-05); the UI shows it as provisional.
"""

from __future__ import annotations

import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .model import StudyError, write_private_text

PRICING_VERSION = "2026-09-18"  # must match services/relay/relay/config.py
TIMEOUT_SECONDS = 35
MAX_PASSAGE_CHARS = 6000
MAX_PASSAGES = 6


def _validate_relay_url(raw_url: str) -> str:
    """Return a safe relay base URL or raise a local validation error.

    Relay URLs are user-configured, so never rely on a string prefix check:
    ``https://trusted.example@attacker.example`` is syntactically HTTPS but
    connects to the attacker.  HTTP is deliberately limited to loopback for
    local development; production relays must use HTTPS.
    """
    url = str(raw_url or "").strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname
        port = parsed.port  # force validation of malformed ports
    except ValueError as exc:
        raise StudyError("validation", "relay URL is malformed") from exc
    if not hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise StudyError("validation", "relay URL must contain only a host and optional path")
    if parsed.scheme == "https":
        return url
    if parsed.scheme != "http":
        raise StudyError("validation", "relay URL must use https (loopback http is allowed for development)")
    try:
        address = ipaddress.ip_address(hostname)
        loopback = address.is_loopback
    except ValueError:
        loopback = hostname.lower() in {"localhost"}
    if not loopback:
        raise StudyError("validation", "relay URL must use https; plain HTTP is allowed only on loopback")
    if port is None:
        return url
    if not 1 <= port <= 65535:
        raise StudyError("validation", "relay URL port is invalid")
    return url


def relay_config_path(user_root: Path) -> Path:
    return user_root / "auth" / "relay.json"


def load_relay(user_root: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(relay_config_path(user_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or not raw.get("url") or not raw.get("session_token"):
        return None
    try:
        raw["url"] = _validate_relay_url(str(raw["url"]))
    except StudyError:
        return None
    return raw


def save_relay(user_root: Path, data: dict[str, Any]) -> None:
    # The session token is a bearer credential for funded AI access.
    write_private_text(relay_config_path(user_root), json.dumps(data))


def clear_relay(user_root: Path) -> None:
    try:
        relay_config_path(user_root).unlink()
    except OSError:
        pass


def _post(url: str, body: dict[str, Any], token: str | None) -> tuple[int, dict[str, Any]]:
    url = _validate_relay_url(url)
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # nosec B310 - URL passed through _validate_relay_url; nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except ValueError:
            return exc.code, {"ok": False, "error": {"code": f"http_{exc.code}", "message": "relay error"}}


def _get(url: str, token: str) -> tuple[int, dict[str, Any]]:
    url = _validate_relay_url(url)
    req = urllib.request.Request(url, method="GET")
    req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # nosec B310 - URL loaded only after _validate_relay_url; nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except ValueError:
            return exc.code, {"ok": False, "error": {"code": f"http_{exc.code}", "message": "relay error"}}


def connect(user_root: Path, url: str, invite_code: str) -> dict[str, Any]:
    url = _validate_relay_url(url)
    try:
        status, body = _post(f"{url}/v1/invite/redeem", {"code": invite_code.strip()}, None)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise StudyError("unreachable", f"could not reach the relay: {exc}") from exc
    if status != 200 or not body.get("ok"):
        err = body.get("error") or {}
        raise StudyError(str(err.get("code") or "relay"), str(err.get("message") or "invite was not accepted"))
    if body.get("pricing_version") != PRICING_VERSION:
        raise StudyError("stale_pricing", "this app build pins a different pricing version than the relay; update the app")
    save_relay(user_root, {"url": url, "session_token": body["session_token"], "tester_id": body["tester_id"], "pricing_version": PRICING_VERSION})
    return {"ok": True, "tester_id": body["tester_id"], "url": url}


def usage(user_root: Path) -> dict[str, Any]:
    cfg = load_relay(user_root)
    if cfg is None:
        return {"ok": True, "connected": False}
    try:
        status, body = _get(f"{cfg['url']}/v1/usage", cfg["session_token"])
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"ok": True, "connected": True, "reachable": False, "error": str(exc)}
    if status != 200:
        err = body.get("error") or {}
        return {"ok": True, "connected": True, "reachable": True, "error": str(err.get("code") or status), "revoked": err.get("code") == "revoked"}
    return {"ok": True, "connected": True, "reachable": True, **{k: v for k, v in body.items() if k != "ok"}}


def build_request(
    *,
    request_id: str,
    session_budget_id: str,
    purpose: str,
    sources: list[dict[str, Any]],
    stem: str,
    rubric: str,
    submitted_answer: str,
) -> dict[str, Any]:
    passages = []
    for source in sources[:MAX_PASSAGES]:
        text = str(source.get("text") or "")[:MAX_PASSAGE_CHARS]
        passages.append({"locator": str(source.get("locator") or "source")[:200], "text": text})
    return {
        "request_id": request_id,
        "session_budget_id": session_budget_id,
        "purpose": purpose,
        "source_passages": passages,
        "stem": stem[:4000],
        "rubric": rubric[:4000],
        "submitted_answer": submitted_answer[:8000],
        "schema_version": 1,
        "pricing_version": PRICING_VERSION,
    }


def dispatch(user_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    """One relay call. Returns the relay envelope, or a local pending envelope
    on transport failure (the request id can be replayed later)."""
    cfg = load_relay(user_root)
    if cfg is None:
        raise StudyError("not_connected", "AI help is not connected; enter an invite code in Settings")
    try:
        status, body = _post(f"{cfg['url']}/v1/study", request, cfg["session_token"])
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return {"ok": True, "status": "pending_unknown", "error": f"transport: {type(exc).__name__}", "request_id": request["request_id"]}
    if status != 200 or not body.get("ok"):
        err = body.get("error") or {}
        return {"ok": True, "status": "refused", "error": str(err.get("code") or f"http_{status}"), "message": str(err.get("message") or ""), "request_id": request["request_id"]}
    return body
