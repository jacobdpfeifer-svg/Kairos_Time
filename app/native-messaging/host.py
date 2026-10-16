#!/usr/bin/env python3
"""Chrome Native Messaging host for the Kairos extension.

Protocol: 4-byte little-endian length + UTF-8 JSON on stdin/stdout.

Standard library only, Python 3.9+: Chrome launches this with the system
``python3`` (``/usr/bin/python3`` on macOS), which has none of the project's
packages. Importing ``canvas_mcp`` here broke the host on every machine
without the dev venv (found 2026-09-29), so the user-root rule is mirrored
below instead — keep it in step with ``app/src-tauri/src/runtime.rs``.

The host only moves data between the extension and ``{user_root}``:
  canvas_delta / canvas_signed_out  → queue for the freshness tick
  get_dashboard / get_assignment_context → read the brain's view model
  queue_calendar_suggestion         → the app's suggestion list (student approves there)
  queue_ask                         → a private Ask intake the app classifies later
  get_school                        → the Canvas origin chosen at sign-up
  ping                              → beta funnel markers
It never talks to Canvas and never writes anywhere a student didn't ask for.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOST_VERSION = 1
PRODUCT_DIR = "Kairos"
DEFAULT_PROFILE = "dev"
MAX_MESSAGE_BYTES = 1_000_000
# Chrome caps extension -> host frames at 64 MiB; anything larger is not a
# real frame, so the stream cannot be resynchronised and the port closes.
MAX_DRAIN_BYTES = 64 * 1024 * 1024
MAX_DELTA_ITEMS = 200
MAX_PENDING_DELTAS = 50
MAX_PENDING_ASKS = 100
MAX_PENDING_SUGGESTIONS = 500
MAX_FUNNEL_KEYS = 32
MAX_SENSOR_FIELD = 300
EVENT_WINDOW = timedelta(days=14)
_PROFILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


# ---------------------------------------------------------------- user root


def _valid_profile(value: str) -> bool:
    return bool(_PROFILE_RE.match(value)) and value not in (".", "..")


def _app_support_root() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / PRODUCT_DIR
    if sys.platform.startswith("win"):
        appdata = os.environ.get("APPDATA")
        return Path(appdata) / PRODUCT_DIR if appdata else home / "AppData" / "Roaming" / PRODUCT_DIR
    xdg = os.environ.get("XDG_DATA_HOME")
    return Path(xdg) / PRODUCT_DIR if xdg else home / ".local" / "share" / PRODUCT_DIR


def current_profile_id() -> str:
    env_id = os.environ.get("PRODUCT_USER_ID", "").strip()
    if _valid_profile(env_id):
        return env_id
    try:
        file_id = (_app_support_root() / "current_profile").read_text(encoding="utf-8").strip()
        if _valid_profile(file_id):
            return file_id
    except OSError:
        pass
    return DEFAULT_PROFILE


def resolve_user_root() -> Path:
    override = os.environ.get("DEV_USER_ROOT", "").strip()
    if override:
        return Path(override)
    return _app_support_root() / current_profile_id()


def _private_dir(path: Path) -> Path:
    """mkdir -p with owner-only (0700) on every directory this host creates."""
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def freshness_dir(root: Path) -> Path:
    return root / "inbox" / "freshness"


# ---------------------------------------------------------------- framing


def _read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    (length,) = struct.unpack("<I", raw_len)
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        # Drain the whole frame so its tail is never parsed as the next length
        # prefix; a frame too large to be real closes the port instead.
        if length <= 0 or length > MAX_DRAIN_BYTES:
            return {"type": "_oversize", "_close": True}
        remaining = length
        while remaining:
            chunk = sys.stdin.buffer.read(min(remaining, 65536))
            if not chunk:
                return None
            remaining -= len(chunk)
        return {"type": "_oversize"}
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"type": "_invalid_json"}


def _write_message(payload: dict) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ---------------------------------------------------------------- files


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _write_private(path: Path, data: dict) -> None:
    _private_dir(path.parent)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(str(tmp), flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)


def _append_private(path: Path, line: str) -> None:
    _private_dir(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(str(path), flags, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _read_json(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # ValueError covers JSON and UTF-8 decode errors
        return fallback


def _append_sensor(root: Path, row: dict) -> Path:
    path = root / "sensors" / "chrome.jsonl"
    _append_private(path, json.dumps({"ts": _now_iso(), **row}))
    return path


def _mark_funnel(root: Path, milestone: str, extra: dict | None = None) -> None:
    path = freshness_dir(root) / "funnel.json"
    funnel = _read_json(path, {}) or {}
    if not isinstance(funnel, dict):
        funnel = {}
    changed = False
    if milestone not in funnel:
        funnel[milestone] = _now_iso()
        changed = True
    if extra is not None:
        funnel["extension"] = extra
        changed = True
    if changed and len(funnel) <= MAX_FUNNEL_KEYS + 8:
        _write_private(path, funnel)


# ---------------------------------------------------------------- handlers


def _valid_delta(delta) -> bool:
    if not isinstance(delta, dict) or delta.get("v") != 1 or _parse_iso(delta.get("ts")) is None:
        return False
    for key in ("stream", "planner", "summary"):
        value = delta.get(key)
        if value is not None and (not isinstance(value, list) or len(value) > MAX_DELTA_ITEMS):
            return False
    return True


def _queue_delta(root: Path, delta: dict) -> dict:
    deltas = _private_dir(freshness_dir(root) / "deltas")
    if len([p for p in deltas.iterdir() if p.suffix == ".json"]) >= MAX_PENDING_DELTAS:
        return {"ok": False, "error": "backlog_full"}
    name = f"{int(time.time() * 1000):013d}-{uuid.uuid4().hex[:8]}.json"
    _write_private(deltas / name, delta)
    return {"ok": True, "queued": True}


def handle_canvas_delta(root: Path, msg: dict) -> dict:
    delta = msg.get("delta")
    if not _valid_delta(delta):
        return {"ok": False, "error": "invalid_delta"}
    result = _queue_delta(root, delta)
    if result.get("ok"):
        _append_sensor(root, {"type": "canvas_delta", "items": len(delta.get("stream") or [])})
        _mark_funnel(root, "first_delta_received")
    return result


def handle_signed_out(root: Path, msg: dict) -> dict:
    ts = msg.get("ts") if _parse_iso(msg.get("ts")) else _now_iso()
    return _queue_delta(root, {"v": 1, "ts": ts, "signed_in": False})


def handle_get_dashboard(root: Path, _msg: dict) -> dict:
    dashboard = _read_json(freshness_dir(root) / "dashboard.json")
    if not isinstance(dashboard, dict):
        return {"ok": False, "error": "no_dashboard"}
    return {"ok": True, "dashboard": dashboard}


def _norm(text) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _recent_events(root: Path) -> list:
    path = freshness_dir(root) / "events.jsonl"
    floor = datetime.now(timezone.utc) - EVENT_WINDOW
    out = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError):
        return out
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        when = _parse_iso(event.get("detected_at")) or _parse_iso(event.get("at"))
        if when and when >= floor:
            out.append(event)
    return out


def handle_assignment_context(root: Path, msg: dict) -> dict:
    course_id = str(msg.get("course_id") or "")
    assignment_id = str(msg.get("assignment_id") or "")
    if not course_id.isdigit() or not assignment_id.isdigit():
        return {"ok": False, "error": "invalid_ids"}
    title = _norm(msg.get("title"))[:200]
    costs = _read_json(freshness_dir(root) / "skip-costs.json", {})
    if not isinstance(costs, dict):
        costs = {}
    mentions = []
    changes = []
    for event in _recent_events(root):
        if str(event.get("course_id") or "") not in ("", course_id):
            continue
        if event.get("kind") == "announcement":
            detail = event.get("detail") if isinstance(event.get("detail"), dict) else {}
            actions = event.get("actions") if isinstance(event.get("actions"), list) else []
            blob = _norm(" ".join([str(event.get("title") or ""), str(detail.get("preview") or "")]
                                  + [str(a.get("text", "")) for a in actions if isinstance(a, dict)]))
            if title and title in blob:
                mentions.append({k: event.get(k) for k in ("key", "title", "at", "url", "actions")})
        elif title and _norm(event.get("title")) == title:
            changes.append({k: event.get(k) for k in ("key", "kind", "title", "detected_at", "detail")})
    return {
        "ok": True,
        "skip_cost": costs.get(f"{course_id}:{assignment_id}"),
        "mentions": mentions[-5:],
        "changes": changes[-5:],
    }


def handle_calendar_suggestion(root: Path, msg: dict) -> dict:
    s = msg.get("suggestion")
    if not isinstance(s, dict):
        return {"ok": False, "error": "invalid_suggestion"}
    key, title, why = s.get("key"), s.get("title"), s.get("why", "")
    start, end = _parse_iso(s.get("start")), _parse_iso(s.get("end"))
    if not (isinstance(key, str) and 0 < len(key) <= 300 and isinstance(title, str) and 0 < len(title) <= 200):
        return {"ok": False, "error": "invalid_suggestion"}
    if not isinstance(why, str) or len(why) > 300 or start is None or end is None:
        return {"ok": False, "error": "invalid_suggestion"}
    if not (timedelta(0) < end - start <= timedelta(hours=6)):
        return {"ok": False, "error": "invalid_window"}
    source_id = "pn-fresh-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    path = root / "inbox" / "calendar-suggestions.jsonl"
    try:
        existing = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        existing = ""
    if existing.count("\n") >= MAX_PENDING_SUGGESTIONS:
        return {"ok": False, "error": "backlog_full"}
    if f'"source_message_id": "{source_id}"' in existing or f'"source_message_id":"{source_id}"' in existing:
        return {"ok": True, "queued": False, "duplicate": True}
    row = {
        "source_message_id": source_id,
        "title": title,
        "start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "confidence": 0.9,
        "why": why or "Suggested from a Canvas change",
    }
    _append_private(path, json.dumps(row))
    _mark_funnel(root, "first_calendar_suggestion")
    return {"ok": True, "queued": True}


def handle_queue_ask(root: Path, msg: dict) -> dict:
    """Stage an Ask intake for the app. The host does not classify or call a model."""
    content = str(msg.get("content") or "").strip()
    if not content or len(content) > 8000:
        return {"ok": False, "error": "empty_ask"}
    kind = str(msg.get("content_kind") or "source_ref")
    if kind not in ("text", "image", "audio", "selection", "source_ref", "mixed"):
        return {"ok": False, "error": "invalid_ask"}
    canvas = msg.get("canvas") if isinstance(msg.get("canvas"), dict) else {}
    types = canvas.get("submission_types") if isinstance(canvas.get("submission_types"), list) else []
    record = {
        "schema": 1,
        "content_kind": kind,
        "content": content,
        "course_hint": str(msg.get("course_hint") or "")[:200],
        "assignment_hint": str(msg.get("assignment_hint") or "")[:300],
        "session_goal": "unknown",
        "canvas": {
            "kind": str(canvas.get("kind") or canvas.get("type") or "")[:64],
            "submission_types": [str(item)[:64] for item in types[:8]],
            "title": str(canvas.get("title") or "")[:300],
            "due_at": str(canvas.get("due_at") or "")[:64],
            "points": canvas.get("points") if isinstance(canvas.get("points"), (int, float)) else 0,
            "lti": bool(canvas.get("lti")),
            "proctored": bool(canvas.get("proctored")),
            "course_label": str(canvas.get("course_label") or "")[:200],
        },
        "privacy_scope": "private",
        "origin": "extension",
    }
    directory = _private_dir(root / "study" / "ask-inbox")
    if sum(1 for p in directory.iterdir() if p.suffix == ".json") >= MAX_PENDING_ASKS:
        return {"ok": False, "error": "backlog_full"}
    path = directory / f"ext-{uuid.uuid4()}.json"
    _write_private(path, record)
    return {"ok": True, "queued": True}


def handle_ping(root: Path, msg: dict) -> dict:
    funnel = msg.get("funnel")
    snapshot = None
    if isinstance(funnel, dict):
        # Timestamps and counts only — drop anything else the extension sends.
        snapshot = {
            k: v for k, v in list(funnel.items())[:MAX_FUNNEL_KEYS]
            if isinstance(k, str) and len(k) <= 40 and (isinstance(v, (int, float)) or (isinstance(v, str) and len(v) <= 40))
        }
    _mark_funnel(root, "native_host_first_ping", snapshot)
    dashboard = _read_json(freshness_dir(root) / "dashboard.json")
    if not isinstance(dashboard, dict):
        dashboard = {}
    return {
        "ok": True,
        "host_version": HOST_VERSION,
        "profile": current_profile_id() if not os.environ.get("DEV_USER_ROOT") else "dev-override",
        "dashboard_at": dashboard.get("generated_at"),
    }


def handle_get_school(root: Path, _msg: dict) -> dict:
    """The Canvas origin the app found at sign-up, so the extension can offer to turn on there."""
    profile = _read_json(root / "school" / "profile.json")
    if not isinstance(profile, dict):
        return {"ok": False, "error": "no_school"}
    base = str(profile.get("canvas_base_url") or "")
    if not re.match(r"^https://[a-z0-9.-]+\.[a-z]{2,63}/?$", base, re.IGNORECASE):
        return {"ok": False, "error": "no_school"}
    return {"ok": True, "canvas_base_url": base.rstrip("/") + "/", "name": str(profile.get("display_name") or "")[:120]}


def _clip_field(value):
    return value[:MAX_SENSOR_FIELD] if isinstance(value, str) else None


def handle_legacy_sensor(root: Path, msg: dict) -> dict:
    # Canvas URLs only (no query: it can carry tokens), short strings, and no
    # local path in the reply — the extension has no use for it.
    url = _clip_field(msg.get("url")) or ""
    url = url.split("?", 1)[0].split("#", 1)[0]
    _append_sensor(root, {"type": _clip_field(msg.get("type")), "url": url, "ts": _clip_field(msg.get("ts"))})
    return {"ok": True}


HANDLERS = {
    "canvas_delta": handle_canvas_delta,
    "canvas_signed_out": handle_signed_out,
    "get_dashboard": handle_get_dashboard,
    "get_assignment_context": handle_assignment_context,
    "queue_calendar_suggestion": handle_calendar_suggestion,
    "queue_ask": handle_queue_ask,
    "ping": handle_ping,
    "get_school": handle_get_school,
    "canvas_focus": handle_legacy_sensor,
    "canvas_visible": handle_legacy_sensor,
}


def handle(msg) -> dict:
    if not isinstance(msg, dict):
        return {"ok": False, "error": "invalid_message"}
    kind = msg.get("type")
    if not isinstance(kind, str):
        return {"ok": False, "error": "unknown_type"}
    if kind == "_oversize":
        return {"ok": False, "error": "message_too_large"}
    if kind == "_invalid_json":
        return {"ok": False, "error": "invalid_json"}
    handler = HANDLERS.get(kind)
    if handler is None:
        return {"ok": False, "error": "unknown_type"}
    try:
        root = resolve_user_root()
        if not root.exists():
            # Grades, notes and Ask text land here: never world-readable.
            root.mkdir(parents=True, mode=0o700)
        return handler(root, msg)
    except OSError as exc:
        return {"ok": False, "error": "io_error", "detail": exc.__class__.__name__}
    except Exception as exc:  # noqa: BLE001 - one bad file or message must not kill the port
        return {"ok": False, "error": "internal_error", "detail": exc.__class__.__name__}


def main() -> int:
    while True:
        msg = _read_message()
        if msg is None:
            break
        _write_message(handle(msg))
        if isinstance(msg, dict) and msg.get("_close"):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
