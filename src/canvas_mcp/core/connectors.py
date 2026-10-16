"""Product-owned connector state: Google Calendar and Outlook email (Phase 6).

What this module guarantees regardless of provider availability:

- A connector shows ``connected`` only after an authenticated read succeeded;
  ``pending_auth``, ``expired``, ``consent_required``, ``not_configured`` and
  ``disconnected`` are all distinct, and a dry run is never presented as real.
- Tokens live under ``{user_root}/auth/{google,microsoft}/`` (owner-only), are
  never placed in prompts or study events, and disconnect deletes them locally
  (and revokes at the provider when the provider supports it).
- Local records under ``{user_root}/inbox/connectors/`` keep only minimal
  fields (ids, titles/subjects, times, senders); bodies are fetched on demand.
- Every write (Google Calendar create/update) is preview → per-instance token
  → confirm → execute, through the shared ``ConfirmationGuard``; the guard's
  secret and redeemed nonces persist under the profile so the flow survives
  the app's one-process-per-command model.

Live OAuth needs owner registrations (Google client secrets; a Microsoft app
registration client id). Without them the connector reports ``not_configured``
with the exact missing input.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .connector_guards import get_connector_guard
from .ledger import append_ledger
from .private_files import write_private_text
from .write_confirmation import ConfirmationGuard

MS_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0"
MS_GRAPH = "https://graph.microsoft.com/v1.0"
MS_SCOPES = "offline_access User.Read Mail.Read"
GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke"

Http = Callable[[str, dict[str, Any] | None, dict[str, str], str], tuple[int, dict[str, Any]]]


class ConnectorError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --- transport ------------------------------------------------------------------


def http_json(url: str, body: dict[str, Any] | None, headers: dict[str, str], method: str = "GET") -> tuple[int, dict[str, Any]]:
    data = None
    hdrs = dict(headers)
    if body is not None:
        if hdrs.get("content-type") == "application/x-www-form-urlencoded":
            data = urllib.parse.urlencode(body).encode("utf-8")
        else:
            data = json.dumps(body).encode("utf-8")
            hdrs.setdefault("content-type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # nosec B310 - URL is selected from fixed provider constants; nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except ValueError:
            return exc.code, {}


# --- registry -------------------------------------------------------------------


def registry_path(user_root: Path) -> Path:
    return user_root / "auth" / "connectors.json"


def records_dir(user_root: Path) -> Path:
    return user_root / "inbox" / "connectors"


def load_registry(user_root: Path) -> dict[str, dict[str, Any]]:
    try:
        raw = json.loads(registry_path(user_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_registry(user_root: Path, registry: dict[str, dict[str, Any]]) -> None:
    # Holds a pending device_code while Outlook sign-in runs: owner-only.
    write_private_text(registry_path(user_root), json.dumps(registry, indent=2))


def _set(user_root: Path, connector: str, **fields: Any) -> dict[str, Any]:
    registry = load_registry(user_root)
    entry = registry.get(connector) or {"state": "disconnected"}
    entry.update(fields)
    entry["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    registry[connector] = entry
    save_registry(user_root, registry)
    return entry


def _write_secret_file(path: Path, data: dict[str, Any]) -> None:
    write_private_text(path, json.dumps(data))


def _save_record(user_root: Path, connector: str, payload: dict[str, Any]) -> None:
    # Email subjects/senders and calendar titles are personal: owner-only.
    write_private_text(records_dir(user_root) / f"{connector}.json", json.dumps(payload, indent=2))


def load_record(user_root: Path, connector: str) -> dict[str, Any] | None:
    try:
        raw = json.loads((records_dir(user_root) / f"{connector}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def status(user_root: Path) -> dict[str, Any]:
    registry = load_registry(user_root)
    out: dict[str, Any] = {}
    for connector in ("gcal", "outlook"):
        entry = dict(registry.get(connector) or {"state": "disconnected"})
        if entry["state"] == "disconnected":
            if connector == "gcal" and not google_configured():
                entry = {"state": "not_configured", "detail": "Owner must supply GOOGLE_OAUTH_CLIENT_SECRETS (installed-app OAuth client) and the google-auth packages."}
            if connector == "outlook" and not microsoft_client_id():
                entry = {"state": "not_configured", "detail": "Owner must register a Microsoft Entra app (public client, device-code flow) and set MS_OAUTH_CLIENT_ID."}
        record = load_record(user_root, connector)
        entry["last_read"] = (record or {}).get("fetched_at")
        entry["items"] = len((record or {}).get("items") or [])
        out[connector] = entry
    return out


# --- Google Calendar -------------------------------------------------------------


def _google_oauth() -> Any:
    """The existing Google helpers live under mcp-servers/common (outside the
    package); load them lazily so this module stays importable without them."""
    import importlib
    import sys

    helpers = str(Path(__file__).resolve().parents[3] / "mcp-servers")
    if helpers not in sys.path:
        sys.path.insert(0, helpers)
    return importlib.import_module("common.google_oauth")


def google_configured() -> bool:
    try:
        google_oauth = _google_oauth()
    except Exception:  # noqa: BLE001 - optional deps
        return False
    return bool(google_oauth.live_oauth_available())


def google_token_path(user_root: Path) -> Path:
    return user_root / "auth" / "google" / "token.json"


def gcal_connect(user_root: Path) -> dict[str, Any]:
    """Run the installed-app flow in the system browser (loopback redirect),
    then verify with one authenticated read. Blocks until the flow finishes."""
    if not google_configured():
        return _set(user_root, "gcal", state="not_configured", detail="GOOGLE_OAUTH_CLIENT_SECRETS or google-auth packages missing")
    _set(user_root, "gcal", state="pending_auth")
    try:
        google_oauth = _google_oauth()
        service = google_oauth.calendar_service(user_root)
        if service is None:
            return _set(user_root, "gcal", state="disconnected", detail="authorization did not complete")
        events = _gcal_fetch(service, days=14)
    except Exception as exc:  # noqa: BLE001 - provider/library errors become state
        return _set(user_root, "gcal", state="expired" if "invalid_grant" in str(exc) else "disconnected", detail=str(exc)[:200])
    _save_record(user_root, "gcal", {"fetched_at": _now(), "items": events})
    return _set(user_root, "gcal", state="connected", detail="", account="google")


def _gcal_fetch(service: Any, *, days: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    result = (
        service.events()
        .list(calendarId="primary", timeMin=now.isoformat(), timeMax=(now + timedelta(days=days)).isoformat(), singleEvents=True, orderBy="startTime", maxResults=50)
        .execute()
    )
    return [
        {
            "id": str(e.get("id")),
            "summary": str(e.get("summary") or "(no title)")[:200],
            "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
            "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
        }
        for e in result.get("items") or []
    ]


def gcal_read(user_root: Path, *, days: int = 14) -> dict[str, Any]:
    if not google_configured():
        raise ConnectorError("not_configured", "Google Calendar is not configured on this build")
    google_oauth = _google_oauth()
    try:
        service = google_oauth.calendar_service(user_root)
        if service is None:
            _set(user_root, "gcal", state="disconnected")
            raise ConnectorError("disconnected", "Google Calendar is not connected")
        events = _gcal_fetch(service, days=days)
    except ConnectorError:
        raise
    except Exception as exc:  # noqa: BLE001
        _set(user_root, "gcal", state="expired", detail=str(exc)[:200])
        raise ConnectorError("expired", "Google sign-in expired; connect again") from exc
    _save_record(user_root, "gcal", {"fetched_at": _now(), "items": events})
    _set(user_root, "gcal", state="connected", detail="")
    return {"ok": True, "items": events}


def gcal_disconnect(user_root: Path, http: Http = http_json) -> dict[str, Any]:
    path = google_token_path(user_root)
    revoked = False
    try:
        token = json.loads(path.read_text(encoding="utf-8"))
        for key in ("refresh_token", "token"):
            if token.get(key):
                code, _ = http(GOOGLE_REVOKE, {"token": token[key]}, {"content-type": "application/x-www-form-urlencoded"}, "POST")
                revoked = revoked or code == 200
                break
    except (OSError, ValueError):
        pass
    try:
        path.unlink()
    except OSError:
        pass
    try:
        (records_dir(user_root) / "gcal.json").unlink()
    except OSError:
        pass
    return _set(user_root, "gcal", state="disconnected", detail="" if revoked else "local token removed; provider revocation not confirmed", account=None)


# --- Google Calendar write: preview → confirm → execute ----------------------------


def _guard(user_root: Path, connector: str) -> ConfirmationGuard:
    guard = get_connector_guard(f"app/{connector}")
    path = user_root / "auth" / f"confirm-{connector}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        guard.import_state(base64.b64decode(raw["secret"]), {str(k): float(v) for k, v in (raw.get("redeemed") or {}).items()})
    except (OSError, ValueError, KeyError):
        pass
    return guard


def _persist_guard(user_root: Path, connector: str, guard: ConfirmationGuard) -> None:
    secret, redeemed = guard.export_state()
    _write_secret_file(user_root / "auth" / f"confirm-{connector}.json", {"secret": base64.b64encode(secret).decode("ascii"), "redeemed": redeemed})


def gcal_preview_event(user_root: Path, *, summary: str, start_iso: str, end_iso: str, why: str) -> dict[str, Any]:
    """Preview only. Returns a single-use token bound to exactly this content."""
    summary = summary.strip()[:200]
    if not summary or not start_iso or not end_iso:
        raise ConnectorError("validation", "summary, start and end are required")
    guard = _guard(user_root, "gcal")
    fingerprint = guard.fingerprint(summary, start_iso, end_iso, why)
    token = guard.issue(fingerprint)
    _persist_guard(user_root, "gcal", guard)
    state = status(user_root)["gcal"]["state"]
    return {
        "ok": True,
        "preview": {"summary": summary, "start": start_iso, "end": end_iso, "why": why},
        "confirmation_token": token,
        "executable": state == "connected",
        "note": "This creates an event in your Google Calendar only after you confirm this exact preview." if state == "connected" else "Google Calendar is not connected; confirming will not create anything.",
    }


def _ledger_gcal(user_root: Path, *, fingerprint: str, why: str, outcome: str, target: str) -> None:
    """Every confirmed calendar write attempt leaves one local ledger row; a
    ledger failure never turns a real write into a reported failure."""
    try:
        append_ledger(user_root, actor="student", tool="gcal_create_event", target=target[:200], why=why[:300], outcome=outcome, category="calendar", preview_hash=fingerprint)  # type: ignore[arg-type]
    except (OSError, ValueError):
        pass


def gcal_confirm_event(user_root: Path, *, summary: str, start_iso: str, end_iso: str, why: str, confirmation_token: str) -> dict[str, Any]:
    guard = _guard(user_root, "gcal")
    fingerprint = guard.fingerprint(summary.strip()[:200], start_iso, end_iso, why)
    problem = guard.check(confirmation_token, fingerprint)
    if problem:
        # Burn on mismatch: a token previewed for other content can never be
        # replayed against its original content later (revert-replay).
        guard.reserve(confirmation_token)
        _persist_guard(user_root, "gcal", guard)
        _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="veto", target="google_calendar")
        raise ConnectorError("confirmation", problem)
    if not guard.reserve(confirmation_token):
        _persist_guard(user_root, "gcal", guard)
        _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="veto", target="google_calendar")
        raise ConnectorError("confirmation", "that confirmation was already used; preview again")
    _persist_guard(user_root, "gcal", guard)
    if status(user_root)["gcal"]["state"] != "connected":
        guard.release(confirmation_token)
        _persist_guard(user_root, "gcal", guard)
        _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="error", target="google_calendar")
        raise ConnectorError("disconnected", "Google Calendar is not connected; nothing was created")
    google_oauth = _google_oauth()
    service = google_oauth.calendar_service(user_root)
    if service is None:
        guard.release(confirmation_token)
        _persist_guard(user_root, "gcal", guard)
        _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="error", target="google_calendar")
        raise ConnectorError("disconnected", "Google Calendar is not connected; nothing was created")
    try:
        remote = google_oauth.gcal_create_event(service, summary=summary.strip()[:200], start_iso=start_iso, end_iso=end_iso)
    except Exception:
        _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="error", target="google_calendar")
        raise
    _ledger_gcal(user_root, fingerprint=fingerprint, why=why, outcome="success", target=f"google_calendar:{remote.get('id')}")
    return {"ok": True, "created": {"id": str(remote.get("id")), "summary": summary, "start": start_iso, "end": end_iso}, "mode": "live"}


# --- Outlook (Microsoft Graph, device-code flow) --------------------------------------


def microsoft_client_id() -> str:
    return os.environ.get("MS_OAUTH_CLIENT_ID", "").strip()


def ms_token_path(user_root: Path) -> Path:
    return user_root / "auth" / "microsoft" / "token.json"


def outlook_begin(user_root: Path, http: Http = http_json) -> dict[str, Any]:
    """Start the device-code flow. Works for CU-managed and personal accounts
    (`common` authority); tenant consent policy decides whether the org account
    succeeds, and that outcome is reported, not assumed."""
    client_id = microsoft_client_id()
    if not client_id:
        _set(user_root, "outlook", state="not_configured")
        raise ConnectorError("not_configured", "MS_OAUTH_CLIENT_ID is not set (owner app registration pending)")
    code, body = http(f"{MS_AUTHORITY}/devicecode", {"client_id": client_id, "scope": MS_SCOPES}, {"content-type": "application/x-www-form-urlencoded"}, "POST")
    if code != 200 or "device_code" not in body:
        raise ConnectorError("provider", f"device code request failed ({code}): {str(body.get('error_description') or body.get('error') or '')[:160]}")
    verification_uri = _https_link(body.get("verification_uri") or body.get("verification_uri_complete"))
    if not verification_uri:
        raise ConnectorError("provider", "device code response had no https sign-in address")
    _set(user_root, "outlook", state="pending_auth", detail="waiting for sign-in", device={"device_code": body["device_code"], "interval": int(body.get("interval") or 5), "expires_at": time.time() + int(body.get("expires_in") or 900)})
    return {"ok": True, "user_code": str(body["user_code"])[:32], "verification_uri": verification_uri, "message": str(body.get("message", ""))[:500], "expires_in": body.get("expires_in")}


def outlook_poll(user_root: Path, http: Http = http_json) -> dict[str, Any]:
    """One poll of the token endpoint. Call repeatedly (respecting `interval`)."""
    entry = load_registry(user_root).get("outlook") or {}
    device = entry.get("device") or {}
    if entry.get("state") != "pending_auth" or not device.get("device_code"):
        raise ConnectorError("state", "no sign-in is pending; start again")
    if time.time() > float(device.get("expires_at") or 0):
        _set(user_root, "outlook", state="disconnected", detail="sign-in code expired", device=None)
        raise ConnectorError("expired_code", "the sign-in code expired; start again")
    code, body = http(
        f"{MS_AUTHORITY}/token",
        {"client_id": microsoft_client_id(), "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": device["device_code"]},
        {"content-type": "application/x-www-form-urlencoded"},
        "POST",
    )
    if code == 200 and body.get("access_token"):
        _write_secret_file(ms_token_path(user_root), {"access_token": body["access_token"], "refresh_token": body.get("refresh_token"), "expires_at": time.time() + int(body.get("expires_in") or 3600), "scope": body.get("scope")})
        _set(user_root, "outlook", state="pending_verify", detail="", device=None)
        return outlook_read(user_root, http=http)
    error = str(body.get("error") or "")
    if error in ("authorization_pending", "slow_down"):
        return {"ok": True, "pending": True, "interval": int(device.get("interval") or 5) + (5 if error == "slow_down" else 0)}
    if error == "authorization_declined":
        _set(user_root, "outlook", state="disconnected", detail="sign-in declined", device=None)
        raise ConnectorError("declined", "you declined the sign-in")
    if error == "expired_token":
        _set(user_root, "outlook", state="disconnected", detail="sign-in code expired", device=None)
        raise ConnectorError("expired_code", "the sign-in code expired; start again")
    desc = str(body.get("error_description") or "")
    if "AADSTS65001" in desc or "consent" in desc.lower():
        _set(user_root, "outlook", state="consent_required", detail=desc[:200], device=None)
        raise ConnectorError("consent_required", "your organization requires admin consent for this app; a personal account may still work")
    _set(user_root, "outlook", state="disconnected", detail=desc[:200], device=None)
    raise ConnectorError("provider", f"sign-in failed: {error} {desc[:120]}")


def _ms_access_token(user_root: Path, http: Http) -> str:
    try:
        token = json.loads(ms_token_path(user_root).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConnectorError("disconnected", "Outlook is not connected") from exc
    if time.time() < float(token.get("expires_at") or 0) - 60:
        return str(token["access_token"])
    if not token.get("refresh_token"):
        _set(user_root, "outlook", state="expired", detail="no refresh token")
        raise ConnectorError("expired", "Outlook sign-in expired; connect again")
    code, body = http(
        f"{MS_AUTHORITY}/token",
        {"client_id": microsoft_client_id(), "grant_type": "refresh_token", "refresh_token": token["refresh_token"], "scope": MS_SCOPES},
        {"content-type": "application/x-www-form-urlencoded"},
        "POST",
    )
    if code != 200 or not body.get("access_token"):
        _set(user_root, "outlook", state="expired", detail=str(body.get("error") or code)[:120])
        raise ConnectorError("expired", "Outlook sign-in expired; connect again")
    _write_secret_file(ms_token_path(user_root), {"access_token": body["access_token"], "refresh_token": body.get("refresh_token") or token["refresh_token"], "expires_at": time.time() + int(body.get("expires_in") or 3600), "scope": body.get("scope")})
    return str(body["access_token"])


def outlook_read(user_root: Path, *, top: int = 25, http: Http = http_json) -> dict[str, Any]:
    access = _ms_access_token(user_root, http)
    headers = {"authorization": f"Bearer {access}"}
    code, me = http(f"{MS_GRAPH}/me?$select=userPrincipalName,displayName", None, headers, "GET")
    if code == 401:
        _set(user_root, "outlook", state="expired", detail="token rejected")
        raise ConnectorError("expired", "Outlook sign-in expired; connect again")
    code, body = http(f"{MS_GRAPH}/me/messages?$top={int(top)}&$select=id,subject,from,receivedDateTime,isRead,webLink&$orderby=receivedDateTime%20desc", None, headers, "GET")
    if code != 200:
        err = (body.get("error") or {}).get("code") or code
        _set(user_root, "outlook", state="expired" if code in (401, 403) else "connected", detail=str(err)[:120])
        raise ConnectorError("provider", f"mail read failed: {err}")
    items = [
        {
            "id": str(m.get("id")),
            "subject": str(m.get("subject") or "(no subject)")[:200],
            "from": str(((m.get("from") or {}).get("emailAddress") or {}).get("address") or "")[:200],
            "received": m.get("receivedDateTime"),
            "is_read": bool(m.get("isRead")),
            "web_link": _https_link(m.get("webLink")),
        }
        for m in body.get("value") or []
    ]
    _save_record(user_root, "outlook", {"fetched_at": _now(), "items": items})
    account = str(me.get("userPrincipalName") or me.get("displayName") or "microsoft")
    entry = _set(user_root, "outlook", state="connected", detail="", account=account, account_type="organization" if "@colorado.edu" in account.lower() else "personal_or_other")
    return {"ok": True, "items": items, "account": account, "state": entry["state"]}


def outlook_disconnect(user_root: Path) -> dict[str, Any]:
    # Microsoft has no token-revocation endpoint for public clients; deleting
    # the local refresh token ends this device's access, and the student can
    # remove the app under account.microsoft.com → Privacy → Apps.
    for path in (ms_token_path(user_root), records_dir(user_root) / "outlook.json"):
        try:
            path.unlink()
        except OSError:
            pass
    return _set(user_root, "outlook", state="disconnected", detail="local token removed; remove the app in your Microsoft account to revoke", account=None, device=None)


# --- selected context for planning (no model) -----------------------------------------


def relevant_context(user_root: Path, *, course_terms: list[str], days: int = 7) -> dict[str, Any]:
    """Locally select the few calendar events / emails that mention a course.
    This is the only connector content that would ever be offered to AI help,
    and it is chosen here, on the device, by the student's course terms."""
    terms = [t.lower() for t in course_terms if t and len(t) >= 3]
    horizon = datetime.now(timezone.utc) + timedelta(days=days)
    events = [e for e in (load_record(user_root, "gcal") or {}).get("items") or [] if _mentions(e.get("summary", ""), terms) and _before(e.get("start"), horizon)]
    mails = [m for m in (load_record(user_root, "outlook") or {}).get("items") or [] if _mentions(m.get("subject", ""), terms)]
    return {"ok": True, "events": events[:10], "emails": mails[:10]}


def _mentions(text: str, terms: list[str]) -> bool:
    lower = text.lower()
    return any(t in lower for t in terms)


def _before(start: str | None, horizon: datetime) -> bool:
    if not start:
        return False
    try:
        value = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
    except ValueError:
        return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value <= horizon


def _https_link(value: Any) -> str | None:
    """A provider-supplied link the UI may open: https with a host, no credentials."""
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
