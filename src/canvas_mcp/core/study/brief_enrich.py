"""Explicitly requested AI enrichment for one Mission Control brief (2026-10-15).

Runs only when the student presses "Prepare a fuller brief" — never in the
background, never for an unselected assignment. It sends the minimum: this
assignment's own Canvas text and at most three course materials the brief
already cites. No email, no other courses, no student answers.

The relay's validated proposal is written as an overlay next to the brief
(``{course}--{assignment}--enriched.json``). It never rewrites the brief,
the source truth, or the island order; every section is a proposal; and the
overlay is tied to the brief's source fingerprint, so a changed source hides it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .model import StudyError, write_private_text

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_SOURCES = 3
ASSIGNMENT_CHARS = 6000
SOURCE_CHARS = 3000


def _briefs_dir(user_root: Path) -> Path:
    return user_root / "inbox" / "briefs" / "v1"


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _ids(course_id: str, assignment_id: str) -> None:
    if not ID_RE.match(course_id or "") or not ID_RE.match(assignment_id or ""):
        raise StudyError("validation", "invalid brief id")


def build_sources(user_root: Path, brief: dict[str, Any]) -> list[dict[str, str]]:
    """The assignment's own text first, then up to three cited course materials."""
    record = _load_json(user_root / "inbox" / "study-sources" / f"{brief['course_id']}.json") or {}
    item_id = f"item-{brief['assignment_id']}"
    item = next((i for i in record.get("items") or [] if i.get("id") == item_id), None)
    out: list[dict[str, str]] = []
    if item and str(item.get("description") or "").strip():
        out.append({"locator": f"Canvas: {str(item.get('title') or '')[:150]}", "text": str(item["description"])[:ASSIGNMENT_CHARS]})
    cited = {e.get("label") for e in brief.get("evidence") or [] if e.get("kind") == "course_source"}
    for source in record.get("sources") or []:
        if len(out) >= MAX_SOURCES + 1:
            break
        if source.get("title") in cited and str(source.get("text") or "").strip():
            out.append({"locator": str(source.get("title"))[:200], "text": str(source["text"])[:SOURCE_CHARS]})
    return out


def enrich(user_root: Path, course_id: str, assignment_id: str, *, session_budget_id: str, attempt: int = 1, dispatch: Any = None) -> dict[str, Any]:
    from . import ai

    _ids(course_id, assignment_id)
    brief = _load_json(_briefs_dir(user_root) / f"{course_id}--{assignment_id}.json")
    if not isinstance(brief, dict):
        raise StudyError("not_found", "no brief for that assignment")
    if brief.get("state") == "needs_source":
        raise StudyError("validation", "add sources first; there is too little to prepare from")
    sources = build_sources(user_root, brief)
    if not sources:
        raise StudyError("validation", "add sources first; there is too little to prepare from")
    fingerprint = str(brief.get("source_fingerprint") or "")
    # Stable per brief version: a retry after a timeout replays, never re-bills.
    request_id = f"brief:{course_id}--{assignment_id}:{fingerprint[:16]}:{int(attempt)}"
    request = ai.build_request(
        request_id=request_id,
        session_budget_id=session_budget_id,
        purpose="brief",
        sources=sources,
        stem=f"Assignment: {str(brief.get('title') or '')[:200]} ({brief.get('kind')}). Due: {brief.get('due_at') or 'not in Canvas'}.",
        rubric="Known requirements:\n" + "\n".join(f"- {r}" for r in (brief.get("requirements") or [])[:12]),
        submitted_answer="",
    )
    result = (dispatch or ai.dispatch)(user_root, request)
    status = str(result.get("status") or "failed")
    proposal = result.get("brief_proposal") if status in ("complete", "abstained") else None
    overlay = validate_overlay(proposal, fingerprint=fingerprint, prepared_at=str(result.get("prepared_at") or _now()))
    if overlay is None:
        return {"ok": True, "status": status if status != "complete" else "malformed", "enrichment": None, "request_id": request_id}
    write_private_text(_briefs_dir(user_root) / f"{course_id}--{assignment_id}--enriched.json", json.dumps(overlay, indent=2))
    return {"ok": True, "status": status, "enrichment": overlay, "request_id": request_id}


def validate_overlay(proposal: Any, *, fingerprint: str, prepared_at: str) -> dict[str, Any] | None:
    """Same bounds as the brief schema; anything off-shape is dropped, not trusted."""
    if not isinstance(proposal, dict):
        return None
    sections = proposal.get("sections")
    if not isinstance(sections, list) or len(sections) > 5:
        return None
    clean = []
    for i, s in enumerate(sections):
        if not isinstance(s, dict) or not isinstance(s.get("title"), str) or not isinstance(s.get("body"), str):
            return None
        sid = re.sub(r"[^A-Za-z0-9_-]", "-", str(s.get("id") or f"ai-{i}"))[:64]
        clean.append({"id": sid, "title": s["title"][:120], "body": s["body"][:1500], "proposal": True, "evidence_ids": []})
    gaps = [str(g)[:160] for g in proposal.get("gaps") or [] if isinstance(g, (str, int, float))][:6]
    if not clean:
        gaps = gaps or ["The sources were too thin for a fuller brief"]
    return {
        "prepared_at": prepared_at,
        "source_fingerprint": fingerprint,
        "state": "ready" if clean and not gaps else "partial",
        "sections": clean,
        "gaps": gaps,
    }


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
