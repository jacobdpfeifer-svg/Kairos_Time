#!/usr/bin/env bash
# Mirror the checkout to a non-iCloud directory and run a Python module there.
#
# Why: `uv run` re-syncs/rebuilds the project's editable install from the repo's
# own source on every invocation. When the repo lives under iCloud Drive
# ("Mobile Documents"), that rebuild intermittently fails or silently drops
# files (same class of issue as native-mirror.sh's Rust EPERM case), leaving
# `canvas_mcp.core` unimportable ~half the time. A persistent venv built once
# against the rsynced mirror avoids the iCloud-triggered rebuild entirely.
#
# Usage:
#   scripts/py-mirror-run.sh -m canvas_mcp.core.learn_loop reconcile
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${KAIROS_NATIVE_MIRROR:-$HOME/.cache/kairos-build}"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
mkdir -p "$MIRROR"
rsync -a --delete --exclude node_modules --exclude __pycache__ --exclude .auth \
  "$REPO/src/" "$MIRROR/src/"
# pyproject.toml force-includes schools/; without it `uv pip install -e .` fails
# on a fresh mirror and every sync's reconcile is skipped (live run D9).
rsync -a --delete "$REPO/schools/" "$MIRROR/schools/"
cp -f "$REPO/pyproject.toml" "$MIRROR/pyproject.toml"
cp -f "$REPO/LICENSE" "$MIRROR/LICENSE"
cp -f "$REPO/README.md" "$MIRROR/README.md"
if [ ! -x "$MIRROR/.venv/bin/python" ]; then
  (cd "$MIRROR" && uv venv .venv >&2)
fi
(cd "$MIRROR" && uv pip install -q -e . --python "$MIRROR/.venv/bin/python" >&2)
exec "$MIRROR/.venv/bin/python" "$@"
