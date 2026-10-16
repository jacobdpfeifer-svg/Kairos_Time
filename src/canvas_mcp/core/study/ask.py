"""Context-aware Ask sessions.

StudyService is the only writer. Records live under ``{user_root}/study/asks``
and are not a second event log. The relay, when connected, writes prose inside
a plan this module already decided. Live assessments and external tools are
blocked locally. Course academic policy is not consulted before an answer,
walkthrough, mastery diagnosis, or draft.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import canvas, checkers, library
from .model import StudyError, iso, require_choice, require_id, write_private_text
from .packets import find_item
from .store import study_dir

SCHEMA = 1
CONTENT_KINDS = ("text", "image", "audio", "selection", "source_ref", "mixed")
SESSION_GOALS = ("answer_now", "walkthrough", "mastery", "make_handle", "unknown")
JOBS = (
    "unblock",
    "explain",
    "solve",
    "verify",
    "choose_method",
    "recall",
    "plan",
    "synthesize",
    "capture",
    "navigate",
    "make_handle",
)
BOUNDARIES = ("open_practice", "open_homework", "live_assessment", "administration", "external_tool")
STATUSES = ("pending", "classified", "planned", "answered", "blocked", "failed")
MODES = ("answer_now", "walkthrough", "mastery", "make_handle")
RELAY_PURPOSES = {"answer_now": "generate", "walkthrough": "hint", "mastery": "repair", "make_handle": "generate", "verify": "feedback"}
MEANINGFUL_POINTS = 10
_SUPPORTED_CHECKERS = {"numeric", "expression", "choice", "true_false"}

_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_POWER_RE = re.compile(
    r"(?:d\s*/\s*dx|derivative\s+of|differentiate)\s+\(?\s*([+-]?\d*\s*)?x\s*(?:\^|\*\*)\s*(\d+)\s*\)?",
    re.IGNORECASE,
)
_ASSESS = r"(?:quiz|exam|test|midterm|final)"
_LIVE_WORDS_RE = re.compile(
    r"\b(?:proctored|honorlock|lockdown browser|respondus|during the exam|on the quiz right now)\b"
    # "taking the quiz right now", "in my exam rn"
    rf"|\b(?:taking|doing|in|on|during)\s+(?:the|my|a|an|this)\s+{_ASSESS}\b[^.?!]{{0,40}}\b(?:right now|rn|now)\b"
    # "the midterm is live", "my exam is open in another tab" (not "open book" / "open-note")
    rf"|\b{_ASSESS}\s+is\s+(?:live|open(?![- ]?(?:book|note)))\b"
    # "mid-quiz", "mid exam"
    rf"|\bmid[- ]?{_ASSESS}\b"
    # "10 minutes left", "time left on the quiz"
    rf"|\b{_ASSESS}\b[^.?!]{{0,60}}\b\d+\s*(?:min|mins|minutes|sec|seconds)\s+left\b"
    rf"|\btime left (?:on|in) (?:the|my|this) {_ASSESS}\b",
    re.IGNORECASE,
)
_EXTERNAL_RE = re.compile(r"\b(webassign|zybooks|playposit|external tool|lti)\b", re.IGNORECASE)
_ONE_NUMBER_RE = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def asks_dir(user_root: Path) -> Path:
    return study_dir(user_root) / "asks"


def inbox_dir(user_root: Path) -> Path:
    return study_dir(user_root) / "ask-inbox"


def _ask_path(user_root: Path, input_id: str) -> Path:
    return asks_dir(user_root) / f"{require_id(input_id, 'input_id')}.json"


def _current_path(user_root: Path) -> Path:
    return study_dir(user_root) / "ask-current.json"


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    write_private_text(path, json.dumps(payload, ensure_ascii=False, indent=2))


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def load_ask(user_root: Path, input_id: str) -> dict[str, Any]:
    path = _ask_path(user_root, input_id)
    raw = _read_json(path)
    if raw is None:
        raise StudyError("not_found", f"unknown ask {input_id}")
    schema = int(raw.get("schema") or SCHEMA)
    if schema != SCHEMA:
        raise StudyError("validation", f"ask schema {schema} is not supported")
    return raw


def _save_ask(user_root: Path, record: dict[str, Any]) -> None:
    record["schema"] = SCHEMA
    _atomic_write(_ask_path(user_root, str(record["input_id"])), record)
    _atomic_write(_current_path(user_root), {"input_id": record["input_id"]})


def current_id(user_root: Path) -> str | None:
    raw = _read_json(_current_path(user_root))
    if not raw or not raw.get("input_id"):
        return None
    try:
        return require_id(str(raw["input_id"]), "input_id")
    except StudyError:
        return None


def scrub(text: str, banned: list[str]) -> str:
    cleaned = _URL_RE.sub("[link]", text or "")
    for token in banned:
        if token and len(token) >= 3:
            cleaned = cleaned.replace(token, "[id]")
    return cleaned


def _canvas_meta(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    types = raw.get("submission_types") or []
    if not isinstance(types, list):
        types = []
    points = raw.get("points") if raw.get("points") is not None else raw.get("points_possible")
    try:
        points_n = float(points) if points is not None and points != "" else 0.0
    except (TypeError, ValueError):
        points_n = 0.0
    return {
        "kind": str(raw.get("kind") or raw.get("type") or "")[:64],
        "submission_types": [str(t)[:64] for t in types[:8]],
        "title": str(raw.get("title") or "")[:300],
        "due_at": str(raw.get("due_at") or "")[:64],
        "points": points_n,
        "lti": bool(raw.get("lti")),
        "proctored": bool(raw.get("proctored")),
        "course_label": str(raw.get("course_label") or "")[:200],
    }


def _str_field(params: dict[str, Any], key: str, limit: int) -> str:
    value = params.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise StudyError("validation", f"{key} must be a string")
    return value.strip()[:limit]


def classify(text: str, *, canvas_meta: dict[str, Any] | None = None, goal: str = "unknown") -> dict[str, Any]:
    """Deterministic job and boundary. Title words alone do not make a live quiz."""
    blob = text or ""
    lower = blob.lower()
    meta = canvas_meta or {}
    kind = str(meta.get("kind") or "").lower()
    types = [str(t).lower() for t in meta.get("submission_types") or []]
    signals: list[str] = []

    boundary = "open_practice"
    if kind in {"quiz", "online_quiz"} or "online_quiz" in types or meta.get("proctored"):
        boundary = "live_assessment"
        signals.append("canvas_type")
    elif kind == "external_tool" or "external_tool" in types or meta.get("lti"):
        boundary = "external_tool"
        signals.append("external_tool")
    elif _LIVE_WORDS_RE.search(blob):
        boundary = "live_assessment"
        signals.append("student_wording")
    elif _EXTERNAL_RE.search(blob) and any(token in lower for token in ("answer", "solve", "do this", "submit")):
        boundary = "external_tool"
        signals.append("student_wording")
    elif any(token in lower for token in ("administrative", "fill out", "attendance", "upload the form", "checklist")):
        boundary = "administration"
        signals.append("student_wording")
    elif kind in {"assignment", "online_upload", "discussion", "discussion_topic"}:
        boundary = "open_homework"
        signals.append("canvas_assignment")
    elif any(token in lower for token in ("homework", "my hw", "assignment", "submit this")):
        boundary = "open_homework"
        signals.append("student_wording")

    if "quiz me" in lower or "test me" in lower or lower.startswith("quiz me"):
        job = "recall"
        signals.append("recall_request")
    elif any(token in lower for token in ("is this right", "check my", "did i", "verify")):
        job = "verify"
    elif any(token in lower for token in ("which formula", "which method", "which rule")):
        job = "choose_method"
    elif any(token in lower for token in ("where do i click", "how do i open", "how do i submit", "navigate")):
        job = "navigate"
    elif any(token in lower for token in ("draft", "slide", "summarize", "summary", "reading brief", "outline")):
        job = "make_handle"
    elif any(token in lower for token in ("what should i do", "plan my", "next step")):
        job = "plan"
    elif any(token in lower for token in ("connect the lecture", "synthesize")):
        job = "synthesize"
    elif any(token in lower for token in ("save this", "capture", "notes from")):
        job = "capture"
    elif any(token in lower for token in ("what does", "explain", "why does")):
        job = "explain"
    elif any(token in lower for token in ("stuck", "unblock", "i don't know where to start")):
        job = "unblock"
    elif any(token in lower for token in ("solve", "derivative", "answer", "calculate", "find the")):
        job = "solve"
    elif boundary == "administration":
        job = "make_handle"
    else:
        job = "explain"
    signals.append(f"job:{job}")

    if boundary == "live_assessment" and "canvas_type" not in signals and "student_wording" not in signals:
        signals.append("title_ignored")

    confidence = "high" if "canvas_type" in signals or "external_tool" in signals else "medium" if signals else "low"
    blocked = None
    if boundary == "live_assessment":
        blocked = "live_assessment"
    elif boundary == "external_tool" and job in {"solve", "verify", "unblock", "make_handle"}:
        blocked = "external_tool"
    return {
        "job": job,
        "boundary": boundary,
        "confidence": confidence,
        "signals": signals,
        "student_override_allowed": True,
        "blocked_reason": blocked,
        "session_goal": goal,
    }


def _apply_overrides(classification: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    updated = dict(classification)
    signals = list(updated.get("signals") or [])
    if overrides.get("job"):
        updated["job"] = require_choice(overrides["job"], JOBS, "job")
        signals.append("student_override_job")
    if overrides.get("boundary"):
        requested = require_choice(overrides["boundary"], BOUNDARIES, "boundary")
        original = str(classification.get("boundary") or "open_practice")
        # A student may make an ambiguous item more restrictive, but may not
        # downgrade a Canvas/external assessment after local evidence marked it
        # unsafe. Otherwise a quiz -> open_homework override becomes an answer
        # bypass. This is a safety invariant, not a preference.
        unsafe = {"live_assessment", "external_tool"}
        if original in unsafe and requested not in unsafe:
            signals.append("student_override_boundary_rejected")
            updated["blocked_reason"] = classification.get("blocked_reason") or original
        else:
            updated["boundary"] = requested
            signals.append("student_override_boundary")
        if updated["boundary"] == "live_assessment":
            updated["blocked_reason"] = "live_assessment"
        elif updated["boundary"] == "external_tool" and updated["job"] in {"solve", "verify", "unblock", "make_handle"}:
            updated["blocked_reason"] = "external_tool"
        elif not (original in unsafe and requested not in unsafe):
            updated["blocked_reason"] = None
    updated["signals"] = signals
    updated["confidence"] = "high"
    return updated


def _goal_for(classification: dict[str, Any], requested: str) -> str:
    if requested in MODES:
        return requested
    job = classification["job"]
    if job in {"solve", "unblock", "verify"}:
        return "answer_now"
    if job in {"make_handle", "plan", "synthesize", "capture"}:
        return "make_handle"
    if job == "recall":
        return "mastery"
    return "walkthrough"


def _records(user_root: Path) -> list[dict[str, Any]]:
    try:
        return canvas.list_course_records(user_root)
    except StudyError:
        return []


def _course_blob(record: dict[str, Any]) -> str:
    course = record.get("course") or {}
    return " ".join(str(course.get(key) or "") for key in ("label", "name", "code")).lower()


def _match_courses(records: list[dict[str, Any]], hint: str, text: str) -> list[dict[str, Any]]:
    needle = (hint or "").strip().lower()
    if needle:
        matched = [r for r in records if needle in _course_blob(r)]
        if matched:
            return matched
    codes = []
    for record in records:
        code = str((record.get("course") or {}).get("code") or "").strip()
        if code and code.lower() in text.lower():
            codes.append(record)
    return codes


def _freshness(user_root: Path, now: datetime) -> str:
    try:
        return str(canvas.sync_status(user_root, now).get("state") or "unknown")
    except StudyError:
        return "unknown"


def _item(
    *,
    source_kind: str,
    locator: str,
    local_reference: str,
    at: str,
    freshness: str,
    confidence: str,
    reason: str,
    truth_kind: str,
    text: str,
) -> dict[str, Any]:
    return {
        "source_kind": source_kind,
        "locator": locator[:200],
        "local_reference": local_reference[:300],
        "created_or_fetched_at": at,
        "freshness_status": freshness,
        "confidence": confidence,
        "inclusion_reason": reason,
        "truth_kind": truth_kind,
        "text": text[:4000],
    }


def _library_items(service: Any, text: str, course_id: str | None) -> list[dict[str, Any]]:
    """Passages from files the student added (inbox/library), best match first."""
    try:
        hits = library.search(service.user_root, text, course_id=course_id, limit=2)
    except (OSError, ValueError):
        return []
    return [
        _item(
            source_kind="student_file",
            locator=f"Your file: {hit['entry']['name']}",
            local_reference=f"inbox/library/text/{hit['entry']['id']}.txt",
            at=str(hit["entry"].get("added_at") or ""),
            freshness="current",
            confidence="high" if course_id and hit["entry"].get("course_id") == course_id else "medium",
            reason="A file you added to Kairos that matches this question",
            truth_kind="student_file",
            text=hit["text"],
        )
        for hit in hits
    ]


def select_context(service: Any, record: dict[str, Any]) -> dict[str, Any]:
    text = str(record.get("content") or "")
    overrides = record.get("overrides") or {}
    if "course" in overrides:
        hint = str(overrides.get("course") or "")
    else:
        hint = str(record.get("course_hint") or "")
    if "assignment" in overrides:
        assignment_hint = str(overrides.get("assignment") or "")
    else:
        assignment_hint = str(record.get("assignment_hint") or "")
    records = _records(service.user_root)
    matched = _match_courses(records, hint, text)
    strong = len(matched) == 1
    chosen = matched[0] if strong else None
    freshness = _freshness(service.user_root, service.now)
    fetched = iso(service.now)
    items: list[dict[str, Any]] = [
        _item(
            source_kind="student_input",
            locator="Your question",
            local_reference=f"study/asks/{record['input_id']}.json",
            at=str(record.get("created_at") or fetched),
            freshness="current",
            confidence="high",
            reason="The question the student supplied",
            truth_kind="student",
            text=text or str(record.get("local_reference") or ""),
        )
    ]
    course_label = ""
    assignment_label = ""
    due = ""
    conflicts: list[dict[str, Any]] = []
    banned = [str((r.get("course") or {}).get("id") or "") for r in records]
    if chosen:
        course = chosen.get("course") or {}
        course_label = str(overrides.get("course") or course.get("label") or course.get("code") or "")
        fetched = str(chosen.get("fetched_at") or fetched)
        sources = list(chosen.get("sources") or [])
        assignment = None
        if assignment_hint:
            assignment = next((s for s in sources if assignment_hint.lower() in str(s.get("title") or "").lower()), None)
        if assignment is None:
            assignment = next((s for s in sources if str(s.get("title") or "").lower() in text.lower() and len(str(s.get("title") or "")) > 3), None)
        if assignment is not None:
            assignment_label = str(assignment.get("title") or "")
            items.append(
                _item(
                    source_kind=str(assignment.get("kind") or "assignment"),
                    locator=assignment_label or "Assignment",
                    local_reference=f"inbox/study-sources/{course.get('code') or 'course'}.json",
                    at=str(assignment.get("updated_at") or fetched),
                    freshness=freshness,
                    confidence="high",
                    reason="Matching assignment or page",
                    truth_kind="canvas",
                    text=str(assignment.get("text") or ""),
                )
            )
        items.extend(_library_items(service, text, str(course.get("id") or "") or None))
        for source in sources:
            if assignment is not None and source.get("id") == assignment.get("id"):
                continue
            if str(source.get("kind") or "") not in {"syllabus", "page"}:
                continue
            items.append(
                _item(
                    source_kind=str(source.get("kind") or "page"),
                    locator=str(source.get("title") or "Course material"),
                    local_reference=f"inbox/study-sources/{course.get('code') or 'course'}.json",
                    at=str(source.get("updated_at") or fetched),
                    freshness=freshness,
                    confidence="medium",
                    reason="Course or instructor material",
                    truth_kind="canvas",
                    text=str(source.get("text") or ""),
                )
            )
            if len([i for i in items if i["truth_kind"] == "canvas"]) >= 3:
                break
        for exam in chosen.get("exams") or []:
            label = str(exam.get("label") or "")
            if assignment_label and label.lower() == assignment_label.lower():
                due = str(exam.get("due_at") or "")
                break
        if not due:
            meta_due = str((record.get("canvas") or {}).get("due_at") or "")
            due = meta_due
        canvas_due = due
        if "due" in overrides:
            student_due = str(overrides.get("due") or "")
            if student_due and canvas_due and student_due != canvas_due:
                conflicts.append({"field": "due", "canvas": canvas_due, "note": student_due})
            due = student_due
        else:
            note_due = str(record.get("note_due") or "")
            if note_due and canvas_due and note_due != canvas_due:
                conflicts.append({"field": "due", "canvas": canvas_due, "note": note_due})
                due = ""
        for token in (str(course.get("id") or ""), str((assignment or {}).get("canvas_id") or "")):
            if token:
                banned.append(token)
    else:
        items.extend(_library_items(service, text, None))
    if record.get("student_attempt"):
        items.append(
            _item(
                source_kind="attempt",
                locator="Your attempt",
                local_reference=f"study/asks/{record['input_id']}.json",
                at=fetched,
                freshness="current",
                confidence="high",
                reason="The student's prior attempt",
                truth_kind="student",
                text=str(record["student_attempt"]),
            )
        )
    elif chosen and course_label:
        prior = _prior_attempt(service, course_label)
        if prior:
            items.append(
                _item(
                    source_kind="attempt",
                    locator="Earlier attempt",
                    local_reference="study/events.jsonl",
                    at=fetched,
                    freshness="current",
                    confidence="medium",
                    reason="A related correction or attempt in this course",
                    truth_kind="student",
                    text=prior,
                )
            )
    canvas_items = [i for i in items if i["truth_kind"] == "canvas"]
    file_items = [i for i in items if i["truth_kind"] == "student_file"]
    if canvas_items:
        items.append(
            _item(
                source_kind="adjacent",
                locator=canvas_items[0]["locator"],
                local_reference=canvas_items[0]["local_reference"],
                at=canvas_items[0]["created_or_fetched_at"],
                freshness=freshness,
                confidence="low",
                reason="Adjacent course material already selected",
                truth_kind="canvas",
                text=canvas_items[0]["text"][:400],
            )
        )
    elif not file_items:
        # The student's own file counts as course evidence; general knowledge is the last resort.
        items.append(
            _item(
                source_kind="general",
                locator="General knowledge",
                local_reference="",
                at=fetched,
                freshness="n/a",
                confidence="low",
                reason="No course source matched",
                truth_kind="general",
                text="General explanation is used only because no course evidence matched this question.",
            )
        )
    chip_parts = []
    if course_label:
        chip_parts.append(course_label)
    if assignment_label:
        chip_parts.append(assignment_label)
    boundary = str((record.get("classification") or {}).get("boundary") or "")
    if boundary:
        chip_parts.append(boundary.replace("_", " "))
    if due:
        chip_parts.append(f"due {due}")
    return {
        "items": items,
        "conflicts": conflicts,
        "chip": " · ".join(chip_parts),
        "course_label": course_label,
        "assignment_label": assignment_label,
        "due": due,
        "banned": [t for t in banned if t],
    }


def _prior_attempt(service: Any, course_label: str) -> str:
    newest: tuple[datetime, str] | None = None
    needle = course_label.lower()
    for attempt in service.projection.attempts.values():
        text = attempt.response or attempt.draft
        if not text:
            continue
        found = find_item(service.packets, attempt.item_id)
        if found is None:
            continue
        packet, _item_row = found
        if needle not in str(packet.get("course") or "").lower():
            continue
        moment = attempt.submitted_at or attempt.started_at
        if newest is None or moment > newest[0]:
            newest = (moment, text)
    return newest[1] if newest else ""


def _power(text: str) -> tuple[str, str] | None:
    match = _POWER_RE.search(text or "")
    if not match:
        return None
    coeff_raw = (match.group(1) or "").replace(" ", "")
    coeff = int(coeff_raw) if coeff_raw not in {"", "+", "-"} else ( -1 if coeff_raw == "-" else 1)
    power = int(match.group(2))
    if power == 0:
        expected = "0"
        spoken = f"The derivative of x^{power} is 0."
    else:
        factor = coeff * power
        nxt = power - 1
        expected = f"{factor}x^{nxt}" if nxt != 1 else f"{factor}x"
        spoken = f"The derivative is {expected}."
    return expected, spoken


def _supported_checker(record: dict[str, Any], text: str) -> dict[str, Any] | None:
    """Power-rule work is an expression checker. Other supported kinds come from the record."""
    power = _power(text)
    if power:
        return {"type": "expression", "accept": [power[0]]}
    spec = record.get("checker")
    if isinstance(spec, dict) and str(spec.get("type") or "") in _SUPPORTED_CHECKERS:
        return spec
    return None


def _line_body(line: str) -> str:
    return line.split(":", 1)[-1].strip() if ":" in line else line


def _attempt_lines(attempt: str) -> list[str]:
    lines = [line.strip() for line in (attempt or "").splitlines() if line.strip()]
    if lines:
        return lines
    return [attempt.strip()] if attempt and attempt.strip() else []


def _checkable_line(spec: dict[str, Any], line: str) -> bool:
    body = _line_body(line)
    kind = str(spec.get("type") or "")
    if kind == "expression":
        normalized = checkers.normalize_expression(body)
        return bool(re.fullmatch(r"[+\-]?\d*x?(?:\^\d+)?|[+\-]?\d+(?:\.\d+)?", normalized))
    if kind == "numeric":
        stripped = re.sub(r"^\s*[a-z]\s*[=≈~]\s*", "", body.strip(), flags=re.IGNORECASE)
        return len(_ONE_NUMBER_RE.findall(stripped)) == 1
    if kind in {"choice", "true_false"}:
        return 0 < len(body) <= 40
    return False


def _verify_attempt(attempt: str, spec: dict[str, Any]) -> tuple[str, str | None]:
    """Return (mismatch|match|abstain, first failing line). Uses checkers.check_field."""
    saw = False
    for line in _attempt_lines(attempt):
        if not _checkable_line(spec, line):
            continue
        body = _line_body(line)
        scored, passed, _note = checkers.check_field(spec, body)
        if not scored:
            continue
        saw = True
        if not passed:
            return "mismatch", line
    if not saw:
        return "abstain", None
    return "match", None


def _checker_label(spec: dict[str, Any]) -> str:
    if spec.get("type") == "numeric":
        return str(spec.get("value") or "")
    accept = spec.get("accept") or []
    if isinstance(accept, list) and accept:
        return str(accept[0])
    if isinstance(accept, str):
        return accept
    return ""


def _reading_brief(text: str) -> tuple[str, str]:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if len(s.strip()) > 20]
    summary = " ".join(sentences[:2]) or text[:280]
    sentence = f"Brief: {summary[:240]}"
    questions = "Discuss: What is the main claim, and what should you say in class?"
    return sentence, f"{summary[:500]}\n\n{questions}"


def _checklist(text: str) -> tuple[str, str]:
    parts = [p.strip(" -*") for p in re.split(r"[\n•]+|(?<=[.])\s+", text) if len(p.strip()) > 8]
    steps = parts[:6] or ["Read the instructions", "Prepare the file", "Submit it yourself in Canvas"]
    numbered = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    return f"Next: {steps[0]}", numbered


def _draft(text: str) -> tuple[str, str]:
    topic = text.strip()[:180]
    sentence = "Draft scaffold is ready for you to revise before you submit it yourself."
    body = (
        f"1. Opening claim about: {topic}\n"
        "2. Two pieces of evidence from the assignment or reading.\n"
        "3. The point you want the reader to remember.\n"
        "4. What you will upload or turn in yourself."
    )
    return sentence, body


def _slides(text: str) -> tuple[str, str]:
    sentence = "Slide outline is ready to copy. Nothing was rendered as a deck."
    body = (
        f"1. Title — {text.strip()[:80]}\n"
        "2. The question this deck answers.\n"
        "3. Three points, one per slide.\n"
        "4. Source list and what you will say out loud."
    )
    return sentence, body


def build_plan(record: dict[str, Any], classification: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    goal = _goal_for(classification, str(record.get("session_goal") or "unknown"))
    boundary = classification["boundary"]
    job = classification["job"]
    blocked = None
    # Every mode: a live item's text never reaches the relay (AI-eval F4). Walkthrough
    # and mastery still get the local parallel-problem guidance from compose_response.
    if boundary == "live_assessment":
        blocked = "live_assessment"
    elif boundary == "external_tool" and goal == "answer_now":
        blocked = "external_tool"
    elif boundary == "external_tool" and job in {"solve", "verify"} and goal != "walkthrough":
        blocked = "external_tool"
    if record.get("content_kind") == "audio":
        blocked = "audio_not_in_slice"
    missing_visual = record.get("content_kind") == "image" and not _has_visual(str(record.get("content") or ""))
    if missing_visual:
        blocked = blocked or "missing_visual"
    purpose = None if blocked else RELAY_PURPOSES.get("verify" if job == "verify" and goal == "answer_now" else goal)
    checker = _supported_checker(record, str(record.get("content") or ""))
    return {
        "question_type": job,
        "context_chip": context.get("chip") or "",
        "boundary": boundary,
        "selected_sources": [
            {k: item[k] for k in ("source_kind", "locator", "local_reference", "created_or_fetched_at", "freshness_status", "confidence", "inclusion_reason", "truth_kind")}
            for item in context.get("items") or []
        ],
        "response_mode": goal,
        "verification_plan": "checker" if checker else "abstain",
        "allowed_actions": ["switch_mode", "correct_chip"] + ([] if blocked else ["use_result"]),
        "next_action_candidates": [_next_action(goal, blocked, "")],
        "relay_purpose": purpose,
        "blocked_reason": blocked,
        "conflicts": context.get("conflicts") or [],
    }


def _has_visual(text: str) -> bool:
    return bool(re.search(r"[0-9=^]|derivative|diagram|axis|table", text or "", re.IGNORECASE)) and len(text.strip()) > 8


def compose_response(record: dict[str, Any], classification: dict[str, Any], context: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    goal = str(plan["response_mode"])
    text = str(record.get("content") or "")
    attempt = str(record.get("student_attempt") or "")
    power = _power(text)
    blocked = plan.get("blocked_reason")
    check_status = "abstained"
    assumptions = "Course evidence is labeled in the context chip. General knowledge is used only when no course source matched."
    explanation = ""
    sentence = ""

    if blocked == "audio_not_in_slice":
        sentence = "Recording is not part of this slice."
        explanation = "Audio can be stored as a kind, and a later pass will turn it into notes."
        check_status = "blocked"
    elif blocked == "missing_visual":
        sentence = "This image has no readable equation, diagram, axis, or table. Crop tighter or type the problem."
        explanation = "Nothing was guessed from the missing picture."
        check_status = "blocked"
    elif blocked == "live_assessment":
        sentence = "This is a live assessment, so the item itself stays unanswered. Use a parallel problem on the same method."
        explanation = "The parallel problem changes the numbers. The live item is not solved."
        check_status = "blocked"
    elif blocked == "external_tool":
        sentence = "Open the external tool and work the item there. I can coach the steps, not answer it inside the tool."
        explanation = "You operate WebAssign, ZyBooks, and other external tools yourself."
        check_status = "blocked"
    elif goal == "mastery":
        skill = "the power rule" if power else "the first step of this problem"
        sentence = f"The first missing prerequisite is recognizing {skill}. Next rung: one worked example, then you try a new number."
        explanation = "This is a diagnosis, not a mastery certificate. Durable learning is not claimed."
        check_status = "abstained"
    elif goal == "walkthrough":
        if classification["boundary"] == "live_assessment":
            sentence = "Walk the method on a parallel problem. The live item stays unanswered."
            explanation = "Same method, different numbers. The live result is not stated."
            check_status = "blocked"
        elif power:
            sentence = "Use the power rule: bring the exponent down in front, then subtract one from the exponent."
            explanation = f"That method fits this derivative. {power[1]} The result comes after the method, so you can see why it applies."
            check_status = "checked"
        else:
            sentence = "Start from the method this course uses, then apply it to your numbers."
            explanation = "Prose was not generated. The local plan is a short method explanation, not a generic lecture."
            check_status = "abstained"
    elif goal == "make_handle":
        if "slide" in text.lower():
            sentence, explanation = _slides(text)
        elif any(token in text.lower() for token in ("summarize", "reading", "brief")):
            sentence, explanation = _reading_brief(text)
        elif classification["boundary"] == "administration" or any(token in text.lower() for token in ("administrative", "checklist", "fill out", "upload the form")):
            sentence, explanation = _checklist(text)
        else:
            sentence, explanation = _draft(text)
        check_status = "abstained"
        assumptions = "This is a private draft or checklist. You still submit anything Canvas-visible yourself."
    else:
        spec = _supported_checker(record, text)
        if classification["job"] == "verify":
            if spec and attempt:
                outcome, line = _verify_attempt(attempt, spec)
                if outcome == "mismatch" and line:
                    sentence = f"First mismatch: {line}. The rest of your work was not rewritten."
                    explanation = f"That line does not match the checked result ({_checker_label(spec)})."
                    check_status = "checked"
                elif outcome == "match":
                    sentence = "The attempt matches the checked result."
                    explanation = power[1] if power else "The deterministic checker accepted the attempt."
                    check_status = "checked"
                else:
                    sentence = "There is no independent check for this attempt."
                    explanation = "The checker abstained. A fluent explanation would not make it verified."
                    check_status = "abstained"
            else:
                sentence = "There is no independent check for this attempt."
                explanation = "The checker abstained. A fluent explanation would not make it verified."
                check_status = "abstained"
        elif power:
            sentence = power[1]
            explanation = "Checked with the power rule. Assumptions: x is the variable and the exponent is a constant."
            check_status = "checked"
        else:
            sentence = "Prose was not generated. The local plan is to answer this directly from the selected sources."
            explanation = "Connect the relay when you want the model to write the sentences inside this plan."
            check_status = "abstained"

    if context.get("conflicts"):
        assumptions += " Due dates disagree; they are listed and not merged."
    candidates = list(plan.get("next_action_candidates") or [])
    action = dict(candidates[0]) if candidates else _next_action(goal, blocked, sentence)
    action["why_now"] = sentence[:180]
    return {
        "question_type": classification["job"],
        "context_chip": context.get("chip") or "",
        "one_sentence": sentence,
        "explanation": explanation,
        "assumptions": assumptions,
        "check_status": check_status,
        "next_action": action,
        "modes": list(MODES),
        "prose": "not_generated",
        "response_mode": goal,
    }


def _next_action(goal: str, blocked: str | None, sentence: str) -> dict[str, Any]:
    if blocked in {"live_assessment", "external_tool"}:
        title = "Work a parallel example or open the tool yourself"
    elif blocked == "missing_visual":
        title = "Type the problem or send a tighter crop"
    elif blocked == "audio_not_in_slice":
        title = "Paste the question instead of a recording"
    elif goal == "mastery":
        title = "Try the next rung without notes"
    elif goal == "make_handle":
        title = "Revise the draft, then submit it yourself if Canvas needs a file"
    else:
        title = "Use this result on the problem in front of you"
    return {
        "title": title,
        "why_now": sentence[:180],
        "value": "One next step from this question",
        "urgency": "now",
        "consequence": "",
        "estimated_effort": "a few minutes",
        "dependencies": [],
        "risk": "low",
        "can_prepare_privately": True,
        "student_confirmation_needed": blocked in {"live_assessment", "external_tool"},
        "source_refs": ["ask"],
    }


def relay_payload(record: dict[str, Any], context: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any] | None:
    purpose = plan.get("relay_purpose")
    if not purpose:
        return None
    banned = list(context.get("banned") or [])
    passages: list[dict[str, str]] = []
    for item in context.get("items") or []:
        # "adjacent" repeats a passage already sent; "general" carries no source.
        if item.get("truth_kind") == "general" or item.get("source_kind") == "adjacent":
            continue
        if len(passages) >= 6:
            break
        passages.append({"locator": scrub(str(item.get("locator") or "source"), banned)[:200], "text": scrub(str(item.get("text") or ""), banned)[:6000]})
    payload = {
        "session_budget_id": str(record.get("input_id")),
        "purpose": purpose,
        "source_passages": passages,
        "stem": scrub(str(record.get("content") or ""), banned)[:4000],
        "rubric": f"mode={plan['response_mode']}; job={plan['question_type']}; write only the prose inside the local plan",
        "submitted_answer": scrub(str(record.get("student_attempt") or ""), banned)[:8000],
        "schema_version": 1,
        "pricing_version": "2026-09-18",
    }
    # The relay replays a repeated request_id, so the id must change whenever
    # what the model would see changes (a corrected course, new passages) —
    # otherwise the student gets the answer for the old context (finding F5).
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return {"request_id": f"ask:{record['input_id']}:{plan['response_mode']}:{digest}", **payload}


def _maybe_relay(service: Any, record: dict[str, Any], context: dict[str, Any], plan: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    # `relay` tells the UI why the answer is local-only: not_needed, not_connected, unavailable or used.
    payload = relay_payload(record, context, plan)
    if payload is None:
        return {**response, "relay": "not_needed"}
    from . import ai

    if ai.load_relay(service.user_root) is None:
        return {**response, "relay": "not_connected"}
    try:
        result = ai.dispatch(service.user_root, payload)
    except StudyError:
        return {**response, "relay": "unavailable"}
    proposal = result.get("assessment_proposal") if isinstance(result, dict) else None
    if isinstance(proposal, dict) and proposal.get("feedback"):
        response = dict(response)
        response["explanation"] = str(proposal.get("feedback"))[:2000]
        response["prose"] = "relay"
        response["relay"] = "used"
        response["check_status"] = response["check_status"] if response["check_status"] == "checked" else "abstained"
        return response
    return {**response, "relay": "unavailable"}


def _recompute(service: Any, record: dict[str, Any]) -> dict[str, Any]:
    if record.get("content_kind") == "audio":
        classification = classify(str(record.get("content") or ""), canvas_meta=record.get("canvas") or {}, goal="unknown")
        classification["blocked_reason"] = "audio_not_in_slice"
    else:
        classification = classify(
            str(record.get("content") or ""),
            canvas_meta=record.get("canvas") or {},
            goal=str(record.get("session_goal") or "unknown"),
        )
    classification = _apply_overrides(classification, record.get("overrides") or {})
    record["classification"] = classification
    record["status"] = "classified"
    context = select_context(service, record)
    record["context"] = {k: context[k] for k in ("items", "conflicts", "chip", "course_label", "assignment_label", "due")}
    plan = build_plan(record, classification, context)
    record["plan"] = plan
    record["status"] = "planned"
    response = compose_response(record, classification, context, plan)
    response = _maybe_relay(service, record, context, plan, response)
    record["response"] = response
    record["status"] = "blocked" if plan.get("blocked_reason") else "answered"
    _save_ask(service.user_root, record)
    return envelope(record)


def envelope(record: dict[str, Any]) -> dict[str, Any]:
    response = record.get("response") or {}
    action = response.get("next_action") or {}
    return {
        "ok": True,
        "input_id": record["input_id"],
        "status": record.get("status"),
        "ask": {
            "input_id": record["input_id"],
            "content_kind": record.get("content_kind"),
            "content": record.get("content") or "",
            "local_reference": record.get("local_reference") or "",
            "course_hint": record.get("course_hint") or "",
            "assignment_hint": record.get("assignment_hint") or "",
            "source_refs": record.get("source_refs") or [],
            "session_goal": record.get("session_goal") or "unknown",
            "student_attempt": record.get("student_attempt") or "",
            "created_at": record.get("created_at"),
            "privacy_scope": "private",
            "status": record.get("status"),
            "schema": SCHEMA,
        },
        "classification": record.get("classification") or {},
        "context": record.get("context") or {},
        "plan": record.get("plan") or {},
        "response": response,
        "actions": {"recommendation": action, "alternatives": []},
    }


def create_ask(service: Any, params: dict[str, Any]) -> dict[str, Any]:
    kind = require_choice(params.get("content_kind") or "text", CONTENT_KINDS, "content_kind")
    content = _str_field(params, "content", 8000)
    local_reference = _str_field(params, "local_reference", 300)
    if kind != "audio" and not content and not local_reference:
        raise StudyError("validation", "content is required")
    goal = params.get("session_goal") or "unknown"
    require_choice(goal, SESSION_GOALS, "session_goal")
    now = service.now if isinstance(service.now, datetime) else datetime.now(timezone.utc)
    record = {
        "schema": SCHEMA,
        "input_id": str(uuid.uuid4()),
        "content_kind": kind,
        "content": content,
        "local_reference": local_reference,
        "course_hint": _str_field(params, "course_hint", 200),
        "assignment_hint": _str_field(params, "assignment_hint", 300),
        "source_refs": [str(s)[:120] for s in (params.get("source_refs") or []) if isinstance(s, str)][:8],
        "session_goal": goal,
        "student_attempt": _str_field(params, "student_attempt", 8000),
        "created_at": iso(now),
        "privacy_scope": "private",
        "status": "pending",
        "canvas": _canvas_meta(params.get("canvas")),
        "note_due": _str_field(params, "note_due", 64),
        "checker": params.get("checker") if isinstance(params.get("checker"), dict) else None,
        "overrides": {},
    }
    return _recompute(service, record)


def correct_ask(service: Any, input_id: str, params: dict[str, Any]) -> dict[str, Any]:
    record = load_ask(service.user_root, input_id)
    overrides = dict(record.get("overrides") or {})
    if "course" in params:
        overrides["course"] = _str_field(params, "course", 200)
    if "assignment" in params:
        overrides["assignment"] = _str_field(params, "assignment", 300)
    if params.get("job"):
        overrides["job"] = require_choice(params["job"], JOBS, "job")
    if params.get("boundary"):
        overrides["boundary"] = require_choice(params["boundary"], BOUNDARIES, "boundary")
    if "due" in params:
        overrides["due"] = _str_field(params, "due", 64)
    record["overrides"] = overrides
    return _recompute(service, record)


def switch_mode(service: Any, input_id: str, session_goal: str) -> dict[str, Any]:
    record = load_ask(service.user_root, input_id)
    require_choice(session_goal, MODES, "session_goal")
    record["session_goal"] = session_goal
    return _recompute(service, record)


def get_ask(service: Any, input_id: str) -> dict[str, Any]:
    return envelope(load_ask(service.user_root, input_id))


def get_current(service: Any) -> dict[str, Any]:
    input_id = current_id(service.user_root)
    if not input_id:
        return {"ok": True, "ask": None}
    try:
        return get_ask(service, input_id)
    except StudyError:
        return {"ok": True, "ask": None}


def _points(item: dict[str, Any]) -> float:
    raw = item.get("points") if item.get("points") is not None else item.get("points_possible")
    try:
        return float(raw or 0)
    except (TypeError, ValueError):
        return 0.0


def _work_action(item: dict[str, Any]) -> dict[str, Any]:
    due = str(item.get("due_at") or item.get("due") or "")
    title = str(item.get("title") or "Open work")
    return {
        "id": str(item.get("id") or title)[:128],
        "title": title[:200],
        "course_label": str(item.get("course_label") or "")[:200],
        "why_now": f"Due {due}" if due else "Open work with no due time",
        "value": "Finish open coursework",
        "urgency": due or "9999-12-31",
        "consequence": _points(item),
        "estimated_effort": "one sitting",
        "dependencies": [],
        "risk": "low",
        "can_prepare_privately": True,
        "student_confirmation_needed": False,
        "source_refs": [str(item.get("id") or "")][:1],
        "due_at": due,
    }


def rank_open_work(items: list[dict[str, Any]], *, lead: dict[str, Any] | None = None) -> dict[str, Any]:
    """Soonest meaningful open item, then higher points. Completed rows are dropped.

    Meaningful means 10 points or more when any such item exists. Same rule as
    teach-hint do-first: due order, not table order.
    """
    open_items = []
    for item in items:
        if not isinstance(item, dict) or item.get("completed"):
            continue
        if not (item.get("due_at") or item.get("due")):
            continue
        open_items.append(item)
    meaningful = [item for item in open_items if _points(item) >= MEANINGFUL_POINTS]
    pool = meaningful or open_items
    pool.sort(key=lambda item: (str(item.get("due_at") or item.get("due") or ""), -_points(item)))
    ranked = [_work_action(item) for item in pool]
    if lead:
        return {"ok": True, "recommendation": lead, "alternatives": ranked[:2]}
    if not ranked:
        return {"ok": True, "recommendation": None, "alternatives": []}
    return {"ok": True, "recommendation": ranked[0], "alternatives": ranked[1:3]}


def rank_for_service(service: Any, params: dict[str, Any]) -> dict[str, Any]:
    raw_items = params.get("open_work") or []
    if not isinstance(raw_items, list):
        raise StudyError("validation", "open_work must be a list")
    cleaned = []
    for item in raw_items[:40]:
        if not isinstance(item, dict):
            continue
        cleaned.append(
            {
                "id": str(item.get("id") or "")[:128],
                "title": str(item.get("title") or "")[:200],
                "due_at": str(item.get("due_at") or item.get("due") or "")[:64],
                "points": item.get("points") if item.get("points") is not None else item.get("points_possible"),
                "completed": bool(item.get("completed")),
                "course_label": str(item.get("course_label") or "")[:200],
            }
        )
    lead = None
    input_id = params.get("input_id") or current_id(service.user_root)
    if input_id:
        try:
            record = load_ask(service.user_root, str(input_id))
            lead = (record.get("response") or {}).get("next_action")
        except StudyError:
            lead = None
    if params.get("input_id") and lead is None:
        raise StudyError("not_found", f"unknown ask {input_id}")
    return rank_open_work(cleaned, lead=lead if params.get("prefer_ask") else None)


def promote_pending(service: Any) -> dict[str, Any]:
    directory = inbox_dir(service.user_root)
    if not directory.is_dir():
        return {"ok": True, "promoted": None}
    files = sorted(directory.glob("*.json"), key=lambda path: path.stat().st_mtime)
    if not files:
        return {"ok": True, "promoted": None}
    path = files[-1]
    raw = _read_json(path)
    if raw is None:
        path.unlink(missing_ok=True)
        return {"ok": True, "promoted": None}
    params = {
        "content_kind": raw.get("content_kind") or "source_ref",
        "content": raw.get("content") or "",
        "course_hint": raw.get("course_hint") or "",
        "assignment_hint": raw.get("assignment_hint") or "",
        "canvas": raw.get("canvas") or {},
        "session_goal": raw.get("session_goal") or "unknown",
        "local_reference": f"study/ask-inbox/{path.name}",
    }
    result = create_ask(service, params)
    path.unlink(missing_ok=True)
    result["promoted_from"] = "extension"
    return result
