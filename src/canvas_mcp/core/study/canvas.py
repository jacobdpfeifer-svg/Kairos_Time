"""Canvas-derived study sources (Phase 3).

`browser/scripts/sync-study-sources.mjs` writes `inbox/study-sources/<course>.json`
and `status.json`. This module turns a selected subset into a packet
(`canvas-<course_id>`, provenance ``instructor``, scope ``instructor_permitted``),
preserving student-authored items across re-imports, and lets the student author
a checkable item on top of a source (key provenance ``student``).

Boundaries: only instructor-published pages/syllabus/assignment descriptions.
Quiz questions, submissions, grades and live assessments are never fetched.
Exam records inferred from titles carry ``provenance: canvas_inferred``.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .model import StudyError, iso, parse_instant, require_choice, require_id
from .packets import CHECKER_TYPES

STALE_AFTER_HOURS = 48


def sources_dir(user_root: Path) -> Path:
    return user_root / "inbox" / "study-sources"


def sync_status(user_root: Path, now: datetime) -> dict[str, Any]:
    path = sources_dir(user_root) / "status.json"
    if not path.exists():
        return {"state": "never", "line": "Canvas sources have not been synced yet.", "last_sync": None, "courses": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"state": "unreadable", "line": "The last sync record is unreadable; sync again.", "last_sync": None, "courses": []}
    finished = raw.get("finished_at")
    try:
        age_h = (now - parse_instant(finished, "finished_at")).total_seconds() / 3600 if finished else None
    except StudyError:
        age_h = None
    if raw.get("session") != "ok":
        state, line = "session_expired", "Canvas session expired or missing. Sign in again, then sync."
    elif not raw.get("ok"):
        state, line = "failed", f"Last sync failed: {'; '.join(raw.get('errors') or []) or 'unknown error'}"
    elif raw.get("partial"):
        state, line = "partial", "Last sync finished with some course errors; those sources may be incomplete."
    elif age_h is not None and age_h > STALE_AFTER_HOURS:
        state, line = "stale", f"Last sync was {int(age_h // 24)} day(s) ago; material may have changed."
    else:
        state, line = "ok", "Canvas sources are current."
    return {"state": state, "line": line, "last_sync": finished, "courses": raw.get("courses") or [], "errors": raw.get("errors") or []}


def list_course_records(user_root: Path) -> list[dict[str, Any]]:
    directory = sources_dir(user_root)
    rows: list[dict[str, Any]] = []
    if not directory.is_dir():
        return rows
    for path in sorted(directory.glob("*.json")):
        if path.name in {"status.json", "progress.json"}:
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("course"), dict):
            continue
        rows.append(raw)
    return rows


def course_record(user_root: Path, course_id: str) -> dict[str, Any]:
    for raw in list_course_records(user_root):
        if str(raw["course"].get("id")) == str(course_id):
            return raw
    raise StudyError("not_found", f"no synced Canvas record for course {course_id}; sync sources first")


def packet_id_for(course_id: str) -> str:
    return f"canvas-{course_id}"


def _exam_from_candidate(candidate: dict[str, Any], *, course_label: str, zone: str) -> dict[str, Any] | None:
    due = candidate.get("due_at") or candidate.get("ends_at") or candidate.get("starts_at")
    if not due:
        return None
    try:
        at = parse_instant(due, "due_at")
    except StudyError:
        return None
    return {
        "id": str(candidate["id"]),
        "course": course_label,
        "objective_scope": [],
        "value": "window" if candidate.get("starts_at") or candidate.get("ends_at") else "known_instant",
        "at": iso(at),
        "starts_at": candidate.get("starts_at") or "",
        "ends_at": candidate.get("ends_at") or due,
        "zone": zone,
        "source": str(candidate.get("source") or "canvas_due_at"),
        "confidence": str(candidate.get("confidence") or "low"),
        "provenance": "canvas_inferred",
        "label": str(candidate.get("label") or "Exam"),
    }


# Packet sources are capped (packets._str). A long syllabus keeps its opening
# text, labelled, instead of failing the whole course import (live run D5).
SOURCE_TEXT_MAX = 20000


def _source_text(s: dict[str, Any]) -> tuple[str, bool]:
    text = str(s.get("text") or "")
    if len(text) <= SOURCE_TEXT_MAX:
        return text, False
    return text[:SOURCE_TEXT_MAX].rstrip(), True


def build_canvas_packet(
    record: dict[str, Any],
    *,
    source_ids: list[str] | None,
    zone: str,
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    """A packet from a synced course record. ``previous`` (the current packet
    version) supplies the next version number and preserves student items
    whose sources are still present."""
    course = record["course"]
    label = str(course.get("label") or course.get("name") or packet_id_for(str(course["id"])))
    chosen = [s for s in record.get("sources") or [] if not source_ids or s["id"] in source_ids]
    if not chosen:
        raise StudyError("validation", "choose at least one synced source to import")
    sources = []
    for s in chosen:
        text, clipped = _source_text(s)
        locator = f"{s.get('title') or s['id']} (Canvas {s.get('kind', 'source')})"
        if clipped:
            locator += f" — first {SOURCE_TEXT_MAX:,} characters; open Canvas for the rest"
        sources.append(
            {
                "id": require_id(s["id"], "source id"),
                "locator": locator,
                "text": text,
                "permission_scope": "instructor_permitted",
                "ocr_status": "typed",
                "captured_at": str(record.get("fetched_at") or ""),
                "canvas_id": str(s.get("canvas_id") or ""),
            }
        )
    kept_ids = {s["id"] for s in sources}
    items: list[dict[str, Any]] = []
    objectives: list[dict[str, Any]] = []
    generated = [item for item in (record.get("generated_items") or []) if all(ref in {s["id"] for s in chosen} for ref in item.get("source_refs") or [])]
    if generated:
        objectives.append({"id": "objective-exam-review", "label": "Exam review material"})
        items.extend(generated)
    if previous:
        for item in previous.get("items") or []:
            if item.get("id") not in {row.get("id") for row in items} and all(ref in kept_ids for ref in item.get("source_refs") or []):
                items.append(item)
        objectives = [o for o in previous.get("objectives") or [] if any(i["objective_id"] == o["id"] for i in items)]
        if generated and not any(o["id"] == "objective-exam-review" for o in objectives):
            objectives.append({"id": "objective-exam-review", "label": "Exam review material"})
    exams = [e for e in (_exam_from_candidate(c, course_label=label, zone=zone) for c in record.get("exams") or []) if e]
    return {
        "packet_id": packet_id_for(str(course["id"])),
        "version": int((previous or {}).get("version") or 0) + 1,
        "title": f"{label} — Canvas material",
        "course": label,
        "provenance": "instructor",
        "zone": zone,
        "sources": sources,
        "objectives": objectives,
        "items": items,
        "exams": exams,
    }


def author_item(
    packet: dict[str, Any],
    *,
    source_id: str,
    objective_label: str,
    stem: str,
    checker_type: str,
    answer: str,
    explanation: str,
    support_quote: str,
    field_label: str = "Your answer",
    options: list[str] | None = None,
    hint: str = "",
) -> dict[str, Any]:
    """Return a new packet version with one student-authored item appended.

    The student is the key's author; the checker only accepts what they declare.
    ``support_quote`` must appear verbatim in the source so the key stays
    source-backed rather than remembered. Free-text items use checker ``none``
    and abstain at grading time."""
    require_choice(checker_type, CHECKER_TYPES, "checker_type")
    source = next((s for s in packet["sources"] if s["id"] == source_id), None)
    if source is None:
        raise StudyError("not_found", f"unknown source {source_id}")
    stem = stem.strip()
    if len(stem) < 8:
        raise StudyError("validation", "write a question of at least a few words")
    quote = support_quote.strip()
    if checker_type != "none":
        if not answer.strip():
            raise StudyError("validation", "a checkable item needs the expected answer")
        if not quote or quote not in source["text"]:
            raise StudyError("validation", "paste a short quote that appears verbatim in the source; it becomes the support reference")
    objective_id = "obj-" + _slug(objective_label)
    item_index = len(packet.get("items") or []) + 1
    item_id = f"{packet['packet_id']}-i{item_index}"
    checker: dict[str, Any]
    if checker_type == "none":
        checker = {"type": "none"}
    elif checker_type == "numeric":
        try:
            value = float(answer.strip().split()[0])
        except (ValueError, IndexError) as exc:
            raise StudyError("validation", "numeric answers need a leading number, e.g. 0.155 m") from exc
        checker = {"type": "numeric", "value": value, "tolerance_pct": 2}
    elif checker_type == "true_false":
        checker = {"type": "true_false", "accept": answer.strip().lower()}
    elif checker_type == "choice":
        checker = {"type": "choice", "accept": [answer.strip()]}
    else:
        checker = {"type": "expression", "accept": [answer.strip()]}
    fields = [{"id": "answer", "label": field_label, "kind": "choice" if checker_type in ("choice", "true_false") else "text", "options": options or (["true", "false"] if checker_type == "true_false" else []), "checker": checker}]
    key: dict[str, Any] = {"answer": answer.strip(), "explanation": explanation.strip(), "support_refs": [quote] if quote else [], "provenance": "student"}
    if quote and quote not in source["text"]:
        raise StudyError("validation", "support quote must appear verbatim in the source")
    new = json.loads(json.dumps(packet))
    new["version"] = int(packet["version"]) + 1
    if not any(o["id"] == objective_id for o in new["objectives"]):
        new["objectives"].append({"id": objective_id, "label": objective_label.strip() or "Untitled objective"})
    new["items"].append(
        {
            "id": item_id,
            "objective_id": objective_id,
            "source_refs": [source_id],
            "kind": "concept",
            "stem": stem,
            "neutral_locator": source["locator"],
            "fields": fields,
            "key": key,
            "feedback": {},
            "hint": hint.strip(),
            "modes": ["review", "practice"],
            "predicted_seconds": 150,
        }
    )
    for source_entry in new["sources"]:
        source_entry.pop("hash", None)
        source_entry.pop("stale", None)
    result: dict[str, Any] = new
    return result


def _slug(text: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "-" for ch in text.strip())[:40].strip("-")
    return out or "objective"


