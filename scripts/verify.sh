#!/usr/bin/env bash
# One feedback loop: ruff, pytest, and the app vitest suite.
# Homebrew is not on the default PATH. PYTHONPATH=src covers an iCloud
# checkout hiding .pth files, and is harmless when the checkout is local.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:${PATH}"
export PYTHONPATH=src
uv run ruff check .
uv run python -m pytest tests/ -q
npm test --prefix app
