"""School / tenant registry loader.

The student's school is discovered at onboarding (Instructure account search ->
their Canvas host) and saved to ``{user_root}/school/profile.json``; Canvas itself
then fills in time zone and term. ``schools/{slug}.yaml`` is an optional curated
overlay for what Canvas cannot know (policy links, campus plugins, legal notice),
matched by Canvas host. Nothing assumes a particular school.
See docs/architecture/school-personalization.md.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
_REPO_SCHOOLS_DIR = _REPO_ROOT / "schools"
# Wheel installs copy schools → canvas_mcp/schools via hatch force-include.
_PKG_SCHOOLS_DIR = Path(__file__).resolve().parents[1] / "schools"

PRODUCT_NAME = "Kairos"


@dataclass(frozen=True)
class EngagementPlatform:
    host: str
    path: str = ""


@dataclass(frozen=True)
class CourseFileEntry:
    code: str
    patterns: tuple[str, ...]


@dataclass(frozen=True)
class SchoolConfig:
    slug: str
    display_name: str
    canvas_base_url: str
    sso_idp: str
    timezone: str
    term_dates: dict[str, str] = field(default_factory=dict)
    lti_catalog: tuple[str, ...] = ()
    engagement_platform: EngagementPlatform | None = None
    course_file_map: tuple[CourseFileEntry, ...] = ()
    legal_notice: str = ""
    grade_scale: dict[str, float] = field(default_factory=dict)
    policy_links: dict[str, str] = field(default_factory=dict)

    @property
    def api_base(self) -> str:
        return f"{self.canvas_base_url.rstrip('/')}/api/v1"


def _schools_dir() -> Path:
    override = __import__("os").environ.get("SCHOOLS_DIR")
    if override:
        return Path(override)
    if _PKG_SCHOOLS_DIR.is_dir() and any(_PKG_SCHOOLS_DIR.glob("*.yaml")):
        return _PKG_SCHOOLS_DIR
    return _REPO_SCHOOLS_DIR


def _parse_school(raw: dict[str, Any], slug: str) -> SchoolConfig:
    engagement = None
    eng_raw = raw.get("engagement_platform")
    if isinstance(eng_raw, dict) and eng_raw.get("host"):
        engagement = EngagementPlatform(
            host=str(eng_raw["host"]).rstrip("/"),
            path=str(eng_raw.get("path") or ""),
        )

    course_map: list[CourseFileEntry] = []
    for entry in raw.get("course_file_map") or []:
        if not isinstance(entry, dict) or not entry.get("code"):
            continue
        patterns = tuple(str(p) for p in (entry.get("patterns") or []))
        course_map.append(CourseFileEntry(code=str(entry["code"]), patterns=patterns))

    grade_scale: dict[str, float] = {}
    for letter, points in (raw.get("grade_scale") or {}).items():
        try:
            grade_scale[str(letter).strip().upper()] = float(points)
        except (TypeError, ValueError):
            continue

    policy_links = {
        str(k): str(v).strip()
        for k, v in (raw.get("policy_links") or {}).items()
        if v is not None and str(v).strip()
    }

    return SchoolConfig(
        slug=str(raw.get("slug") or slug),
        display_name=str(raw.get("display_name") or slug),
        canvas_base_url=str(raw["canvas_base_url"]).rstrip("/"),
        sso_idp=str(raw.get("sso_idp") or ""),
        timezone=str(raw.get("timezone") or "UTC"),
        term_dates={str(k): str(v) for k, v in (raw.get("term_dates") or {}).items()},
        lti_catalog=tuple(str(x) for x in (raw.get("lti_catalog") or [])),
        engagement_platform=engagement,
        course_file_map=tuple(course_map),
        legal_notice=str(raw.get("legal_notice") or "").strip(),
        grade_scale=grade_scale,
        policy_links=policy_links,
    )


@lru_cache(maxsize=32)
def load_school(slug: str) -> SchoolConfig:
    """Load ``schools/{slug}.yaml``. Raises FileNotFoundError if missing."""
    path = _schools_dir() / f"{slug}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Unknown school slug: {slug} ({path})")
    with path.open(encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"School config must be a mapping: {path}")
    if slug.startswith("_"):
        raise ValueError(f"Template slug not loadable as a school: {slug}")
    return _parse_school(raw, slug)


def list_schools() -> list[str]:
    """Return available school slugs (excludes ``_template``)."""
    directory = _schools_dir()
    if not directory.is_dir():
        return []
    return sorted(
        p.stem
        for p in directory.glob("*.yaml")
        if not p.stem.startswith("_")
    )


def clear_school_cache() -> None:
    """Drop cached school configs (tests)."""
    load_school.cache_clear()


def _host_of(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    return (urlparse(raw).hostname or "").lower()


def curated_slug_for_host(host: str) -> str:
    """Slug of a curated ``schools/*.yaml`` whose canvas_base_url host matches, or ''."""
    want = _host_of(host)
    if not want:
        return ""
    for slug in list_schools():
        try:
            if _host_of(load_school(slug).canvas_base_url) == want:
                return slug
        except (OSError, ValueError, KeyError):
            continue
    return ""


def read_school_profile(user_root: Path) -> dict[str, Any] | None:
    """The onboarding pick at ``{user_root}/school/profile.json`` (None if absent or unreadable)."""
    path = Path(user_root) / "school" / "profile.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("canvas_host") else None


def school_for_user(user_root: Path) -> SchoolConfig | None:
    """The student's school: curated yaml when one matches their Canvas host, else built from the profile."""
    profile = read_school_profile(user_root)
    if not profile:
        return None
    curated = curated_slug_for_host(str(profile["canvas_host"]))
    if curated:
        return load_school(curated)
    found = profile.get("discovered") or {}
    term = found.get("term") or {}
    return SchoolConfig(
        slug=str(profile.get("slug") or ""),
        display_name=str(profile.get("display_name") or profile["canvas_host"]),
        canvas_base_url=f"https://{_host_of(str(profile['canvas_host']))}",
        sso_idp="",
        timezone=str(found.get("timezone") or "UTC"),
        term_dates={
            k: str(v)
            for k, v in {"current_name": term.get("name"), "current_start": term.get("start_at"), "current_end": term.get("end_at")}.items()
            if v
        },
    )
