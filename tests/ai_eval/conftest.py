"""ai_eval fixtures: isolated synthetic roots and the network guard.

Known weaknesses are pinned as ``xfail(strict=True)`` with a finding id from
``docs/audits/ai-eval-2026-10-12/REPORT.md``; a fix flips them to XPASS and
the strict marker fails the run until the xfail is removed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import kairos_adapter as adapter  # noqa: E402


@pytest.fixture
def avery(tmp_path: Path) -> Path:
    return adapter.build_root("avery-chen", base=tmp_path)


@pytest.fixture
def blake(tmp_path: Path) -> Path:
    return adapter.build_root("blake-okonkwo", base=tmp_path)


def pytest_configure(config):
    config.addinivalue_line("markers", "model: calls the Anthropic API (only api.anthropic.com is let through)")


@pytest.fixture(autouse=True)
def _no_network(request):
    allow = request.node.get_closest_marker("model") is not None
    with adapter.network_guard(allow_model=allow) as attempts:
        yield attempts


def finding(fid: str, why: str):
    """Pin a reproduced weakness. Remove when the fix lands."""
    return pytest.mark.xfail(strict=True, reason=f"{fid}: {why}")
