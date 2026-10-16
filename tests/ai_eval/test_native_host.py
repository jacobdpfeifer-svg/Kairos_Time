"""Chrome native-messaging host under hostile extension input and corrupt state.

The host is one process per extension port; if it dies, the extension's
Canvas surfaces go blank until Chrome reconnects.
"""

from __future__ import annotations

import json
import struct

import pytest
from kairos_adapter import native_host


def fresh(root):
    d = root / "inbox" / "freshness"
    d.mkdir(parents=True, exist_ok=True)
    return d


CORRUPT_STATE = [
    ("events_non_dict_line", "events.jsonl", "123\n", {"type": "get_assignment_context", "course_id": "1", "assignment_id": "2", "title": "x"}),
    ("events_detail_string", "events.jsonl", json.dumps({"kind": "announcement", "detected_at": "2099-01-01T00:00:00Z", "detail": "oops", "title": "x"}) + "\n", {"type": "get_assignment_context", "course_id": "1", "assignment_id": "2", "title": "x"}),
    ("funnel_not_utf8", "funnel.json", b"\xff\xfe\x00garbage", {"type": "ping"}),
    ("dashboard_not_utf8", "dashboard.json", b"\xff\xfe", {"type": "get_dashboard"}),
]


@pytest.mark.parametrize("name,fname,content,msg", CORRUPT_STATE, ids=[c[0] for c in CORRUPT_STATE])
def test_host_survives_corrupt_state(avery, name, fname, content, msg) -> None:
    path = fresh(avery) / fname
    path.write_bytes(content if isinstance(content, bytes) else content.encode())
    rc, replies, err = native_host(avery, [msg, {"type": "get_dashboard"}])
    assert rc == 0 and len(replies) == 2, f"{name}: host died rc={rc}: {err.strip().splitlines()[-1:]}"


HOSTILE = [
    ("delta_items_not_dicts", {"type": "canvas_delta", "delta": {"v": 1, "ts": "2026-10-06T00:00:00Z", "stream": [1, "x", None]}}),
    ("suggestion_naive_and_aware", {"type": "queue_calendar_suggestion", "suggestion": {"key": "k", "title": "t", "start": "2026-10-06T10:00:00", "end": "2026-10-06T11:00:00+00:00"}}),
    ("ask_canvas_types_dicts", {"type": "queue_ask", "content": "x", "canvas": {"submission_types": [{"a": 1}]}}),
    ("not_a_dict", [1, 2, 3]),
    ("type_unhashable", {"type": ["canvas_delta"]}),
]


@pytest.mark.parametrize("name,msg", HOSTILE, ids=[h[0] for h in HOSTILE])
def test_host_rejects_hostile_messages_without_dying(avery, name, msg) -> None:
    rc, replies, err = native_host(avery, [msg, {"type": "get_dashboard"}])
    assert rc == 0 and len(replies) == 2, f"F6: {name} kills the host: {err.strip().splitlines()[-1:]}"


def test_host_caps_unbounded_queues(avery) -> None:
    msgs = [{"type": "queue_ask", "content": "x" * 7999} for _ in range(300)]
    msgs += [{"type": "canvas_focus", "url": "https://canvas.example.invalid/" + "a" * 900_000} for _ in range(3)]
    rc, replies, _ = native_host(avery, msgs, timeout=60)
    assert rc == 0
    asks = list((avery / "study" / "ask-inbox").glob("*.json"))
    sensor = avery / "sensors" / "chrome.jsonl"
    assert len(asks) <= 100, f"{len(asks)} ask files queued"
    assert not sensor.exists() or sensor.stat().st_size < 64_000, f"sensor log {sensor.stat().st_size} bytes"


def test_host_delta_backlog_is_capped(avery) -> None:
    msgs = [{"type": "canvas_delta", "delta": {"v": 1, "ts": "2026-10-06T00:00:00Z", "stream": []}} for _ in range(80)]
    rc, replies, _ = native_host(avery, msgs)
    assert rc == 0
    assert len(list((avery / "inbox" / "freshness" / "deltas").glob("*.json"))) <= 50


def test_oversize_frame_does_not_desync(avery) -> None:
    big = b"{" + b" " * 1_200_000 + b"}"
    ok = json.dumps({"type": "get_dashboard"}).encode()
    raw = struct.pack("<I", len(big)) + big + struct.pack("<I", len(ok)) + ok
    rc, replies, _ = native_host(avery, [], raw=raw)
    assert [r.get("error") for r in replies] == ["message_too_large", "no_dashboard"]
