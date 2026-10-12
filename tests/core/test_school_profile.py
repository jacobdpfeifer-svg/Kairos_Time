"""School discovered at onboarding: no curated yaml needed, curated yaml wins when it matches."""

import json

from canvas_mcp.core.tenants import (
    curated_slug_for_host,
    read_school_profile,
    school_for_user,
)


def _write_profile(root, **profile):
    path = root / "school" / "profile.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(profile), encoding="utf-8")


def test_uncurated_school_builds_from_profile(tmp_path):
    _write_profile(
        tmp_path,
        slug="osu-instructure-com",
        display_name="Ohio State",
        canvas_host="osu.instructure.com",
        discovered={"timezone": "America/New_York", "term": {"name": "Autumn 2026", "start_at": "2026-08-20T00:00:00Z"}},
    )
    school = school_for_user(tmp_path)
    assert school is not None
    assert school.display_name == "Ohio State"
    assert school.api_base == "https://osu.instructure.com/api/v1"
    assert school.timezone == "America/New_York"
    assert school.term_dates["current_name"] == "Autumn 2026"


def test_curated_yaml_wins_when_host_matches(tmp_path):
    _write_profile(tmp_path, slug="canvas-colorado-edu", display_name="CU", canvas_host="canvas.colorado.edu")
    assert curated_slug_for_host("https://canvas.colorado.edu/courses") == "cu-boulder"
    school = school_for_user(tmp_path)
    assert school is not None and school.slug == "cu-boulder"


def test_missing_profile_is_none(tmp_path):
    assert read_school_profile(tmp_path) is None
    assert school_for_user(tmp_path) is None
