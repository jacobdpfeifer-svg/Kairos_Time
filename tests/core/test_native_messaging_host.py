"""Native Messaging host: framing, stdlib-only launch, and each message type."""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HOST = REPO / "app" / "native-messaging" / "host.py"
# Chrome launches the host with the system interpreter, which has none of the
# project's packages. Prefer it; `-S -I` (no site-packages, isolated) proves
# the host is stdlib-only even where /usr/bin/python3 is absent.
BARE_PYTHON = "/usr/bin/python3" if Path("/usr/bin/python3").exists() else sys.executable


def _frame(payload) -> bytes:
    body = json.dumps(payload).encode("utf-8")
    return struct.pack("<I", len(body)) + body


def _run(messages, env_extra):
    env = {k: v for k, v in os.environ.items() if k not in ("DEV_USER_ROOT", "PRODUCT_USER_ID")}
    env.update(env_extra)
    proc = subprocess.run(
        [BARE_PYTHON, "-S", "-I", str(HOST)],
        input=b"".join(_frame(m) for m in messages),
        capture_output=True,
        check=True,
        env=env,
        timeout=30,
    )
    replies, out = [], proc.stdout
    while len(out) >= 4:
        (n,) = struct.unpack("<I", out[:4])
        replies.append(json.loads(out[4 : 4 + n].decode("utf-8")))
        out = out[4 + n :]
    return replies


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


NOW = datetime.now(timezone.utc)


def test_legacy_sensor_still_appends(tmp_path):
    [reply] = _run([{"type": "canvas_focus", "url": "https://canvas.colorado.edu", "ts": 1}], {"DEV_USER_ROOT": str(tmp_path)})
    assert reply["ok"] is True
    line = json.loads((tmp_path / "sensors" / "chrome.jsonl").read_text(encoding="utf-8").strip().splitlines()[-1])
    assert line["type"] == "canvas_focus"


def test_canvas_delta_is_queued_privately_and_bad_ones_rejected(tmp_path):
    delta = {"v": 1, "ts": _iso(NOW), "summary": [], "stream": [{"type": "Announcement", "id": 1}], "planner": []}
    ok, bad, huge = _run(
        [
            {"type": "canvas_delta", "delta": delta},
            {"type": "canvas_delta", "delta": {"v": 2, "ts": "x"}},
            {"type": "canvas_delta", "delta": {**delta, "stream": [{}] * 201}},
        ],
        {"DEV_USER_ROOT": str(tmp_path)},
    )
    assert ok == {"ok": True, "queued": True}
    assert bad["error"] == "invalid_delta" and huge["error"] == "invalid_delta"
    files = list((tmp_path / "inbox" / "freshness" / "deltas").glob("*.json"))
    assert len(files) == 1
    assert json.loads(files[0].read_text(encoding="utf-8")) == delta
    assert files[0].stat().st_mode & 0o777 == 0o600
    funnel = json.loads((tmp_path / "inbox" / "freshness" / "funnel.json").read_text(encoding="utf-8"))
    assert "first_delta_received" in funnel


def test_signed_out_queues_a_status_delta(tmp_path):
    [reply] = _run([{"type": "canvas_signed_out", "ts": _iso(NOW)}], {"DEV_USER_ROOT": str(tmp_path)})
    assert reply["queued"] is True
    [f] = list((tmp_path / "inbox" / "freshness" / "deltas").glob("*.json"))
    assert json.loads(f.read_text(encoding="utf-8"))["signed_in"] is False


def test_dashboard_read(tmp_path):
    missing, = _run([{"type": "get_dashboard"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert missing == {"ok": False, "error": "no_dashboard"}
    fresh = tmp_path / "inbox" / "freshness"
    fresh.mkdir(parents=True)
    (fresh / "dashboard.json").write_text(json.dumps({"version": 1, "next_step": {"title": "HW 5"}}), encoding="utf-8")
    [reply] = _run([{"type": "get_dashboard"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert reply["dashboard"]["next_step"]["title"] == "HW 5"


def test_calendar_suggestion_goes_to_the_apps_list_once(tmp_path):
    start = NOW + timedelta(days=1)
    s = {"key": "12:3", "title": "Work on HW 2", "start": _iso(start), "end": _iso(start + timedelta(minutes=90)), "why": "Due Friday"}
    first, dup, bad = _run(
        [
            {"type": "queue_calendar_suggestion", "suggestion": s},
            {"type": "queue_calendar_suggestion", "suggestion": s},
            {"type": "queue_calendar_suggestion", "suggestion": {**s, "key": "x", "end": _iso(start + timedelta(hours=9))}},
        ],
        {"DEV_USER_ROOT": str(tmp_path)},
    )
    assert first == {"ok": True, "queued": True}
    assert dup["duplicate"] is True
    assert bad["error"] == "invalid_window"
    rows = [json.loads(line) for line in (tmp_path / "inbox" / "calendar-suggestions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["source_message_id"].startswith("pn-fresh-")
    # Same contract app/src-tauri/src/calendar.rs reads.
    assert set(rows[0]) == {"source_message_id", "title", "start", "end", "confidence", "why"}


def test_assignment_context_joins_skip_cost_and_mentions(tmp_path):
    fresh = tmp_path / "inbox" / "freshness"
    fresh.mkdir(parents=True)
    (fresh / "skip-costs.json").write_text(json.dumps({"12:3": {"swing": 20, "if_zero": 66}}), encoding="utf-8")
    events = [
        {"key": "announcement:1", "kind": "announcement", "course_id": "12", "title": "Reminder", "detected_at": _iso(NOW),
         "detail": {"preview": "HW 2 now includes problem 6."}, "actions": []},
        {"key": "snap-due:12:3", "kind": "due_changed", "course_id": "12", "title": "HW 2", "detected_at": _iso(NOW), "detail": {"to": "x"}},
        {"key": "announcement:2", "kind": "announcement", "course_id": "99", "title": "HW 2 elsewhere", "detected_at": _iso(NOW)},
        {"key": "announcement:3", "kind": "announcement", "course_id": "12", "title": "HW 2 old", "detected_at": _iso(NOW - timedelta(days=30))},
    ]
    (fresh / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    [reply] = _run([{"type": "get_assignment_context", "course_id": "12", "assignment_id": "3", "title": "HW 2"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert reply["skip_cost"]["swing"] == 20
    assert [m["key"] for m in reply["mentions"]] == ["announcement:1"]
    assert [c["kind"] for c in reply["changes"]] == ["due_changed"]
    [bad] = _run([{"type": "get_assignment_context", "course_id": "../x", "assignment_id": "3"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert bad["error"] == "invalid_ids"


def test_ping_keeps_only_timestamps_and_counts(tmp_path):
    [reply] = _run(
        [{"type": "ping", "funnel": {"installed_at": "2026-09-29T00:00:00Z", "dashboard_views": 3, "note": "x" * 200, "nested": {"a": 1}}}],
        {"DEV_USER_ROOT": str(tmp_path)},
    )
    assert reply["ok"] is True and reply["host_version"] == 1
    funnel = json.loads((tmp_path / "inbox" / "freshness" / "funnel.json").read_text(encoding="utf-8"))
    assert funnel["extension"] == {"installed_at": "2026-09-29T00:00:00Z", "dashboard_views": 3}
    assert "native_host_first_ping" in funnel


def test_active_profile_comes_from_the_apps_current_profile_file(tmp_path):
    if sys.platform != "darwin":
        return
    support = tmp_path / "Library" / "Application Support" / "Kairos"
    support.mkdir(parents=True)
    (support / "current_profile").write_text("student-a\n", encoding="utf-8")
    [reply] = _run([{"type": "canvas_signed_out"}], {"HOME": str(tmp_path)})
    assert reply["queued"] is True
    assert list((support / "student-a" / "inbox" / "freshness" / "deltas").glob("*.json"))
    (support / "current_profile").write_text("../escape", encoding="utf-8")
    _run([{"type": "canvas_signed_out"}], {"HOME": str(tmp_path)})
    assert list((support / "dev" / "inbox" / "freshness" / "deltas").glob("*.json"))


def test_queue_ask_stages_a_private_intake_without_canvas_urls(tmp_path):
    [reply] = _run(
        [
            {
                "type": "queue_ask",
                "content_kind": "selection",
                "content": "Find the derivative of x^2",
                "assignment_hint": "Written HW",
                "html_url": "https://canvas.example/secret",
                "course_id": "4242",
                "canvas": {"kind": "assignment", "title": "Written HW", "submission_types": ["online_upload"], "html_url": "https://canvas.example/secret"},
            }
        ],
        {"DEV_USER_ROOT": str(tmp_path)},
    )
    assert reply == {"ok": True, "queued": True}
    files = list((tmp_path / "study" / "ask-inbox").glob("*.json"))
    assert len(files) == 1
    stored = json.loads(files[0].read_text(encoding="utf-8"))
    assert stored["content"] == "Find the derivative of x^2"
    assert stored["canvas"]["submission_types"] == ["online_upload"]
    assert "html_url" not in stored and "course_id" not in stored
    assert "https://" not in json.dumps(stored["canvas"])
    assert files[0].stat().st_mode & 0o777 == 0o600
    [empty] = _run([{"type": "queue_ask", "content": ""}], {"DEV_USER_ROOT": str(tmp_path)})
    assert empty["error"] == "empty_ask"


def test_unknown_and_malformed_messages_get_errors(tmp_path):
    unknown, notdict = _run([{"type": "submit_assignment"}, ["x"]], {"DEV_USER_ROOT": str(tmp_path)})
    assert unknown["error"] == "unknown_type"
    assert notdict["error"] == "invalid_message"
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_get_school_returns_only_an_https_canvas_origin(tmp_path):
    [missing] = _run([{"type": "get_school"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert missing == {"ok": False, "error": "no_school"}
    school = tmp_path / "school"
    school.mkdir()
    (school / "profile.json").write_text(json.dumps({"canvas_base_url": "https://canvas.example.edu", "display_name": "Example U"}), encoding="utf-8")
    [reply] = _run([{"type": "get_school"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert reply == {"ok": True, "canvas_base_url": "https://canvas.example.edu/", "name": "Example U"}
    (school / "profile.json").write_text(json.dumps({"canvas_base_url": "javascript:alert(1)"}), encoding="utf-8")
    [bad] = _run([{"type": "get_school"}], {"DEV_USER_ROOT": str(tmp_path)})
    assert bad["ok"] is False
