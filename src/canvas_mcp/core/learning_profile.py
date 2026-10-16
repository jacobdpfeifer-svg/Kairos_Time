"""Learning profile — priors for *how* the agent should teach this student.

Canonical home: ``calibration/learning-profile.yaml`` owns state and signal
counters. ``USER.md``'s "## Learning profile" section is a rendered,
human-readable summary only — always go through :func:`save_learning_profile`
rather than hand-editing that section; it is overwritten on every save.

Fields are functional teaching levers, not personality labels. There is no
visual/auditory/kinesthetic axis here on purpose — see
``docs/design/learning-profile.md`` for the research this schema is built on.
``practice_format`` is a start bias only (example then retrieve, or retrieve
first). It never skips retrieval or the scheduled check in ``learn_loop``.
Every field starts as a cheap onboarding-game guess (``source:
onboarding_game``) and is expected to be overridden by real format-specific
feedback (``source: observed``) via :func:`record_signal` — the same
self-correcting shape as ``permissions.py``'s k-success counters.
Do **not** wire deleted skill-route RequestLog accept/veto here
(``self_improve`` package removed; canvas-focus pivot).
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, cast

import yaml

PracticeFormat = Literal["worked_example", "retrieval"]
Autonomy = Literal["directive", "choices"]
ChunkSize = Literal["short", "long"]
CheckDepth = Literal["light", "thorough"]
Source = Literal["default", "onboarding_game", "observed"]

LEARNING_PROFILE_SCHEMA_VERSION = 1

FIELD_VALUES: dict[str, tuple[str, ...]] = {
    "practice_format": ("worked_example", "retrieval"),
    "autonomy": ("directive", "choices"),
    "chunk_size": ("short", "long"),
    "check_depth": ("light", "thorough"),
}

DEFAULTS: dict[str, str] = {
    "practice_format": "worked_example",
    "autonomy": "choices",
    "chunk_size": "short",
    "check_depth": "thorough",
}

PROFILE_FIELDS = (
    "practice_format",
    "autonomy",
    "chunk_size",
    "check_depth",
)

# Net lead (this value's count minus the runner-up's) needed before a field
# flips from its onboarding-game guess to an observed value.
OBSERVED_SIGNAL_THRESHOLD = 3

_USER_MD_HEADING = "## Learning profile"
_REPO_ROOT = Path(__file__).resolve().parents[3]
_USER_MD_TEMPLATE = _REPO_ROOT / "templates" / "USER.md"

_FIELD_LABELS: dict[str, str] = {
    "practice_format": "Start bias",
    "autonomy": "Autonomy",
    "chunk_size": "Chunk size",
    "check_depth": "Check depth",
}

_VALUE_COPY: dict[str, dict[str, str]] = {
    "practice_format": {
        "worked_example": "start with a worked example, then retrieve",
        "retrieval": "start with retrieval, then feedback (retrieval still required)",
    },
    "autonomy": {
        "directive": "tell them the next step directly",
        "choices": "offer options, let them choose",
    },
    "chunk_size": {
        "short": "short bursts (Top-3 style)",
        "long": "one longer session",
    },
    "check_depth": {
        "light": "trust and proceed; skip stacked confirmations",
        "thorough": "one confirmation / self-check before moving on",
    },
}


@dataclass
class LearningProfile:
    schema_version: int = LEARNING_PROFILE_SCHEMA_VERSION
    practice_format: PracticeFormat = "worked_example"
    practice_format_source: Source = "default"
    autonomy: Autonomy = "choices"
    autonomy_source: Source = "default"
    chunk_size: ChunkSize = "short"
    chunk_size_source: Source = "default"
    check_depth: CheckDepth = "thorough"
    check_depth_source: Source = "default"
    # Student's own start line. Not a teaching lever and not a learner-type field.
    if_then: str = ""
    updated_at: str | None = None
    # signal_counts[field][value] = net tally from record_signal; internal
    # bookkeeping only, never rendered into USER.md.
    signal_counts: dict[str, dict[str, int]] = field(default_factory=dict)

    def value_of(self, field_name: str) -> str:
        return str(getattr(self, field_name))

    def source_of(self, field_name: str) -> str:
        return str(getattr(self, f"{field_name}_source"))

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "practice_format": self.practice_format,
            "practice_format_source": self.practice_format_source,
            "autonomy": self.autonomy,
            "autonomy_source": self.autonomy_source,
            "chunk_size": self.chunk_size,
            "chunk_size_source": self.chunk_size_source,
            "check_depth": self.check_depth,
            "check_depth_source": self.check_depth_source,
            "if_then": self.if_then,
            "updated_at": self.updated_at,
            "signal_counts": {
                k: dict(v) for k, v in self.signal_counts.items()
            },
        }


def default_learning_profile() -> LearningProfile:
    return LearningProfile()


def _safe_choice(value: Any, field_name: str, fallback: str) -> str:
    text = str(value) if value is not None else fallback
    return text if text in FIELD_VALUES[field_name] else fallback


def _safe_source(value: Any, fallback: str = "default") -> str:
    text = str(value) if value is not None else fallback
    return text if text in ("default", "onboarding_game", "observed") else fallback


def _clean_if_then(value: Any) -> str:
    """Keep a short start line. Empty stays empty; never infer one."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text[:180]


def _parse(raw: dict[str, Any]) -> LearningProfile:
    base = default_learning_profile()
    counts: dict[str, dict[str, int]] = {}
    raw_counts = raw.get("signal_counts")
    if isinstance(raw_counts, dict):
        for fname, values in raw_counts.items():
            if fname not in FIELD_VALUES or not isinstance(values, dict):
                continue
            counts[fname] = {}
            for val, n in values.items():
                if val not in FIELD_VALUES[fname]:
                    continue
                try:
                    counts[fname][val] = max(0, int(n))
                except (TypeError, ValueError):
                    continue

    return LearningProfile(
        schema_version=LEARNING_PROFILE_SCHEMA_VERSION,
        practice_format=cast(PracticeFormat, _safe_choice(
            raw.get("practice_format"), "practice_format", base.practice_format
        )),
        practice_format_source=cast(Source, _safe_source(raw.get("practice_format_source"))),
        autonomy=cast(Autonomy, _safe_choice(raw.get("autonomy"), "autonomy", base.autonomy)),
        autonomy_source=cast(Source, _safe_source(raw.get("autonomy_source"))),
        chunk_size=cast(ChunkSize, _safe_choice(
            raw.get("chunk_size"), "chunk_size", base.chunk_size
        )),
        chunk_size_source=cast(Source, _safe_source(raw.get("chunk_size_source"))),
        check_depth=cast(CheckDepth, _safe_choice(
            raw.get("check_depth"), "check_depth", base.check_depth
        )),
        check_depth_source=cast(Source, _safe_source(raw.get("check_depth_source"))),
        if_then=_clean_if_then(raw.get("if_then")),
        updated_at=raw.get("updated_at") if isinstance(raw.get("updated_at"), str) else None,
        signal_counts=counts,
    )


def _profile_path(user_root: Path) -> Path:
    return Path(user_root) / "calibration" / "learning-profile.yaml"


def load_learning_profile(user_root: Path) -> LearningProfile:
    path = _profile_path(user_root)
    if not path.is_file():
        profile = default_learning_profile()
        save_learning_profile(user_root, profile)
        return profile
    with path.open(encoding="utf-8", errors="replace") as fh:
        raw = yaml.safe_load(fh) or {}
    if not isinstance(raw, dict):
        return default_learning_profile()
    return _parse(raw)


def _render_user_md_block(profile: LearningProfile) -> str:
    lines = [
        _USER_MD_HEADING,
        "",
        "_Start bias and initiation levers — not a learner type. Retrieval is still required for teachable work; a fluent pass is not mastery._",
        "",
    ]
    for fname in PROFILE_FIELDS:
        value = profile.value_of(fname)
        source = profile.source_of(fname)
        copy = _VALUE_COPY[fname].get(value, value)
        lines.append(f"- **{_FIELD_LABELS[fname]}:** {copy} _(source: {source})_")
    if profile.if_then:
        lines.append(f"- **When I start:** {profile.if_then}")
    if profile.updated_at:
        lines.append("")
        lines.append(f"_Last updated: {profile.updated_at}_")
    return "\n".join(lines) + "\n"


def _seed_user_md_if_missing(user_md: Path) -> None:
    """Onboarding may save the profile before USER.md exists.

    Skills read the Learning profile from USER.md (not the YAML), so seed from
    the repo template when missing. If the template is unavailable (packaged
    install without templates/), write a minimal stub that still has the
    heading the renderer can replace.
    """
    if user_md.is_file():
        return
    user_md.parent.mkdir(parents=True, exist_ok=True)
    if _USER_MD_TEMPLATE.is_file():
        user_md.write_text(_USER_MD_TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        user_md.write_text(f"# USER.md\n\n{_USER_MD_HEADING}\n\n", encoding="utf-8")


def _update_user_md(user_root: Path, block: str) -> None:
    user_md = Path(user_root) / "USER.md"
    _seed_user_md_if_missing(user_md)
    text = user_md.read_text(encoding="utf-8", errors="replace")
    heading_idx = text.find(_USER_MD_HEADING)
    if heading_idx == -1:
        sep = "" if text.endswith("\n") else "\n"
        text = f"{text}{sep}\n{block}"
    else:
        next_idx = text.find("\n## ", heading_idx + len(_USER_MD_HEADING))
        before = text[:heading_idx]
        after = text[next_idx:] if next_idx != -1 else ""
        text = f"{before}{block}{after}"
    user_md.write_text(text, encoding="utf-8")


def save_learning_profile(user_root: Path, profile: LearningProfile) -> Path:
    path = _profile_path(user_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(profile.to_dict(), fh, sort_keys=False, allow_unicode=True)
    _update_user_md(user_root, _render_user_md_block(profile))
    return path


def apply_onboarding_answers(
    user_root: Path,
    *,
    practice_format: PracticeFormat,
    autonomy: Autonomy,
    chunk_size: ChunkSize,
    check_depth: CheckDepth = "thorough",
    if_then: str = "",
) -> LearningProfile:
    """Write the onboarding games' results as fresh, resettable priors."""
    now = datetime.now(timezone.utc).isoformat()
    profile = LearningProfile(
        practice_format=cast(PracticeFormat, _safe_choice(
            practice_format, "practice_format", DEFAULTS["practice_format"]
        )),
        practice_format_source="onboarding_game",
        autonomy=cast(Autonomy, _safe_choice(autonomy, "autonomy", DEFAULTS["autonomy"])),
        autonomy_source="onboarding_game",
        chunk_size=cast(ChunkSize, _safe_choice(chunk_size, "chunk_size", DEFAULTS["chunk_size"])),
        chunk_size_source="onboarding_game",
        check_depth=cast(CheckDepth, _safe_choice(
            check_depth, "check_depth", DEFAULTS["check_depth"]
        )),
        check_depth_source="onboarding_game",
        if_then=_clean_if_then(if_then),
        updated_at=now,
    )
    save_learning_profile(user_root, profile)
    return profile


@dataclass
class CompactSummary:
    applied: int
    skipped: int


def _parse_since(value: datetime | str | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def compact_from_ledger(
    user_root: Path,
    since: datetime | str | None = None,
) -> CompactSummary:
    """Apply explicit ledger ``learning_signal`` rows onto the profile.

    Append-only ledger is not rewritten. Only rows with
    ``learning_signal: {field, value, delta?}`` are applied, via
    :func:`record_signal` — never inferred from skill/outcome/why.
    Not a CLI, daemon, Tauri, or request-path caller.

    Default ``since`` is the persisted
    ``.learning_profile_compact_watermark`` (unix timestamp). After a
    successful pass the watermark advances to the max processed row ``ts``.
    Explicit ``since`` still overrides. Do not schedule unattended until
    something writes ``learning_signal`` rows.
    """
    from .ledger import Ledger
    from .watermark import LEARNING_PROFILE_COMPACT, read_watermark, write_watermark

    explicit = since is not None and since != ""
    if explicit:
        cutoff = _parse_since(since)
    else:
        wm = read_watermark(user_root, LEARNING_PROFILE_COMPACT)
        cutoff = (
            datetime.fromtimestamp(wm, tz=timezone.utc) if wm is not None else None
        )

    applied = 0
    skipped = 0
    max_ts: float | None = None
    for row in Ledger(user_root).read_all():
        ts = _parse_since(row.get("ts"))
        if cutoff is not None:
            # Watermark / since: process rows strictly after the cutoff.
            if ts is None or ts <= cutoff:
                skipped += 1
                continue
        signal = row.get("learning_signal")
        if not isinstance(signal, dict):
            skipped += 1
            if ts is not None:
                max_ts = ts.timestamp() if max_ts is None else max(max_ts, ts.timestamp())
            continue
        field_name = signal.get("field")
        value = signal.get("value")
        delta = signal.get("delta", 1)
        if (
            not isinstance(field_name, str)
            or not isinstance(value, str)
            or not isinstance(delta, int)
        ):
            skipped += 1
            if ts is not None:
                max_ts = ts.timestamp() if max_ts is None else max(max_ts, ts.timestamp())
            continue
        try:
            record_signal(user_root, field_name, value, delta=delta)
        except ValueError:
            skipped += 1
            if ts is not None:
                max_ts = ts.timestamp() if max_ts is None else max(max_ts, ts.timestamp())
            continue
        applied += 1
        if ts is not None:
            max_ts = ts.timestamp() if max_ts is None else max(max_ts, ts.timestamp())

    if max_ts is not None:
        write_watermark(user_root, LEARNING_PROFILE_COMPACT, max_ts)
    return CompactSummary(applied=applied, skipped=skipped)


def record_signal(
    user_root: Path,
    field_name: str,
    value: str,
    *,
    delta: int = 1,
) -> LearningProfile:
    """Nudge a field from format-specific feedback; may flip it to 'observed'.

    Call from a skill (or CLI ``signal``) only when the teaching *format* that
    was just used is known — never from raw skill-route accept/veto.
    """
    if field_name not in FIELD_VALUES or value not in FIELD_VALUES[field_name]:
        raise ValueError(f"Unknown field/value: {field_name}={value!r}")

    profile = load_learning_profile(user_root)
    profile = deepcopy(profile)
    counts = profile.signal_counts.setdefault(field_name, {})
    counts[value] = max(0, counts.get(value, 0) + delta)

    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    top_value, top_count = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    if (
        top_value != profile.value_of(field_name)
        and (top_count - runner_up) >= OBSERVED_SIGNAL_THRESHOLD
    ):
        setattr(profile, field_name, top_value)
        setattr(profile, f"{field_name}_source", "observed")
        profile.updated_at = datetime.now(timezone.utc).isoformat()

    save_learning_profile(user_root, profile)
    return profile


def main(argv: list[str] | None = None) -> int:
    """CLI entry for Tauri onboarding + skill feedback.

    Usage::

        python -m canvas_mcp.core.learning_profile save \\
            --practice-format retrieval --autonomy directive \\
            --chunk-size long --check-depth thorough \\
            --if-then "When I open the dock, I do the 2-minute check first."

        python -m canvas_mcp.core.learning_profile signal \\
            --field practice_format --value retrieval --delta 1

        DEV_USER_ROOT=/tmp/pn python -m canvas_mcp.core.learning_profile show --json

    ``compact_from_ledger`` uses a watermark
    (``.learning_profile_compact_watermark``) for idempotent replay but is
    deliberately not exposed here yet — add a ``compact`` CLI subcommand only
    once ``learning_signal`` writers exist (Prompt E). Call it directly from
    Python until then.
    """
    import argparse
    import json

    from .user_root import resolve_user_root

    def _resolve_root(explicit: Path | None) -> Path:
        if explicit is not None:
            return explicit
        return resolve_user_root("dev", create=True)

    def _print_profile(profile: LearningProfile, *, as_json: bool) -> None:
        if as_json:
            print(json.dumps(profile.to_dict()))
            return
        print(
            f"practice_format={profile.practice_format} ({profile.practice_format_source})"
        )
        print(f"autonomy={profile.autonomy} ({profile.autonomy_source})")
        print(f"chunk_size={profile.chunk_size} ({profile.chunk_size_source})")
        print(f"check_depth={profile.check_depth} ({profile.check_depth_source})")

    parser = argparse.ArgumentParser(
        description="Read/write the student's learning profile"
    )
    parser.add_argument(
        "--user-root",
        type=Path,
        default=None,
        help="Override user root (else DEV_USER_ROOT / default)",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON")
    sub = parser.add_subparsers(dest="cmd", required=True)

    save = sub.add_parser("save", help="Write onboarding-game answers")
    save.add_argument(
        "--practice-format", choices=("worked_example", "retrieval"), required=True
    )
    save.add_argument("--autonomy", choices=("directive", "choices"), required=True)
    save.add_argument("--chunk-size", choices=("short", "long"), required=True)
    save.add_argument(
        "--check-depth",
        choices=("light", "thorough"),
        default="thorough",
        help="Confidence-calibration prior (default: thorough)",
    )
    save.add_argument(
        "--if-then",
        default="",
        help="Optional start line the student wrote (not a learner type)",
    )

    signal = sub.add_parser(
        "signal",
        help="Record format-specific feedback (not skill-route accept/veto)",
    )
    signal.add_argument("--field", choices=tuple(FIELD_VALUES.keys()), required=True)
    signal.add_argument("--value", required=True)
    signal.add_argument("--delta", type=int, default=1)

    sub.add_parser("show", help="Print the current learning profile")

    args = parser.parse_args(argv)
    root = _resolve_root(args.user_root)

    if args.cmd == "save":
        profile = apply_onboarding_answers(
            root,
            practice_format=args.practice_format,
            autonomy=args.autonomy,
            chunk_size=args.chunk_size,
            check_depth=args.check_depth,
            if_then=args.if_then,
        )
    elif args.cmd == "signal":
        allowed = FIELD_VALUES[args.field]
        if args.value not in allowed:
            parser.error(
                f"invalid --value {args.value!r} for --field {args.field}; "
                f"choose from {', '.join(allowed)}"
            )
        profile = record_signal(root, args.field, args.value, delta=args.delta)
    else:
        profile = load_learning_profile(root)

    _print_profile(profile, as_json=args.json)
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
