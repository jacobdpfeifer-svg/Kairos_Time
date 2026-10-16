"""Cache-ordered prompt assembly for one skill turn.

Stable prefix first so hosted providers can cache overlapping context:

1. Tool schemas (frozen for the session; identical across turns)
2. System: skill instructions + shared session boot
3. Learning profile (stable per student)
4. Volatile last: this turn's inbox slice (teaching skills also get a teach-hint,
   a brief-streak line when one is open, at most two due learn-loop reviews,
   and a per-course retention tally when claims exist)

``run_skill_turn`` is the only skill-turn entry. It assembles, then
``chat_assembled`` is the only path that may call ``LLMProvider.chat``.
This module does not implement a provider.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .dates import parse_day
from .habit import streak_payload
from .learn_loop import (
    render_coverage_clock,
    render_due_reviews,
    render_progress,
    surfaces_due_reviews,
)
from .learning_profile import _render_user_md_block, load_learning_profile
from .llm_provider import ChatMessage, ToolSpec, provider_for_skill
from .skill_router import (
    EmbedFn,
    SkillMeta,
    bundled_skills_dir,
    embed_rank,
    structured_narrow,
)
from .teach_hint import is_teaching_skill, render_teach_hint
from .untrusted_content import fence_untrusted


class _ChatProvider(Protocol):
    def chat(
        self, messages: list[ChatMessage], tools: list[ToolSpec] | None = None
    ) -> Any: ...


_WRITE_TOOL_NAMES = frozenset(
    {
        "submit_assignment",
        "post_discussion_entry",
        "reply_to_discussion_entry",
        "comment_on_my_submission",
        "mark_module_item_done",
        "mark_conversations_read",
    }
)

_COURSE_RE = re.compile(r"\b([A-Za-z]{2,8})\s*-?\s*(\d{3,5}[A-Za-z]?)\b")
_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_TYPE_RE = re.compile(
    r"(?:type:|(?<=\s))(quiz|discussion_topic|discussion|assignment|calendar_event)\b",
    re.IGNORECASE,
)
_OUTCOME_RE = re.compile(r"\boutcome:([a-z_]+)\b", re.IGNORECASE)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MANIFEST = _REPO_ROOT / "tools" / "TOOL_MANIFEST.json"
_SCHEMAS = _REPO_ROOT / "tools" / "TOOL_INPUT_SCHEMAS.json"
_EMPTY_SCHEMA: dict[str, Any] = {"type": "object", "properties": {}}


class ToolListChanged(RuntimeError):
    """Tool schemas changed mid-session; that busts the cached prefix."""


@dataclass(frozen=True)
class MetaQuery:
    course: str | None = None
    due_on_or_before: str | None = None
    assignment_type: str | None = None
    outcome: str | None = None

    @property
    def has_constraint(self) -> bool:
        return any(
            (self.course, self.due_on_or_before, self.assignment_type, self.outcome)
        )


@dataclass
class AssembledTurn:
    tools: list[ToolSpec]
    tools_hash: str
    messages: list[ChatMessage]
    system: str
    profile: str
    volatile: str
    prefix: str
    method: str

    def rendered(self) -> str:
        return f"{self.prefix}\n<!-- cache:volatile -->\n{self.volatile}"


@dataclass
class ToolSession:
    """Freeze the tool list the first time a skill category is assembled."""

    _hashes: dict[str, str] = field(default_factory=dict)

    def freeze(self, key: str, tools: list[ToolSpec]) -> str:
        digest = tools_hash(tools)
        prior = self._hashes.get(key)
        if prior is not None and prior != digest:
            raise ToolListChanged(
                f"tool list for {key} changed mid-session ({prior} -> {digest})"
            )
        self._hashes[key] = digest
        return digest


def tools_hash(tools: list[ToolSpec]) -> str:
    payload = [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
        for tool in tools
    ]
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def load_manifest_tools() -> list[dict[str, Any]]:
    raw = json.loads(_MANIFEST.read_text(encoding="utf-8"))
    tools = raw.get("tools") or []
    return [item for item in tools if isinstance(item, dict) and item.get("name")]


def load_frozen_schemas() -> dict[str, dict[str, Any]]:
    """Frozen input schemas. Never call live ``list_tools`` at assembly time."""
    raw = json.loads(_SCHEMAS.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return {}
    return {
        str(name): schema
        for name, schema in raw.items()
        if isinstance(schema, dict)
    }


def _schema_for(name: str, schemas: dict[str, dict[str, Any]]) -> dict[str, Any]:
    schema = schemas.get(name)
    if not isinstance(schema, dict) or schema.get("type") != "object":
        return dict(_EMPTY_SCHEMA)
    return schema


def tools_for_skill(skill: SkillMeta) -> list[ToolSpec]:
    """Deterministic tool schemas for a skill. Never live ``list_tools``."""
    schemas = load_frozen_schemas()
    selected = []
    for item in load_manifest_tools():
        name = str(item["name"])
        category = str(item.get("category") or "")
        if not skill.is_write_skill and (
            category == "student_write" or name in _WRITE_TOOL_NAMES
        ):
            continue
        selected.append(item)
    selected.sort(key=lambda item: str(item["name"]))
    return [
        ToolSpec(
            name=str(item["name"]),
            description=str(item.get("description") or ""),
            parameters=_schema_for(str(item["name"]), schemas),
        )
        for item in selected
    ]


def _norm_course(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def extract_meta_query(text: str) -> MetaQuery:
    course = None
    match = _COURSE_RE.search(text or "")
    if match:
        course = f"{match.group(1)}{match.group(2)}"
    due = None
    date = _DATE_RE.search(text or "")
    if date:
        due = date.group(1)
    assignment_type = None
    type_match = _TYPE_RE.search(text or "")
    if type_match:
        assignment_type = type_match.group(1).lower()
    outcome = None
    outcome_match = _OUTCOME_RE.search(text or "")
    if outcome_match:
        outcome = outcome_match.group(1).lower()
    return MetaQuery(
        course=course,
        due_on_or_before=due,
        assignment_type=assignment_type,
        outcome=outcome,
    )


def _parse_md_table(text: str) -> list[dict[str, str]]:
    headers: list[str] | None = None
    rows: list[dict[str, str]] = []
    # Split on "\n" only, like the Rust (str::lines) and JS readers of the same
    # file: str.splitlines() also breaks on \r, \v, \f, \x1c-\x1e, \x85,
    # U+2028/9, so a Canvas title carrying one would hide its row from the
    # model while the app still lists it (finding F1).
    for line in text.split("\n"):
        if not line.strip().startswith("|"):
            headers = None
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or all(set(cell) <= set("-: ") for cell in cells):
            continue
        if headers is None:
            headers = [cell.lower() for cell in cells]
            continue
        if len(cells) < len(headers):
            continue
        rows.append({headers[i]: cells[i] for i in range(len(headers))})
    return rows


def _row_text(row: dict[str, str]) -> str:
    return " ".join(
        row.get(key, "")
        for key in ("course", "assignment", "name", "due", "type", "notes", "outcome")
    )


def _metadata_hits(row: dict[str, str], query: MetaQuery, default_year: int | None = None) -> int:
    if not query.has_constraint:
        return 0
    hits = 0
    course = _norm_course(row.get("course", ""))
    notes = row.get("notes", "")
    outcome = (row.get("outcome") or "").lower()
    if not outcome:
        found = _OUTCOME_RE.search(notes)
        if found:
            outcome = found.group(1).lower()
    if query.course and _norm_course(query.course) in course:
        hits += 1
    if query.due_on_or_before:
        due = parse_day(row.get("due"), default_year=default_year)
        if due and due.isoformat() <= query.due_on_or_before:
            hits += 1
    if query.assignment_type:
        typ = (row.get("type") or "").lower()
        if query.assignment_type in typ or query.assignment_type in notes.lower():
            hits += 1
    if query.outcome and query.outcome in outcome:
        hits += 1
    return hits


_UPDATED_RE = re.compile(r"^Updated:\s*(\S.*?)\s*$", re.M)
# Characters other readers treat as line breaks; a rendered cell stays one line.
_LINE_BREAKS_RE = re.compile("[\r\v\f\x1c-\x1e\x85\u2028\u2029]")


def _render_rows(
    rows: list[dict[str, str]], *, title: str, updated: str | None = None
) -> str:
    # The week's Updated: line rides with the slice so the _SESSION.md
    # "older than 2 days → sync" rule is checkable without the full file.
    head = [f"## {title}", ""] + ([f"Updated: {updated}", ""] if updated else [])
    if not rows:
        return "\n".join(head) + "\n(none)\n"
    headers = list(rows[0].keys())
    lines = [
        *head,
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_LINE_BREAKS_RE.sub(" ", row.get(header, "")) for header in headers) + " |")
    return "\n".join(lines) + "\n"


def select_inbox_slice(
    week_md: str,
    trigger: str,
    *,
    catalog_md: str | None = None,
    embedder: EmbedFn | None = None,
    course: str | None = None,
) -> tuple[str, str]:
    """Pick the week/catalog rows for this turn.

    Uses :func:`structured_narrow` (the same helper skill routing can use).
    Embeddings run only when that helper does not narrow the set.
    """
    query = extract_meta_query(trigger)
    if course and not query.course:
        query = MetaQuery(
            course=course,
            due_on_or_before=query.due_on_or_before,
            assignment_type=query.assignment_type,
            outcome=query.outcome,
        )
    updated = _UPDATED_RE.search(week_md or "")
    default_year = None
    if updated:
        year_match = re.match(r"(\d{4})", updated.group(1))
        default_year = int(year_match.group(1)) if year_match else None
    week_rows = _parse_md_table(week_md)
    picked, method = _narrow_rows(
        week_rows, trigger, query, embedder=embedder, default_year=default_year
    )
    parts = [
        _render_rows(
            picked, title="Inbox slice", updated=updated.group(1) if updated else None
        )
    ]
    if catalog_md:
        catalog_rows = _parse_md_table(catalog_md)
        if query.course:
            for row in catalog_rows:
                row.setdefault("course", query.course)
        catalog_picked, _catalog_method = _narrow_rows(
            catalog_rows, trigger, query, embedder=embedder
        )
        parts.append(_render_rows(catalog_picked, title="Catalog slice"))
    return "\n".join(parts), method


def _narrow_rows(
    rows: list[dict[str, str]],
    trigger: str,
    query: MetaQuery,
    *,
    embedder: EmbedFn | None,
    default_year: int | None = None,
) -> tuple[list[dict[str, str]], str]:
    scores = [
        (hits, row)
        for row in rows
        if (hits := _metadata_hits(row, query, default_year))
    ]
    winner, pool = structured_narrow(rows, scores)
    narrowed = bool(scores) and (winner is not None or len(pool) < len(rows))
    if narrowed:
        return pool, "metadata"
    if embedder is None:
        return list(rows), "unfiltered"
    ranked = embed_rank(trigger, rows, embedder, _row_text)
    if ranked == rows:
        return list(rows), "unfiltered"
    return ranked, "embedding"


def load_catalog_for_trigger(user_root: Path, trigger: str) -> str | None:
    """Read ``inbox/courses/CODE.md`` when the trigger names a course.

    Basename match on the normalized course code. Missing file means no
    catalog slice — callers must not stitch inbox text into a prompt.
    """
    query = extract_meta_query(trigger)
    if not query.course:
        return None
    courses = Path(user_root) / "inbox" / "courses"
    if not courses.is_dir():
        return None
    needle = _norm_course(query.course)
    for path in sorted(courses.glob("*.md")):
        if path.name.startswith("_"):
            continue
        if _norm_course(path.stem) == needle:
            return path.read_text(encoding="utf-8", errors="replace")
    return None


def session_boot_text() -> str:
    path = bundled_skills_dir() / "_SESSION.md"
    return path.read_text(encoding="utf-8", errors="replace")


def assemble_turn(
    skill: SkillMeta,
    user_root: Path,
    trigger: str,
    *,
    week_md: str | None = None,
    catalog_md: str | None = None,
    session: ToolSession | None = None,
    embedder: EmbedFn | None = None,
) -> AssembledTurn:
    """Build the cache-ordered prompt for one skill invocation."""
    tools = tools_for_skill(skill)
    holder = session if session is not None else ToolSession()
    digest = holder.freeze(skill.category, tools)

    system = (
        "<!-- cache:system -->\n"
        f"# Skill: {skill.skill_id}\n\n"
        f"{skill.body.strip()}\n\n"
        f"{session_boot_text().strip()}\n"
    )
    profile_block = _render_user_md_block(load_learning_profile(user_root)).strip()
    profile = f"<!-- cache:profile -->\n{profile_block}\n"

    if week_md is None:
        week_path = Path(user_root) / "inbox" / "week.md"
        week_md = week_path.read_text(encoding="utf-8", errors="replace") if week_path.is_file() else ""
    canvas_slice, method = select_inbox_slice(
        week_md,
        trigger,
        catalog_md=catalog_md,
        embedder=embedder,
    )
    # Week rows and catalog text are Canvas-authored (titles, notes): fence
    # them as data so an assignment titled "SYSTEM: …" is not read as an
    # instruction in the student's own turn (finding F2). Kairos's own hint,
    # review and progress lines are added outside the fence.
    volatile = (
        fence_untrusted(canvas_slice.strip(), "Canvas week rows and course catalog")
        if canvas_slice.strip()
        else ""
    )
    if is_teaching_skill(skill.skill_id):
        hint = render_teach_hint(
            user_root,
            trigger,
            canvas_slice,
            catalog_md=catalog_md,
        )
        if hint.strip():
            volatile = f"{hint.strip()}\n\n{volatile.strip()}"
        streak_line = str(streak_payload(user_root).get("line") or "")
        if streak_line:
            volatile = f"{streak_line}\n\n{volatile.strip()}"
        from .progress import trail_payload

        trail_line = str(trail_payload(user_root).get("line") or "")
        if trail_line:
            volatile = f"{trail_line}\n\n{volatile.strip()}"
    if surfaces_due_reviews(skill.skill_id):
        reviews = render_due_reviews(user_root, week_md=week_md)
        coverage = render_coverage_clock(user_root, week_md=week_md)
        lead_parts = [part.strip() for part in (coverage, reviews) if part.strip()]
        if is_teaching_skill(skill.skill_id):
            progress = render_progress(user_root)
            if progress.strip():
                lead_parts.append(progress.strip())
        if lead_parts:
            volatile = "\n\n".join(lead_parts) + f"\n\n{volatile.strip()}"
    volatile = f"<!-- cache:volatile -->\n{volatile.strip()}\n"

    tools_blob = json.dumps(
        [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            }
            for tool in tools
        ],
        sort_keys=True,
    )
    prefix = f"<!-- cache:tools -->\n{tools_blob}\n{system}\n{profile}"
    messages = [
        ChatMessage(role="system", content=system),
        ChatMessage(role="system", content=profile, cache_breakpoint=True),
        ChatMessage(role="user", content=f"{trigger.strip()}\n\n{volatile}"),
    ]
    return AssembledTurn(
        tools=tools,
        tools_hash=digest,
        messages=messages,
        system=system,
        profile=profile,
        volatile=volatile,
        prefix=prefix,
        method=method,
    )


def chat_assembled(provider: _ChatProvider, turn: AssembledTurn) -> Any:
    """Only supported call into ``LLMProvider.chat`` for skill turns."""
    return provider.chat(turn.messages, turn.tools)


def chat_skill(skill: SkillMeta, turn: AssembledTurn) -> Any:
    """Resolve the provider once for this skill call. Do not re-resolve mid-turn."""
    provider = provider_for_skill(skill)
    return chat_assembled(provider, turn)


def run_skill_turn(
    skill: SkillMeta,
    user_root: Path,
    trigger: str,
    *,
    provider: _ChatProvider | None = None,
    session: ToolSession | None = None,
    embedder: EmbedFn | None = None,
    week_md: str | None = None,
    catalog_md: str | None = None,
) -> Any:
    """Assemble one skill turn and send it. The only production chat entry."""
    if catalog_md is None:
        catalog_md = load_catalog_for_trigger(user_root, trigger)
    turn = assemble_turn(
        skill,
        user_root,
        trigger,
        week_md=week_md,
        catalog_md=catalog_md,
        session=session,
        embedder=embedder,
    )
    if provider is None:
        return chat_skill(skill, turn)
    return chat_assembled(provider, turn)
