"""Typed records and vocabularies for study sessions (revised spec §1)."""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
PROJECTION_VERSION = 1

OUTCOMES = ("correct", "partial", "incorrect", "skipped", "interrupted", "uncertain")
GRADERS = ("pending", "deterministic", "model_proposed", "student_self", "abstained")
VALIDITY = ("active", "stale", "quarantined", "withdrawn")
STABILITY = ("fragile", "holding", "durable")
MODES = ("learn", "review", "practice")
EVIDENCE = (
    "delayed_independent_retrieval",
    "delayed_check",
    "baseline_response",
    "immediate_practice",
    "acquisition_only",
    "assisted_response",
    "exposed_response",
    "unknown_assistance",
    "unverified_response",
    "clock_uncertain",
    "no_evidence",
    "invalidated",
)
EVENT_TYPES = (
    "packet_imported",
    "attempt_started",
    "draft_saved",
    "attempt_submitted",
    "assessment",
    "exposure",
    "correction",
    "plan_review",
    "clock_anomaly",
    "packet_withdrawn",
    "ai_proposal",
)
PROVENANCE = ("instructor", "student", "synthetic", "model_candidate")
EXAM_VALUES = ("known_instant", "date_only", "window", "unknown", "cancelled")
EXAM_CONFIDENCES = ("high", "medium", "low", "unknown")
EXAM_SOURCES = ("canvas_window", "module_page", "announcement", "student", "canvas_due_at", "unknown")

# The ladder is a product hypothesis, not a validated learning constant.
GAP_LADDER = (1, 3, 7, 14, 21)
MAX_GAP_DAYS = 21
ELAPSED_FLOOR_HOURS = 12
COOLDOWN_HOURS = 12
CLOCK_TOLERANCE_SECONDS = 5 * 60

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class StudyError(Exception):
    """Boundary error with a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def write_private_text(path: Path, text: str) -> None:
    """Atomically replace ``path`` with owner-only (0600) contents.

    Mirror of ``core/private_files.py``: the app imports this package as a
    top-level ``study`` module, so it cannot import its parent package. The
    temp file is created 0600 with O_EXCL/O_NOFOLLOW, so a secret is never
    briefly world-readable and a pre-planted symlink is refused.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions - 0700 directory, owner-only
    except OSError:
        pass
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def require_id(value: Any, what: str) -> str:
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise StudyError("validation", f"{what} must be a short id, got {value!r}")
    return value


def require_choice(value: Any, choices: tuple[str, ...], what: str) -> str:
    if value not in choices:
        raise StudyError("validation", f"{what} must be one of {choices}, got {value!r}")
    return str(value)


def parse_instant(value: Any, what: str) -> datetime:
    """Parse an ISO-8601 instant; naive values are rejected, not assumed UTC."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError as exc:
            raise StudyError("validation", f"{what} is not an ISO instant: {value!r}") from exc
    else:
        raise StudyError("validation", f"{what} is required")
    if parsed.tzinfo is None:
        raise StudyError("validation", f"{what} must carry a UTC offset: {value!r}")
    return parsed.astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Event:
    """One committed log line. ``seq`` is assigned by the store."""

    event_id: str
    type: str
    at: datetime
    zone: str
    payload: dict[str, Any]
    seq: int = 0
    schema: int = SCHEMA_VERSION

    def to_line(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "event_id": self.event_id,
            "type": self.type,
            "at": iso(self.at),
            "zone": self.zone,
            "payload": self.payload,
            "schema": self.schema,
        }

    @classmethod
    def from_line(cls, raw: dict[str, Any]) -> Event:
        if not isinstance(raw, dict):
            # A scalar/list line (older schema, sync tool junk) is a damaged
            # record, handled like any other — never an AttributeError (F14).
            raise StudyError("validation", "event line is not an object")
        return cls(
            event_id=require_id(raw.get("event_id"), "event_id"),
            type=require_choice(raw.get("type"), EVENT_TYPES, "type"),
            at=parse_instant(raw.get("at"), "at"),
            zone=str(raw.get("zone") or "UTC"),
            payload=dict(raw.get("payload") or {}),
            seq=int(raw.get("seq") or 0),
            schema=int(raw.get("schema") or SCHEMA_VERSION),
        )


@dataclass
class ItemState:
    item_id: str
    objective_id: str
    due: datetime | None = None
    anchor: datetime | None = None
    gap_days: int = 1
    hits: int = 0
    stability: str = "fragile"
    cooldown: datetime | None = None
    validity: str = "active"
    schedule_status: str = "unscheduled"  # unscheduled | scheduled | no_pre_exam_slot
    encountered: bool = False
    last_event_seq: int = 0
    last_evidence: str | None = None
    last_outcome: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "objective_id": self.objective_id,
            "due": iso(self.due) if self.due else None,
            "anchor": iso(self.anchor) if self.anchor else None,
            "gap_days": self.gap_days,
            "hits": self.hits,
            "stability": self.stability,
            "cooldown": iso(self.cooldown) if self.cooldown else None,
            "validity": self.validity,
            "schedule_status": self.schedule_status,
            "encountered": self.encountered,
            "last_event_seq": self.last_event_seq,
            "last_evidence": self.last_evidence,
            "last_outcome": self.last_outcome,
        }


@dataclass
class AttemptState:
    attempt_id: str
    item_id: str
    objective_id: str
    mode: str
    started_at: datetime
    start_seq: int
    clock_status: str = "trusted"
    packet_version: int = 0
    status: str = "open"  # open | submitted | assessed | interrupted
    draft: str = ""
    draft_revision: int = 0
    draft_saved_at: datetime | None = None
    response: str = ""
    fields: dict[str, str] = field(default_factory=dict)
    submitted_at: datetime | None = None
    submit_seq: int = 0
    hints: int = 0
    exposures: list[dict[str, Any]] = field(default_factory=list)
    assistance: str = "none"  # none | hint | unknown
    outcome: str | None = None
    grader: str | None = None
    scope: str | None = None
    evidence: str | None = None
    feedback: dict[str, Any] | None = None
    assessment_event_id: str | None = None
    corrections: list[str] = field(default_factory=list)
    revealed: bool = False
    proposals: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempt_id": self.attempt_id,
            "item_id": self.item_id,
            "objective_id": self.objective_id,
            "mode": self.mode,
            "started_at": iso(self.started_at),
            "clock_status": self.clock_status,
            "packet_version": self.packet_version,
            "status": self.status,
            "draft": self.draft,
            "draft_revision": self.draft_revision,
            "draft_saved_at": iso(self.draft_saved_at) if self.draft_saved_at else None,
            "response": self.response,
            "fields": dict(self.fields),
            "submitted_at": iso(self.submitted_at) if self.submitted_at else None,
            "hints": self.hints,
            "exposures": list(self.exposures),
            "assistance": self.assistance,
            "outcome": self.outcome,
            "grader": self.grader,
            "scope": self.scope,
            "evidence": self.evidence,
            "feedback": self.feedback,
            "assessment_event_id": self.assessment_event_id,
            "corrections": list(self.corrections),
            "revealed": self.revealed,
            "proposals": list(self.proposals),
        }


@dataclass
class Projection:
    version: int = PROJECTION_VERSION
    last_seq: int = 0
    items: dict[str, ItemState] = field(default_factory=dict)
    attempts: dict[str, AttemptState] = field(default_factory=dict)
    # objective_id -> list of (seq, instant, kind) substantive encounters
    encounters: dict[str, list[tuple[int, datetime, str]]] = field(default_factory=dict)
    packets: dict[str, dict[str, Any]] = field(default_factory=dict)
    clock_anomalies: int = 0
    untracked_reads: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "last_seq": self.last_seq,
            "items": {k: v.to_dict() for k, v in self.items.items()},
            "attempts": {k: v.to_dict() for k, v in self.attempts.items()},
            "packets": self.packets,
            "clock_anomalies": self.clock_anomalies,
            "untracked_reads": self.untracked_reads,
        }
