"""Persist last-processed markers under ``{user_root}``.

Used by learning-profile ledger compact so overlapping windows do not
double-apply the same source rows.
"""

from __future__ import annotations

from pathlib import Path

# Marker basename stems → ``.{name}_watermark`` under user_root.
LEARNING_PROFILE_COMPACT = "learning_profile_compact"


def watermark_path(user_root: Path, name: str) -> Path:
    """Return ``{user_root}/.{name}_watermark``."""
    safe = name.strip().lstrip(".")
    if not safe or "/" in safe or "\\" in safe:
        raise ValueError(f"Invalid watermark name: {name!r}")
    return Path(user_root) / f".{safe}_watermark"


def read_watermark(user_root: Path, name: str) -> float | None:
    """Read a unix-timestamp watermark, or ``None`` if missing/invalid."""
    path = watermark_path(user_root, name)
    if not path.is_file():
        return None
    raw = path.read_text(encoding="utf-8", errors="replace").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def write_watermark(user_root: Path, name: str, value: float) -> Path:
    """Persist a unix-timestamp watermark (overwrite)."""
    path = watermark_path(user_root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{float(value)}\n", encoding="utf-8")
    return path
