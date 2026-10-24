"""Study commands. This module is the only writer of the study event log.

Every command loads packets + projection, appends zero or more events through
``store.append_event`` (durable before returning), and answers with plain
dicts for the CLI/IPC layer. Keys and feedback are never included in a
response before the matching exposure event is committed.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from . import checkers
from .clock import calendar_add, check_clock, nearest_future_exam
from .model import (
    ELAPSED_FLOOR_HOURS,
    MODES,
    AttemptState,
    Event,
    ItemState,
    Projection,
    StudyError,
    iso,
    parse_instant,
    require_choice,
    require_id,
)
from .packets import (
    commit_packet,
    discard_pending,
    find_item,
    item_sources,
    load_exams,
    load_packet_version,
    load_packets,
    normalize_exam,
    pending_imports,
    public_item,
    save_exam,
    stage_packet,
    validate_packet,
)
from .reducer import eligible, reduce
from .select import select
from .store import (
    append_event,
    load_projection_cache,
    read_log,
    save_projection_cache,
    study_dir,
)

SESSION_IDLE_HOURS = 2

TIMELINES: dict[tuple[int, str], list[dict[str, Any]]] = {
    (5, "learn"): [
        {"label": "Purpose", "seconds": 20},
        {"label": "Source / example", "seconds": 60},
        {"label": "Faded step", "seconds": 90},
        {"label": "Feedback / repair", "seconds": 80},
        {"label": "Save and choose a later check", "seconds": 50},
    ],
    (5, "review"): [
        {"label": "Objective + locator", "seconds": 20},
        {"label": "Attempt", "seconds": 150},
        {"label": "Feedback + source", "seconds": 70},
        {"label": "Optional repair", "seconds": 40},
        {"label": "Close", "seconds": 20},
    ],
    (10, "learn"): [
        {"label": "Purpose", "seconds": 25},
        {"label": "Example", "seconds": 120},
        {"label": "Explain / faded step", "seconds": 90},
        {"label": "Short isomorph", "seconds": 180},
        {"label": "Feedback / repair", "seconds": 120},
        {"label": "Close", "seconds": 65},
    ],
    (10, "review"): [
        {"label": "Objective + locator", "seconds": 25},
        {"label": "Attempt", "seconds": 240},
        {"label": "Feedback", "seconds": 100},
        {"label": "Optional repair / contrast", "seconds": 150},
        {"label": "Close", "seconds": 85},
    ],
}

EVIDENCE_COPY = {
    "delayed_independent_retrieval": "Correct on this check after the scheduled gap; no help recorded here.",
    "delayed_check": "Checked after the scheduled gap. The answer decides the next repair.",
    "baseline_response": "First answer in this app: a baseline, not evidence of retention.",
    "immediate_practice": "You saw relevant material recently, so this counts as practice.",
    "acquisition_only": "You just studied the example, so this is practice rather than evidence of retention.",
    "assisted_response": "Correct with a hint; revisit later without it." ,
    "exposed_response": "Seeing the solution is learning, not a delayed check.",
    "unknown_assistance": "Help noted; a later independent check will be more informative.",
    "unverified_response": "Recorded as your own check. This method cannot verify the answer.",
    "clock_uncertain": "Your computer's clock looks off, so no timing evidence was recorded.",
    "no_evidence": "Nothing was scored.",
    "invalidated": "This grading was withdrawn; your answer is kept.",
}


class StudyService:
    def __init__(self, user_root: Path, *, now: datetime | None = None, zone: str | None = None) -> None:
        self.user_root = Path(user_root)
        self.now, self.clock_status, self.clock_note = check_clock(self.user_root, now)
        self.zone = zone or os.environ.get("PRODUCT_TZ") or _local_zone_name()
        self.log = read_log(self.user_root)
        self.projection = self._projection()
        self._repair_pending_imports()
        self.packets = load_packets(self.user_root)
        self.exams = load_exams(self.user_root, self.packets)

    # --- loading -----------------------------------------------------------

    def _projection(self) -> Projection:
        events = self.log.events
        cache = load_projection_cache(self.user_root)
        # The cache only stores scalar summaries; a full replay is cheap for a
        # beta-sized log, so any mismatch or absence rebuilds from events.
        proj = reduce(events)
        if cache is None or cache.get("last_seq") != proj.last_seq:
            save_projection_cache(self.user_root, proj.to_dict())
        return proj

    def _repair_pending_imports(self) -> None:
        """A crash between the import event and the rename leaves a ``.pending``
        snapshot; the event is authoritative, so finish the commit."""
        for packet_id, version in pending_imports(self.user_root):
            registered = self.projection.packets.get(packet_id)
            if registered and int(registered.get("version") or 0) >= version:
                try:
                    commit_packet(self.user_root, packet_id, version)
                except StudyError:
                    continue

    def _reload(self) -> None:
        self.log = read_log(self.user_root)
        self.projection = reduce(self.log.events)
        save_projection_cache(self.user_root, self.projection.to_dict())

    def _append(self, event_type: str, payload: dict[str, Any], *, event_id: str | None = None, at: datetime | None = None) -> tuple[str, int, bool]:
        event = Event(
            event_id=event_id or str(uuid.uuid4()),
            type=event_type,
            at=at or self.now,
            zone=self.zone,
            payload=payload,
        )
        result = append_event(self.user_root, event)
        self._reload()
        return result.event_id, result.seq, result.status == "duplicate"

    # --- session -----------------------------------------------------------

    def _session_path(self) -> Path:
        return study_dir(self.user_root) / "session.json"

    def session(self, *, new: bool = False) -> dict[str, Any]:
        path = self._session_path()
        data: dict[str, Any] = {}
        if not new and path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                last = parse_instant(data.get("last_active"), "last_active")
                if self.now - last > timedelta(hours=SESSION_IDLE_HOURS):
                    data = {}
            except (OSError, ValueError, StudyError):
                data = {}
        if not data:
            data = {"id": str(uuid.uuid4()), "started_at": iso(self.now), "visited": []}
        data["last_active"] = iso(self.now)
        self._save_session(data)
        return data

    def _save_session(self, data: dict[str, Any]) -> None:
        path = self._session_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, path)
        except OSError:
            return

    def _visit(self, item_id: str) -> None:
        data = self.session()
        if item_id not in data["visited"]:
            data["visited"].append(item_id)
        self._save_session(data)

    # --- read commands ----------------------------------------------------

    def status(self) -> dict[str, Any]:
        items = list(self.projection.items.values())
        active = [s for s in items if s.validity == "active"]
        due_now = [s for s in active if s.due is not None and s.due <= self.now]
        open_attempts = [_bounded(a.to_dict()) for a in self.projection.attempts.values() if a.status in ("open", "interrupted")]
        pending = [_bounded(a.to_dict()) for a in self.projection.attempts.values() if a.status == "submitted"]
        upcoming = min((s.due for s in active if s.due is not None and s.due > self.now), default=None)
        counts = {"fragile": 0, "holding": 0, "durable": 0}
        for s in active:
            counts[s.stability] = counts.get(s.stability, 0) + 1
        return {
            "ok": True,
            "now": iso(self.now),
            "zone": self.zone,
            "clock": {"status": self.clock_status, "note": self.clock_note, "anomalies": self.projection.clock_anomalies},
            "packets": [
                {
                    "packet_id": p["packet_id"],
                    "title": p["title"],
                    "course": p["course"],
                    "provenance": p["provenance"],
                    "version": p["version"],
                    "sources": len(p["sources"]),
                    "items": len(p["items"]),
                    "stale_sources": [s["id"] for s in p["sources"] if s.get("stale")],
                }
                for p in self.packets.values()
            ],
            "courses": sorted({p["course"] for p in self.packets.values() if p["course"]}),
            "exams": [self._exam_view(e) for e in self.exams],
            "items": {"active": len(active), "due_now": len(due_now), "next_due": iso(upcoming) if upcoming else None, "stability": counts},
            "open_attempts": open_attempts,
            "pending_assessments": pending,
            "log": {"events": len(self.log.events), "partial_tail": self.log.partial_tail},
            "session": self.session(),
        }

    def _exam_view(self, exam: dict[str, Any]) -> dict[str, Any]:
        from .clock import exam_window

        window = exam_window(exam)
        return {
            **exam,
            "cutoff_at": iso(window.cutoff) if window.cutoff else None,
            "is_past": window.is_past(self.now),
        }

    def packets_view(self) -> dict[str, Any]:
        return {
            "ok": True,
            "packets": [
                {
                    "packet_id": p["packet_id"],
                    "title": p["title"],
                    "course": p["course"],
                    "provenance": p["provenance"],
                    "version": p["version"],
                    "sources": [
                        {"id": s["id"], "locator": s["locator"], "hash": s["hash"], "stale": bool(s.get("stale")), "chars": len(s["text"])}
                        for s in p["sources"]
                    ],
                    "objectives": p["objectives"],
                    "items": [public_item(p, i) | {"state": self._state_view(i["id"])} for i in p["items"]],
                    "exams": [self._exam_view(e) for e in p["exams"]],
                }
                for p in self.packets.values()
            ],
        }

    def read_source(self, packet_id: str, source_id: str, *, attempt_id: str | None = None) -> dict[str, Any]:
        """Show a source. Logged as an exposure BEFORE the text is returned."""
        packet = self.packets.get(packet_id)
        if packet is None:
            raise StudyError("not_found", f"unknown packet {packet_id}")
        source = next((s for s in packet["sources"] if s["id"] == source_id), None)
        if source is None:
            raise StudyError("not_found", f"unknown source {source_id}")
        objective_ids = sorted({i["objective_id"] for i in packet["items"] if source_id in i["source_refs"]})
        self._append(
            "exposure",
            {
                "attempt_id": attempt_id,
                "objective_ids": objective_ids,
                "kind": "source_read",
                "solution_bearing": "unknown",
                "surface": "source_viewer",
                "source_id": source_id,
                "packet_version": packet["version"],
            },
        )
        return {"ok": True, "source": dict(source), "objective_ids": objective_ids}

    def history(self, item_id: str, *, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        """Newest first, paginated, so a long history never produces an
        oversized IPC reply (adopted from candidate B's bounded status)."""
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))
        rows = [a.to_dict() for a in self.projection.attempts.values() if a.item_id == item_id]
        rows.sort(key=lambda a: a["started_at"], reverse=True)
        page = rows[offset : offset + limit]
        return {"ok": True, "item_id": item_id, "state": self._state_view(item_id), "attempts": page, "total": len(rows), "offset": offset, "limit": limit}

    def _state_view(self, item_id: str) -> dict[str, Any] | None:
        state = self.projection.items.get(item_id)
        if state is None:
            return None
        view = state.to_dict()
        found = find_item(self.packets, item_id)
        course = found[0]["course"] if found else None
        exam = nearest_future_exam(self.exams, course=course, objective_id=state.objective_id, now=self.now)
        effective = state.due
        if exam is not None and exam[1].cutoff is not None and state.due is not None:
            if exam[1].cutoff > self.now:
                effective = min(state.due, exam[1].cutoff)
        view["effective_due"] = iso(effective) if effective else None
        view["independent_check_no_earlier_than"] = iso(self._independent_after(state)) if state.anchor else None
        view["exam"] = self._exam_view(exam[0]) if exam else None
        return view

    def _independent_after(self, state: ItemState) -> datetime:
        if state.anchor is None:
            raise StudyError("state", "cannot calculate independent check before an anchor exists")
        gate = calendar_add(state.anchor, max(1, state.gap_days), self.zone)
        floor = state.anchor + timedelta(hours=ELAPSED_FLOOR_HOURS)
        candidates = [gate, floor]
        if state.due is not None:
            candidates.append(state.due)
        return max(candidates)

    # --- packets ----------------------------------------------------------

    def import_packet(self, raw: Any) -> dict[str, Any]:
        packet = validate_packet(raw)
        existing = self.packets.get(packet["packet_id"])
        if existing is not None and existing["version"] >= packet["version"]:
            raise StudyError(
                "conflict",
                f"packet {packet['packet_id']} v{existing['version']} is already imported; bump version to replace it",
            )
        # Item ids are global in the projection: refuse a collision with another packet.
        for item in packet["items"]:
            owner = find_item(self.packets, item["id"])
            if owner is not None and owner[0]["packet_id"] != packet["packet_id"]:
                raise StudyError(
                    "conflict",
                    f"item id {item['id']} already belongs to packet {owner[0]['packet_id']}; rename it",
                )
        # Order: stage snapshot → durable event → commit rename. A crash after
        # the event is repaired at next start; a crash before it leaves nothing registered.
        stage_packet(self.user_root, packet)
        try:
            self._append(
                "packet_imported",
                {
                    "packet_id": packet["packet_id"],
                    "version": packet["version"],
                    "objective_map": {i["id"]: i["objective_id"] for i in packet["items"]},
                    "source_hashes": {s["id"]: s["hash"] for s in packet["sources"]},
                    "provenance": packet["provenance"],
                },
                event_id=f"import:{packet['packet_id']}:v{packet['version']}",
            )
        except StudyError:
            discard_pending(self.user_root, packet["packet_id"], packet["version"])
            raise
        commit_packet(self.user_root, packet["packet_id"], packet["version"])
        self.packets = load_packets(self.user_root)
        self.exams = load_exams(self.user_root, self.packets)
        return {"ok": True, "packet_id": packet["packet_id"], "version": packet["version"], "items": len(packet["items"]), "sources": len(packet["sources"])}

    def import_path(self, path: str) -> dict[str, Any]:
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except OSError as exc:
            raise StudyError("not_found", f"cannot read {path}: {exc}") from exc
        except ValueError as exc:
            raise StudyError("validation", f"{path} is not valid JSON: {exc}") from exc
        return self.import_packet(raw)

    def withdraw_packet(self, packet_id: str, reason: str) -> dict[str, Any]:
        packet = self.packets.get(packet_id)
        if packet is None:
            raise StudyError("not_found", f"unknown packet {packet_id}")
        self._append(
            "packet_withdrawn",
            {"packet_id": packet_id, "item_ids": [i["id"] for i in packet["items"]], "reason": reason},
        )
        return {"ok": True, "packet_id": packet_id, "withdrawn_items": len(packet["items"])}

    def set_exam(self, raw: dict[str, Any]) -> dict[str, Any]:
        # Merge onto the existing record so a date change keeps course/scope.
        existing = next((e for e in self.exams if e.get("id") == raw.get("id")), None)
        merged = {**existing, **{k: v for k, v in raw.items() if v not in (None, "")}} if existing else raw
        if existing is not None:
            merged["revision"] = int(existing.get("revision") or 1) + 1
        exam = normalize_exam(merged)
        save_exam(self.user_root, exam)
        self.exams = load_exams(self.user_root, self.packets)
        return {"ok": True, "exam": self._exam_view(exam)}

    # --- offers -------------------------------------------------------------

    def offer(
        self,
        *,
        course: str | None = None,
        minutes: int = 5,
        mode: str | None = None,
        cram: bool = False,
        item_id: str | None = None,
        new_session: bool = False,
    ) -> dict[str, Any]:
        if mode is not None:
            require_choice(mode, MODES, "mode")
        session = self.session(new=new_session)
        open_items = {
            a.item_id
            for a in self.projection.attempts.values()
            if a.status in ("open", "interrupted") and (a.draft or a.hints or a.exposures)
        }
        selection = select(
            packets=self.packets,
            projection=self.projection,
            exams=self.exams,
            now=self.now,
            course=course,
            visited=set(session.get("visited") or []),
            requested_mode=mode,
            cram=cram,
            prefer_item=item_id,
            open_items=open_items,
        )
        payload = selection.to_dict()
        if selection.item and selection.item["id"] in open_items:
            resume = self._open_attempt(selection.item["id"])
            if resume is not None:
                payload["mode"] = resume["mode"]
        payload["ok"] = True
        payload["minutes"] = minutes
        payload["timeline"] = self._timeline(minutes, selection.mode)
        payload["session"] = session
        if selection.item:
            payload["resume"] = self._open_attempt(selection.item["id"])
            payload["item"]["state"] = self._state_view(selection.item["id"])
        return payload

    def _timeline(self, minutes: int, mode: str | None) -> list[dict[str, Any]]:
        block = 10 if minutes >= 10 else 5
        key = (block, "learn" if mode == "learn" else "review")
        return TIMELINES[key]

    def _open_attempt(self, item_id: str) -> dict[str, Any] | None:
        for attempt in self.projection.attempts.values():
            if attempt.item_id == item_id and attempt.status in ("open", "interrupted", "submitted"):
                return attempt.to_dict()
        return None

    # --- attempts -----------------------------------------------------------

    def start(self, item_id: str, mode: str, *, minutes: int = 5, work_item_id: str | None = None) -> dict[str, Any]:
        require_choice(mode, MODES, "mode")
        found = find_item(self.packets, item_id)
        if found is None:
            raise StudyError("not_found", f"unknown item {item_id}")
        packet, item = found
        state = self.projection.items.get(item_id)
        if state is None or state.validity != "active":
            raise StudyError("unsupported", "this item is withdrawn or not registered")
        if mode == "learn" and item.get("example") is None:
            raise StudyError("unsupported", "this item has no example for learn mode")
        existing = self._open_attempt(item_id)
        if existing is not None and existing["status"] != "submitted":
            # Resume: same attempt id, original start, exposure history intact.
            return self._attempt_view(packet, item, self.projection.attempts[existing["attempt_id"]], minutes, resumed=True)
        attempt_id = str(uuid.uuid4())
        if self.clock_status != "trusted":
            self._append("clock_anomaly", {"note": self.clock_note})
        self._append(
            "attempt_started",
            {
                "attempt_id": attempt_id,
                "item_id": item_id,
                "objective_id": item["objective_id"],
                "mode": mode,
                "clock_status": self.clock_status,
                "packet_version": packet["version"],
                "minutes": minutes,
                **({"work_item_id": work_item_id} if isinstance(work_item_id, str) and work_item_id.startswith("canvas:") else {}),
            },
        )
        if mode == "learn":
            # The example is solution-bearing for the objective; log it before it renders.
            self._append(
                "exposure",
                {
                    "attempt_id": attempt_id,
                    "objective_ids": [item["objective_id"]],
                    "kind": "example",
                    "solution_bearing": "yes",
                    "surface": "learn_example",
                    "packet_version": packet["version"],
                },
                event_id=f"{attempt_id}:example",
            )
        self._visit(item_id)
        return self._attempt_view(packet, item, self.projection.attempts[attempt_id], minutes, resumed=False)

    def _attempt_view(self, packet: dict[str, Any], item: dict[str, Any], attempt: AttemptState, minutes: int, *, resumed: bool) -> dict[str, Any]:
        view: dict[str, Any] = {
            "ok": True,
            "resumed": resumed,
            "attempt": attempt.to_dict(),
            "item": public_item(packet, item) | {"state": self._state_view(item["id"])},
            "timeline": self._timeline(minutes, attempt.mode),
            "clock": {"status": attempt.clock_status},
        }
        if attempt.mode == "learn" and item.get("example") is not None:
            view["example"] = item["example"]
        return view

    def draft(self, attempt_id: str, text: str, *, expected_revision: int | None = None) -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("open", "interrupted"))
        if expected_revision is not None and expected_revision != attempt.draft_revision:
            raise StudyError(
                "draft_revision_conflict",
                f"draft is at revision {attempt.draft_revision}, not {expected_revision}; reload before saving",
            )
        revision = attempt.draft_revision + 1
        self._append("draft_saved", {"attempt_id": attempt_id, "revision": revision, "text": text})
        saved = self.projection.attempts[attempt_id]
        if saved.draft != text:
            # Another writer took this revision first; the reducer keeps the
            # earliest record for a revision, so report the conflict honestly.
            raise StudyError(
                "draft_revision_conflict",
                f"another save reached revision {saved.draft_revision} first; reload before saving",
            )
        return {"ok": True, "attempt_id": attempt_id, "revision": saved.draft_revision, "saved_at": iso(saved.draft_saved_at) if saved.draft_saved_at else None}

    def hint(self, attempt_id: str) -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("open", "interrupted"))
        packet, item = self._packet_item(attempt.item_id)
        if not item.get("hint"):
            raise StudyError("unsupported", "no hint is available for this item")
        self._append(
            "exposure",
            {"attempt_id": attempt_id, "objective_ids": [item["objective_id"]], "kind": "hint", "solution_bearing": "no", "surface": "hint"},
        )
        return {"ok": True, "hint": item["hint"], "attempt": self.projection.attempts[attempt_id].to_dict()}

    def reveal(self, attempt_id: str) -> dict[str, Any]:
        """Show sources + key during an attempt. Exposure is committed first."""
        attempt = self._require_attempt(attempt_id, ("open", "interrupted", "submitted", "assessed"))
        packet, item = self._packet_item_for_attempt(attempt)
        self._append(
            "exposure",
            {"attempt_id": attempt_id, "objective_ids": [item["objective_id"]], "kind": "reveal", "solution_bearing": "yes", "surface": "reveal", "packet_version": packet["version"]},
        )
        return {
            "ok": True,
            "sources": item_sources(packet, item),
            "key": self._key_view(packet, item),
            "attempt": self.projection.attempts[attempt_id].to_dict(),
        }

    def skip(self, attempt_id: str) -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("open", "interrupted"))
        self._append(
            "assessment",
            {"attempt_id": attempt_id, "outcome": "skipped", "grader": "abstained", "scope": "", "source_valid": True},
            event_id=f"{attempt_id}:skip",
        )
        self._visit(attempt.item_id)
        return {"ok": True, "attempt": self.projection.attempts[attempt_id].to_dict(), "state": self._state_view(attempt.item_id)}

    def submit(
        self,
        attempt_id: str,
        text: str,
        fields: dict[str, str] | None = None,
        *,
        self_outcome: str | None = None,
    ) -> dict[str, Any]:
        # "assessed" is allowed so a retried identical submission returns the
        # same acknowledgment (F19/F28); different bytes raise a conflict.
        attempt = self._require_attempt(attempt_id, ("open", "interrupted", "submitted", "assessed"))
        packet, item = self._packet_item_for_attempt(attempt)
        fields = {str(k): str(v) for k, v in (fields or {}).items()}
        _, _, duplicate = self._append(
            "attempt_submitted",
            {"attempt_id": attempt_id, "response_text": text, "fields": fields},
            event_id=f"{attempt_id}:submit",
        )
        attempt = self.projection.attempts[attempt_id]
        if attempt.status == "assessed":
            # A retried submission after a crash must still log the feedback
            # exposure before the key is returned (audit A finding 3).
            self._feedback_exposure(attempt_id, item, packet)
            return self._assessed_view(packet, item, self.projection.attempts[attempt_id], duplicate=True)
        # Grade against the committed response, not the request body.
        grade = checkers.grade(item["fields"], attempt.fields, attempt.response)
        current = self.packets.get(packet["packet_id"])
        version_current = current is not None and current["version"] == attempt.packet_version
        source_valid = version_current and not any(s.get("stale") for s in item_sources(packet, item))
        outcome, grader, scope = grade.outcome, grade.grader, grade.scope
        if not version_current:
            # The source changed since this attempt started: keep the answer,
            # block new scoring until the new version is revalidated (spec §4.3).
            outcome, grader, scope = "uncertain", "abstained", ""
        elif grader == "deterministic" and not _key_authority(packet, item):
            # A model-generated key is a proposal until an independent bounded
            # derivation validates it; it can never advance stability (audit A finding 2).
            grader = "model_proposed"
        if grader == "abstained" and self_outcome and version_current:
            outcome = require_choice(self_outcome, ("correct", "partial", "incorrect"), "self_outcome")
            grader = "student_self"
            scope = "self-check against the rubric"
        state = self.projection.items[attempt.item_id]
        exam = nearest_future_exam(self.exams, course=packet["course"], objective_id=item["objective_id"], now=self.now)
        cutoff_payload: dict[str, Any] = {"cutoff_at": None, "exam_future": False, "exam_within_24h": False}
        if exam is not None and exam[1].cutoff is not None:
            starts = exam[1].cutoff + timedelta(hours=1)
            cutoff_payload = {
                "cutoff_at": iso(exam[1].cutoff),
                "exam_future": True,
                "exam_within_24h": (starts - self.now) <= timedelta(hours=24),
                "exam_id": exam[0]["id"],
            }
        was_eligible, reason = eligible(self.projection, state, attempt, self.zone)
        self._append(
            "assessment",
            {
                "attempt_id": attempt_id,
                "outcome": outcome,
                "grader": grader,
                "scope": scope,
                "source_valid": source_valid,
                "checker": grade.to_dict(),
                "support_refs": list((item.get("key") or {}).get("support_refs") or []),
                "packet_version": packet["version"],
                "eligibility_note": reason,
                **cutoff_payload,
            },
            event_id=f"{attempt_id}:assess",
        )
        # Feedback shows the key: an exposure, logged before the key is returned.
        self._feedback_exposure(attempt_id, item, packet)
        self._visit(attempt.item_id)
        return self._assessed_view(packet, item, self.projection.attempts[attempt_id], duplicate=False)

    def _feedback_exposure(self, attempt_id: str, item: dict[str, Any], packet: dict[str, Any]) -> None:
        self._append(
            "exposure",
            {"attempt_id": attempt_id, "objective_ids": [item["objective_id"]], "kind": "feedback", "solution_bearing": "yes", "surface": "feedback", "packet_version": packet["version"]},
            event_id=f"{attempt_id}:feedback",
        )

    def _assessed_view(self, packet: dict[str, Any], item: dict[str, Any], attempt: AttemptState, *, duplicate: bool) -> dict[str, Any]:
        state = self.projection.items[attempt.item_id]
        evidence = attempt.evidence or "no_evidence"
        current = self.packets.get(packet["packet_id"])
        historical = current is None or current["version"] != packet["version"]
        feedback_text = ""
        block = item.get("feedback") or {}
        if attempt.outcome in block:
            feedback_text = str(block[attempt.outcome])
        checker = None
        for event in reversed(self.log.events):
            if event.type == "assessment" and event.payload.get("attempt_id") == attempt.attempt_id:
                checker = event.payload.get("checker")
                break
        return {
            "ok": True,
            "duplicate": duplicate,
            "attempt": attempt.to_dict(),
            "assessment": {
                "outcome": attempt.outcome,
                "grader": attempt.grader,
                "scope": attempt.scope,
                "evidence": evidence,
                "copy": EVIDENCE_COPY.get(evidence, ""),
                "checker": checker,
            },
            "feedback": feedback_text,
            "key": self._key_view(packet, item) | ({"historical_version": packet["version"]} if historical else {}),
            "sources": item_sources(packet, item),
            "source_changed": historical,
            "state": self._state_view(attempt.item_id),
            "next": self._next_copy(state),
        }

    def _next_copy(self, state: ItemState) -> dict[str, Any]:
        gate = self._independent_after(state) if state.anchor else None
        due = state.due
        lines: list[str] = []
        if state.schedule_status == "no_pre_exam_slot":
            lines.append("No slot remains before the exam. Post-exam practice stays available.")
        elif due is not None:
            lines.append(f"Next offer: {iso(due)}.")
        if gate is not None:
            lines.append(f"An independent check counts no earlier than {iso(gate)}.")
        return {"due": iso(due) if due else None, "independent_after": iso(gate) if gate else None, "lines": lines}

    def _key_view(self, packet: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
        key = dict(item.get("key") or {})
        labels = {
            "synthetic": "synthetic template derivation",
            "instructor": "instructor material",
            "student": "student-provided key",
            "model_candidate": "model-proposed, not validated",
        }
        key_prov = str(key.get("provenance") or packet["provenance"])
        key["provenance_label"] = labels.get(key_prov, key_prov)
        if key_prov == "student" and packet["provenance"] == "instructor":
            key["provenance_label"] = "your key, quoted from instructor material"
        return key

    # --- corrections --------------------------------------------------------

    def report_help(self, attempt_id: str, note: str = "") -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("open", "interrupted", "submitted", "assessed"))
        event_id = f"{attempt_id}:help-report"
        payload = {"target_attempt_id": attempt_id, "reason_code": "unknown_assistance", "note": note[:500]}
        if attempt.assessment_event_id:
            payload["target_event_id"] = attempt.assessment_event_id
        self._append("correction", payload | {"event_id": event_id}, event_id=event_id)
        return {"ok": True, "attempt": self.projection.attempts[attempt_id].to_dict(), "state": self._state_view(attempt.item_id)}

    def disagree(self, attempt_id: str, note: str = "") -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("assessed",))
        if attempt.assessment_event_id is None:
            raise StudyError("state", "cannot disagree with an attempt without an assessment")
        event_id = f"{attempt_id}:disagree"
        self._append(
            "correction",
            {"target_event_id": attempt.assessment_event_id, "reason_code": "disagree", "note": note[:500], "event_id": event_id},
            event_id=event_id,
        )
        return {"ok": True, "attempt": self.projection.attempts[attempt_id].to_dict(), "state": self._state_view(attempt.item_id)}

    def invalidate_assessment(self, attempt_id: str, note: str = "") -> dict[str, Any]:
        attempt = self._require_attempt(attempt_id, ("assessed",))
        if attempt.assessment_event_id is None:
            raise StudyError("state", "cannot invalidate an attempt without an assessment")
        event_id = f"{attempt_id}:invalidate"
        self._append(
            "correction",
            {"target_event_id": attempt.assessment_event_id, "reason_code": "invalid_assessment", "note": note[:500], "event_id": event_id},
            event_id=event_id,
        )
        return {"ok": True, "attempt": self.projection.attempts[attempt_id].to_dict(), "state": self._state_view(attempt.item_id)}

    def plan(self, item_id: str, at: str, reason: str = "student_choice") -> dict[str, Any]:
        if item_id not in self.projection.items:
            raise StudyError("not_found", f"unknown item {item_id}")
        requested = parse_instant(at, "at")
        if requested <= self.now:
            raise StudyError("validation", "a planned review must be in the future")
        self._append("plan_review", {"item_id": item_id, "requested_future_at": iso(requested), "reason": reason})
        return {"ok": True, "state": self._state_view(item_id)}

    # --- Canvas sources (Phase 3) -------------------------------------------

    def canvas_sources(self) -> dict[str, Any]:
        from . import canvas

        status = canvas.sync_status(self.user_root, self.now)
        records = canvas.list_course_records(self.user_root)
        courses = []
        for record in records:
            course = record["course"]
            packet = self.packets.get(canvas.packet_id_for(str(course["id"])))
            courses.append(
                {
                    "course_id": str(course["id"]),
                    "label": course.get("label") or course.get("name"),
                    "fetched_at": record.get("fetched_at"),
                    "sources": [
                        {"id": s["id"], "kind": s.get("kind"), "title": s.get("title"), "chars": len(s.get("text") or ""), "truncated": bool(s.get("truncated")), "updated_at": s.get("updated_at")}
                        for s in record.get("sources") or []
                    ],
                    "exams": record.get("exams") or [],
                    "errors": record.get("errors") or [],
                    "imported_version": packet["version"] if packet else None,
                    "imported_source_ids": [s["id"] for s in packet["sources"]] if packet else [],
                }
            )
        return {"ok": True, "status": status, "courses": courses}

    def canvas_import(self, course_id: str, source_ids: list[str] | None = None) -> dict[str, Any]:
        from . import canvas

        record = canvas.course_record(self.user_root, course_id)
        previous = self.packets.get(canvas.packet_id_for(course_id))
        packet = canvas.build_canvas_packet(record, source_ids=source_ids, zone=self.zone, previous=previous)
        result = self.import_packet(packet)
        result["kept_items"] = len(packet["items"])
        return result

    def create_item(self, packet_id: str, spec: dict[str, Any]) -> dict[str, Any]:
        from . import canvas

        packet = self.packets.get(packet_id)
        if packet is None:
            raise StudyError("not_found", f"unknown packet {packet_id}")
        new = canvas.author_item(
            packet,
            source_id=str(spec.get("source_id") or ""),
            objective_label=str(spec.get("objective_label") or ""),
            stem=str(spec.get("stem") or ""),
            checker_type=str(spec.get("checker_type") or "none"),
            answer=str(spec.get("answer") or ""),
            explanation=str(spec.get("explanation") or ""),
            support_quote=str(spec.get("support_quote") or ""),
            field_label=str(spec.get("field_label") or "Your answer"),
            options=[str(o) for o in (spec.get("options") or [])],
            hint=str(spec.get("hint") or ""),
        )
        result = self.import_packet(new)
        result["item_id"] = new["items"][-1]["id"]
        return result

    # --- funded AI help (Phase 5) --------------------------------------------

    def ai_status(self) -> dict[str, Any]:
        from . import ai

        return ai.usage(self.user_root)

    def ai_connect(self, url: str, invite_code: str) -> dict[str, Any]:
        from . import ai

        return ai.connect(self.user_root, url, invite_code)

    def ai_disconnect(self) -> dict[str, Any]:
        from . import ai

        ai.clear_relay(self.user_root)
        return {"ok": True, "connected": False}

    def ai_feedback(self, attempt_id: str, *, purpose: str = "feedback", regenerate: bool = False) -> dict[str, Any]:
        """Ask the relay for provisional feedback on an assessed attempt.

        The request id is stable per attempt and proposal count, so a retry
        after a timeout replays instead of re-billing; an explicit "ask again"
        is a new id. The proposal is recorded as an event and shown as
        provisional; it never changes the deterministic grade or schedule."""
        from . import ai

        attempt = self._require_attempt(attempt_id, ("assessed",))
        packet, item = self._packet_item_for_attempt(attempt)
        unresolved = [p for p in attempt.proposals if p.get("status") in ("pending_unknown", "billing_unknown")]
        if unresolved and not regenerate:
            # Replay the same logical request: the relay answers from its record
            # and never dispatches twice. A deliberate "ask again" is a new id.
            request_id = unresolved[-1]["request_id"]
        else:
            request_id = f"{attempt_id}:{purpose}:{len(attempt.proposals) + 1}"
        key = item.get("key") or {}
        rubric_parts = [f"{k}: {v}" for k, v in key.items() if k not in ("support_refs", "provenance", "validated_by") and isinstance(v, str)]
        answer = attempt.response or "\n".join(f"{k}: {v}" for k, v in attempt.fields.items())
        request = ai.build_request(
            request_id=request_id,
            session_budget_id=str(self.session().get("id") or "session"),
            purpose=purpose,
            sources=item_sources(packet, item),
            stem=item["stem"],
            rubric="; ".join(rubric_parts),
            submitted_answer=answer,
        )
        result = ai.dispatch(self.user_root, request)
        status = str(result.get("status") or "failed")
        proposal = result.get("assessment_proposal") if status in ("complete", "abstained") else None
        self._append(
            "ai_proposal",
            {
                "attempt_id": attempt_id,
                "request_id": request_id,
                "status": status,
                "proposal": proposal,
                "model_id": result.get("model_id"),
                "error": result.get("error") or result.get("message") or "",
                "usage": result.get("usage"),
            },
            event_id=f"{request_id}:{status}:{len(attempt.proposals)}",
        )
        copy = {
            "complete": "AI feedback is provisional: it can be wrong, and it does not change your schedule.",
            "abstained": "The model could not judge this from the supplied material.",
            "pending_unknown": "Your answer is saved; feedback has not arrived. Try later or compare it yourself with the source.",
            "billing_unknown": "The request may have reached the model but no answer came back. Retrying will not send it twice; choose “Ask again” for a fresh request.",
            "result_unavailable": "The earlier result is no longer available. Ask again to send a new request.",
            "refused": "AI help was refused: " + str(result.get("message") or result.get("error") or ""),
            "truncated": "The reply was cut off; ask again for a shorter one.",
            "malformed": "The model's reply was not usable; nothing was scored.",
            "failed": "The AI service returned an error; nothing was scored.",
        }
        if status == "refused" and result.get("error") == "quota":
            copy["refused"] = "AI help has reached its allowance. Use a saved item if available, read permitted notes, or stop."
        return {
            "ok": True,
            "status": status,
            "request_id": request_id,
            "proposal": proposal,
            "support_rows": (proposal or {}).get("support_rows", []),
            "model_id": result.get("model_id"),
            "copy": copy.get(status, ""),
            "attempt": self.projection.attempts[attempt_id].to_dict(),
        }

    # --- ask (context-aware question) --------------------------------------

    def ask_create(self, params: dict[str, Any]) -> dict[str, Any]:
        from .ask import create_ask

        return create_ask(self, params)

    def ask_get(self, input_id: str) -> dict[str, Any]:
        from .ask import get_ask

        return get_ask(self, input_id)

    def ask_current(self) -> dict[str, Any]:
        from .ask import get_current

        return get_current(self)

    def ask_correct(self, input_id: str, params: dict[str, Any]) -> dict[str, Any]:
        from .ask import correct_ask

        return correct_ask(self, input_id, params)

    def ask_mode(self, input_id: str, session_goal: str) -> dict[str, Any]:
        from .ask import switch_mode

        return switch_mode(self, input_id, session_goal)

    def ask_rank(self, params: dict[str, Any]) -> dict[str, Any]:
        from .ask import rank_for_service

        return rank_for_service(self, params)

    def ask_pending(self) -> dict[str, Any]:
        from .ask import promote_pending

        return promote_pending(self)

    # --- helpers -----------------------------------------------------------

    def _require_attempt(self, attempt_id: str, statuses: tuple[str, ...]) -> AttemptState:
        require_id(attempt_id, "attempt_id")
        attempt = self.projection.attempts.get(attempt_id)
        if attempt is None:
            raise StudyError("not_found", f"unknown attempt {attempt_id}")
        if attempt.status not in statuses:
            raise StudyError("conflict", f"attempt is {attempt.status}; expected one of {statuses}")
        return attempt

    def _packet_item(self, item_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        found = find_item(self.packets, item_id)
        if found is None:
            raise StudyError("not_found", f"item {item_id} is no longer available; restore its packet")
        return found

    def _packet_item_for_attempt(self, attempt: AttemptState) -> tuple[dict[str, Any], dict[str, Any]]:
        """The packet version the attempt started under (immutable snapshot),
        so a later import cannot change what an in-flight answer is graded
        or revealed against (audit A finding 4)."""
        found = find_item(self.packets, attempt.item_id)
        packet_id = found[0]["packet_id"] if found else None
        if packet_id is None:
            for pid, meta in self.projection.packets.items():
                snapshot = load_packet_version(self.user_root, pid, int(meta.get("version") or 0))
                if snapshot and any(i["id"] == attempt.item_id for i in snapshot["items"]):
                    packet_id = pid
                    break
        if packet_id is None:
            raise StudyError("not_found", f"item {attempt.item_id} is no longer available; restore its packet")
        if attempt.packet_version:
            snapshot = load_packet_version(self.user_root, packet_id, attempt.packet_version)
            if snapshot is not None:
                item = next((i for i in snapshot["items"] if i["id"] == attempt.item_id), None)
                if item is not None:
                    return snapshot, item
        if found is None:
            raise StudyError("not_found", f"item {attempt.item_id} is no longer available; restore its packet")
        return found


def _bounded(attempt: dict[str, Any], limit: int = 500) -> dict[str, Any]:
    """Summary view: long drafts/responses are truncated for status listings;
    the full text stays available through `start` (resume) and `history`."""
    out = dict(attempt)
    for key in ("draft", "response"):
        text = str(out.get(key) or "")
        out[f"{key}_chars"] = len(text)
        if len(text) > limit:
            out[key] = text[:limit] + "…"
    return out


def _key_authority(packet: dict[str, Any], item: dict[str, Any]) -> bool:
    """Deterministic credit needs a key whose authority is not a model proposal."""
    if packet.get("provenance") != "model_candidate":
        return True
    validated = (item.get("key") or {}).get("validated_by")
    return validated == "independent_derivation"


def _local_zone_name() -> str:
    try:
        import time as _time

        name = _time.tzname[0]
    except Exception:
        name = ""
    # tzname is an abbreviation, not an IANA zone; prefer the OS link when present.
    try:
        link = os.readlink("/etc/localtime")
        marker = "zoneinfo/"
        if marker in link:
            return link.split(marker, 1)[1]
    except OSError:
        pass
    return "UTC" if not name else "UTC"
