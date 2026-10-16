"""Skill router — load active + provisional SKILL.md bundles.

Anthropic / Hermes / agentskills.io compatible. Every skill MUST declare
``schema_version`` in frontmatter; unsupported versions are refused.

Intent match: explicit trigger metadata, then embedding cosine, then keyword overlap.
Low confidence / ambiguous top-2 is noted for a later small-LLM escalate hedge
(not implemented here).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SUPPORTED_SCHEMA_VERSIONS = frozenset({1})
SKILL_SCHEMA_VERSION = 1

# Cosine thresholds — tune once real routing data exists to tune them against.
COSINE_MIN = 0.32
COSINE_MARGIN = 0.04

# Write-shaped categories always forced to the "reliable" model tier (see
# resolve_model_tier below), regardless of per-skill frontmatter.
WRITE_SKILL_CATEGORIES = frozenset(
    {
        "canvas_submit",
        "canvas_quiz_submit",
        "email_send",
        "rsvp_paid",
        "lti_submit",
        "proctoring_launch",
        "canvas_group",
        "canvas_exam_proctored",
        "calendar_delete",
    }
)

# Judgment, vision, or ConfirmationGuard-adjacent skills. Missing frontmatter
# still pins these; write categories always upgrade to reliable.
RELIABLE_SKILL_IDS = frozenset(
    {
        "student-course-arc",
        "student-instructor-profile",
        "student-assignment-triage",
        "canvas-discussion-facilitator",
        "student-concept-visual",
        "student-photo-intake",
        "student-screen-coach",
        "student-degree-progress",
        "student-course-plan",
    }
)

READ_DRAFT_CATEGORIES = frozenset(
    {
        "canvas_read",
        "canvas_discussion_draft",
        "email_draft",
        "email_triage",
        "photo_intake",
        "audio_capture",
        "calendar",  # creates are reversible; deletes are write
        "rsvp_free",
        "skill_promotion",
    }
)

EmbedFn = Callable[[str], list[float] | None]


@dataclass
class SkillMeta:
    skill_id: str
    name: str
    description: str
    schema_version: int
    category: str
    requires_cloud: bool
    path: Path
    body: str
    model_tier: str = "fast"
    frontmatter: dict[str, Any] = field(default_factory=dict)
    provisional: bool = False

    @property
    def is_write_skill(self) -> bool:
        # An unreviewed provisional skill never gets write tools, whatever
        # category its own frontmatter claims.
        return self.category in WRITE_SKILL_CATEGORIES and not self.provisional


@dataclass
class RouteResult:
    skill: SkillMeta | None
    scores: list[tuple[str, float]]
    ambiguous: bool
    method: str  # structured | embedding | keyword | none
    query_embedding: list[float] | None = None
    model_tier: str | None = None


_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)
_TRIGGERS_RE = re.compile(
    r"^##\s+Triggers?\s*\n(.*?)(?=\n##\s|\Z)",
    re.DOTALL | re.IGNORECASE | re.MULTILINE,
)


def resolve_model_tier(skill_id: str, category: str, frontmatter: dict[str, Any]) -> str:
    """One tier per skill. Write categories always win over frontmatter."""
    if category in WRITE_SKILL_CATEGORIES:
        return "reliable"
    raw = str(frontmatter.get("model_tier") or "").strip().lower()
    if raw in ("fast", "reliable"):
        return raw
    if skill_id in RELIABLE_SKILL_IDS:
        return "reliable"
    return "fast"


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = _FM_RE.match(text)
    if not match:
        return {}, text
    fm: dict[str, Any] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        fm[key.strip()] = val.strip().strip("\"'")
    return fm, match.group(2)


def load_skill(path: Path, *, provisional: bool = False) -> SkillMeta:
    text = path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(text)
    schema_version = int(fm.get("schema_version") or 0)
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(
            f"Unsupported or missing schema_version in {path} "
            f"(got {schema_version!r}, supported={sorted(SUPPORTED_SCHEMA_VERSIONS)})"
        )
    skill_id = path.parent.name
    category = str(fm.get("category") or "canvas_read")
    return SkillMeta(
        skill_id=skill_id,
        name=str(fm.get("name") or skill_id),
        description=str(fm.get("description") or ""),
        schema_version=schema_version,
        category=category,
        requires_cloud=str(fm.get("requires_cloud") or "false").lower()
        in ("1", "true", "yes"),
        path=path,
        body=body,
        model_tier=resolve_model_tier(skill_id, category, fm),
        frontmatter=fm,
        provisional=provisional,
    )


def load_skills(user_root: Path) -> list[SkillMeta]:
    """Load active then provisional skills from the user root."""
    skills: list[SkillMeta] = []
    for rel, provisional in (("skills/active", False), ("skills/provisional", True)):
        root = Path(user_root) / rel
        if not root.is_dir():
            continue
        for skill_md in sorted(root.glob("*/SKILL.md")):
            try:
                skills.append(load_skill(skill_md, provisional=provisional))
            except ValueError:
                continue
    return skills


def load_skills_for_routing(user_root: Path | None = None) -> list[SkillMeta]:
    """Repo-bundled ``skills/`` plus user-root skills.

    A user-root skill with the same id overrides the bundled one; it never
    silently removes every other bundled skill. Provisional skills only add
    new ids — they cannot replace a reviewed (bundled or active) skill.
    """
    bundled: list[SkillMeta] = []
    for skill_md in sorted(bundled_skills_dir().glob("*/SKILL.md")):
        try:
            bundled.append(load_skill(skill_md))
        except ValueError:
            continue
    if user_root is None:
        return bundled
    by_id = {skill.skill_id: skill for skill in bundled}
    for skill in load_skills(user_root):
        if skill.provisional and skill.skill_id in by_id:
            continue
        by_id[skill.skill_id] = skill
    return list(by_id.values())


def skill_doc(skill: SkillMeta) -> str:
    """Text used for embedding / keyword haystack."""
    parts = [skill.name, skill.description, skill.skill_id]
    triggers = _TRIGGERS_RE.search(skill.body or "")
    if triggers:
        parts.append(triggers.group(1).strip())
    return " ".join(p for p in parts if p)


def _item_identity(item: Any) -> str:
    if isinstance(item, SkillMeta):
        return item.skill_id
    if isinstance(item, dict):
        return str(
            item.get("id")
            or item.get("assignment")
            or item.get("name")
            or item.get("course")
            or ""
        )
    return str(item)


def structured_narrow(
    items: list[Any],
    scores: list[tuple[int, Any]],
    *,
    identity: Callable[[Any], str] | None = None,
) -> tuple[Any | None, list[Any]]:
    """Shared structured-filter-first decision (skill routing and inbox slices).

    ``scores`` are ``(hit_count, item)`` for explicit metadata hits only.
    Returns ``(winner, pool)``:

    - unique top score → that item, pool of one (caller must not embed)
    - tied leaders → no winner, pool is the tie
    - no hits → no winner, pool is every item
    """
    if not scores:
        return None, list(items)
    ident = identity or _item_identity
    scored = sorted(scores, key=lambda item: (-item[0], ident(item[1])))
    best = scored[0][0]
    leaders = [item for score, item in scored if score == best]
    if len(leaders) == 1:
        return leaders[0], leaders
    return None, leaders


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b, strict=True):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def embed_rank(
    query: str,
    items: list[Any],
    embedder: EmbedFn,
    text_of: Callable[[Any], str],
    *,
    max_keep: int = 12,
) -> list[Any]:
    """Rank ``items`` by cosine. Callers must not add a second embedding path."""
    if not query.strip() or not items:
        return list(items)
    query_emb = embedder(query)
    if not query_emb:
        return list(items)
    scored: list[tuple[float, Any]] = []
    for item in items:
        emb = embedder(text_of(item))
        if emb is None:
            continue
        scored.append((_cosine(query_emb, emb), item))
    if not scored:
        return list(items)
    scored.sort(key=lambda item: (-item[0], _item_identity(item[1])))
    top = [item for score, item in scored if score > 0][:max_keep]
    return top or list(items)


# Double / curly quotes only — apostrophes in "student's" must not start a quote.
_QUOTE_RE = re.compile(r"""["“”]([^"“”]{2,})["“”]""")


def _normalize_phrase(text: str) -> str:
    text = text.lower().replace("’", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\{[^}]*\}", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _phrase_tokens(phrase: str) -> list[str]:
    cleaned = _normalize_phrase(phrase).strip(" .")
    return [tok for tok in re.findall(r"[a-z0-9']+", cleaned) if tok]


def _phrase_matches(query: str, phrase: str) -> int:
    """Return token length if ``phrase`` appears in ``query``, else 0."""
    tokens = _phrase_tokens(phrase)
    if len(tokens) < 2:
        return 0
    pattern = r"\b" + r"\s+".join(re.escape(tok) for tok in tokens) + r"\b"
    if re.search(pattern, _normalize_phrase(query)):
        return len(tokens)
    return 0


def explicit_trigger_phrases(skill: SkillMeta) -> list[str]:
    """Quoted and bullet phrases from ``## Triggers``, plus quoted description."""
    phrases: list[str] = []
    triggers = _TRIGGERS_RE.search(skill.body or "")
    if triggers:
        for line in triggers.group(1).splitlines():
            stripped = line.strip()
            # Only real trigger bullets — skip handoff prose that may quote
            # another skill's phrases (e.g. task-brief mentioning "brief me on [course]").
            if not re.match(r"^[-*]\s+", stripped):
                continue
            bullet = re.sub(r"^[-*]\s+", "", stripped)
            quoted = _QUOTE_RE.findall(bullet)
            if quoted:
                phrases.extend(quoted)
                continue
            for part in re.split(r"\s+/\s+", bullet):
                part = part.strip(" -")
                if part:
                    phrases.append(part)
    phrases.extend(_QUOTE_RE.findall(skill.description or ""))
    name = (skill.name or "").strip()
    if name:
        phrases.append(name)
    skill_id = skill.skill_id.replace("-", " ")
    if skill_id and skill_id != name.lower():
        phrases.append(skill_id)
    return phrases


def structured_hit_score(skill: SkillMeta, trigger: str) -> int:
    """Specificity score for an explicit metadata hit. 0 means no match."""
    best = 0
    for phrase in explicit_trigger_phrases(skill):
        best = max(best, _phrase_matches(trigger, phrase))
    return best


def _provider_embed(text: str) -> list[float] | None:
    """Fast-tier embeddings. Blank key returns None — no local server."""
    from .llm_provider import get_provider

    return get_provider("fast").embed(text)


# Keyword-path only: tokens that appear in many ## Triggers phrases and
# add noise when double-counted as a trigger-vocab bonus (e.g. "my").
_KEYWORD_BONUS_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "for",
        "in",
        "my",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    }
)

# When second_place / best_score is at or above this ratio, keyword fallback
# refuses to pick a winner (ambiguous). Keyword scores are small integers, so
# this is a relative gap — not the same math as embedding COSINE_MARGIN
# (absolute cosine delta). Tuned to refuse ≤2:1 leads (e.g. 2 vs 1).
KEYWORD_AMBIGUOUS_RATIO = 0.5


def _keyword_scores(skills: list[SkillMeta], trigger: str) -> list[tuple[float, SkillMeta]]:
    """Whole-word overlap against each skill's doc, with a trigger-vocabulary bonus.

    Word-boundary tokens (not substring containment) so e.g. "triage" in the
    query never matches "triages" in unrelated prose. A query word that also
    appears in the skill's *own* explicit trigger phrases (## Triggers
    bullets, quoted description phrases, name/skill_id) counts again as a
    bonus point — a skill that documents a word as an actual trigger should
    outrank one that only mentions the topic in passing description prose.
    Common stopwords are excluded from the bonus so "my" / "the" do not
    inflate every skill that happens to use them in a trigger phrase.
    """
    tokens = _phrase_tokens(trigger)
    scored: list[tuple[float, SkillMeta]] = []
    for skill in skills:
        doc_tokens = set(_phrase_tokens(skill_doc(skill)))
        trigger_tokens: set[str] = set()
        for phrase in explicit_trigger_phrases(skill):
            trigger_tokens.update(_phrase_tokens(phrase))
        base = sum(1 for tok in tokens if tok in doc_tokens)
        bonus = sum(
            1
            for tok in tokens
            if tok in trigger_tokens and tok not in _KEYWORD_BONUS_STOPWORDS
        )
        score = float(base + bonus)
        if score:
            scored.append((score, skill))
    scored.sort(key=lambda x: (-x[0], x[1].skill_id))
    return scored


def filter_candidates(
    skills: list[SkillMeta], *, allow_cloud: bool = False
) -> list[SkillMeta]:
    if allow_cloud:
        return list(skills)
    return [s for s in skills if not s.requires_cloud]


def _with_tier(result: RouteResult) -> RouteResult:
    if result.skill is not None:
        result.model_tier = result.skill.model_tier
    return result


def route_skill(
    skills: list[SkillMeta],
    trigger: str,
    *,
    embedder: EmbedFn | None = None,
    allow_cloud: bool = False,
    cosine_min: float = COSINE_MIN,
    cosine_margin: float = COSINE_MARGIN,
) -> RouteResult:
    """Rank skills: explicit trigger metadata, then embeddings, else keywords."""
    candidates = filter_candidates(skills, allow_cloud=allow_cloud)
    if not candidates or not trigger.strip():
        return RouteResult(None, [], False, "none")

    structured_scores = []
    for skill in candidates:
        score = structured_hit_score(skill, trigger)
        if score:
            structured_scores.append((score, skill))
    winner, pool = structured_narrow(candidates, structured_scores)
    if winner is not None:
        ordered = sorted(
            structured_scores, key=lambda item: (-item[0], item[1].skill_id)
        )
        score_pairs = [(skill.skill_id, float(score)) for score, skill in ordered]
        return _with_tier(RouteResult(winner, score_pairs, False, "structured"))

    embed_fn = embedder if embedder is not None else _provider_embed
    query_emb = embed_fn(trigger)
    if query_emb is not None:
        scored: list[tuple[float, SkillMeta]] = []
        for skill in pool:
            doc_emb = embed_fn(skill_doc(skill))
            if doc_emb is None:
                continue
            scored.append((_cosine(query_emb, doc_emb), skill))
        if scored:
            scored.sort(key=lambda x: (-x[0], x[1].skill_id))
            best_score, best = scored[0]
            second = scored[1][0] if len(scored) > 1 else None
            ambiguous = best_score < cosine_min or (
                second is not None and (best_score - second) < cosine_margin
            )
            score_pairs = [(s.skill_id, float(sc)) for sc, s in scored]
            if ambiguous:
                return _with_tier(
                    RouteResult(None, score_pairs, True, "embedding", query_emb)
                )
            return _with_tier(
                RouteResult(best, score_pairs, False, "embedding", query_emb)
            )

    # Keyword fallback (also used when embeddings unavailable).
    kw = _keyword_scores(pool, trigger)
    if not kw:
        return RouteResult(None, [], False, "none", query_emb)
    score_pairs = [(s.skill_id, float(sc)) for sc, s in kw]
    # Keyword: a close second place is a guess, not a match — see
    # KEYWORD_AMBIGUOUS_RATIO.
    best_score, best = kw[0]
    second_score = kw[1][0] if len(kw) > 1 else None
    ambiguous = second_score is not None and (
        best_score <= 0 or second_score / best_score >= KEYWORD_AMBIGUOUS_RATIO
    )
    if ambiguous:
        return _with_tier(
            RouteResult(None, score_pairs, True, "keyword", query_emb)
        )
    return _with_tier(RouteResult(best, score_pairs, False, "keyword", query_emb))


def select_skill(
    skills: list[SkillMeta],
    trigger: str,
    *,
    embedder: EmbedFn | None = None,
    allow_cloud: bool = False,
    cosine_min: float = COSINE_MIN,
    cosine_margin: float = COSINE_MARGIN,
) -> SkillMeta | None:
    """Select best skill for ``trigger`` (embedding cosine + keyword fallback)."""
    return route_skill(
        skills,
        trigger,
        embedder=embedder,
        allow_cloud=allow_cloud,
        cosine_min=cosine_min,
        cosine_margin=cosine_margin,
    ).skill


def route_intent(
    trigger: str,
    *,
    user_root: Path | None = None,
    allow_cloud: bool = False,
    embedder: EmbedFn | None = None,
) -> RouteResult:
    """First production entry: load skills, route."""
    from .user_root import resolve_user_root

    root = user_root
    if root is None:
        try:
            root = resolve_user_root("dev", create=False)
        except ValueError:
            root = None

    skills = load_skills_for_routing(root)
    result = route_skill(
        skills, trigger, embedder=embedder, allow_cloud=allow_cloud
    )
    return result


def execute_intent(
    trigger: str,
    *,
    user_root: Path | None = None,
    allow_cloud: bool = False,
    embedder: EmbedFn | None = None,
    provider: Any | None = None,
) -> tuple[RouteResult, Any | None]:
    """Route, then run the matched skill through prompt_assembly.chat_assembled."""
    result = route_intent(
        trigger,
        user_root=user_root,
        allow_cloud=allow_cloud,
        embedder=embedder,
    )
    if result.skill is None or user_root is None:
        return result, None
    from .prompt_assembly import run_skill_turn

    chat = run_skill_turn(
        result.skill,
        user_root,
        trigger,
        provider=provider,
        embedder=embedder,
    )
    return result, chat


def bundled_skills_dir() -> Path:
    """Repo-shipped skills/ (copied into user root on onboarding)."""
    return Path(__file__).resolve().parents[3] / "skills"


def main(argv: list[str] | None = None) -> int:
    """CLI entry for the Tauri daemon / palette.

    Usage::

        python -m canvas_mcp.core.skill_router "what should I do first"
        DEV_USER_ROOT=/tmp/pn python -m canvas_mcp.core.skill_router --json "plan my week"
        python -m canvas_mcp.core.skill_router --execute --json "what should I do first"
    """
    import argparse
    import json
    import sys

    from .user_root import resolve_user_root

    parser = argparse.ArgumentParser(description="Route a trigger to a skill id")
    parser.add_argument("trigger", nargs="+", help="User utterance / intent text")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON (skill_id, method, ambiguous, scores)",
    )
    parser.add_argument(
        "--allow-cloud",
        action="store_true",
        help="Include requires_cloud skills",
    )
    parser.add_argument(
        "--user-root",
        type=Path,
        default=None,
        help="Override user root (else DEV_USER_ROOT / default)",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="After routing, run the matched skill through cache-ordered prompt assembly",
    )
    args = parser.parse_args(argv)
    trigger = " ".join(args.trigger).strip()
    root = args.user_root
    if root is None:
        try:
            root = resolve_user_root("dev", create=True)
        except ValueError:
            root = None

    chat = None
    if args.execute:
        if root is None:
            print("user root required to execute", file=sys.stderr)
            return 1
        result, chat = execute_intent(
            trigger,
            user_root=root,
            allow_cloud=args.allow_cloud,
        )
    else:
        result = route_intent(
            trigger,
            user_root=root,
            allow_cloud=args.allow_cloud,
        )
    payload = {
        "skill_id": result.skill.skill_id if result.skill else None,
        "method": result.method,
        "ambiguous": result.ambiguous,
        "scores": result.scores[:8],
        "model_tier": result.model_tier,
    }
    if args.execute:
        payload["content"] = getattr(chat, "content", "") if chat else ""
        payload["error"] = getattr(chat, "error", None) if chat else "unmatched"
    if args.json:
        print(json.dumps(payload))
    elif args.execute:
        print(payload.get("content") or "")
    else:
        print(payload["skill_id"] or "")
    if args.execute:
        failed = result.skill is None or chat is None or getattr(chat, "error", None)
        return 1 if failed else 0
    return 0 if result.skill is not None else 1


if __name__ == "__main__":
    import sys

    sys.exit(main())
