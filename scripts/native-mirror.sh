#!/usr/bin/env bash
# Mirror the checkout to a non-iCloud directory and run a cargo/tauri command there.
#
# Use this only when the checkout is still under iCloud Drive ("Mobile Documents").
# A checkout outside iCloud, such as ~/dev/kairos, builds in place.
#
# Why it exists: Rust's std::fs::copy (fcopyfile with metadata) returns EPERM on
# files stored in iCloud, so tauri-build panics in place ("failed to run
# tauri-build: Operation not permitted"). Observed 2026-09-18 on macOS 25.6 with
# rustc 1.98.1. Plain `cp` works, so this rsyncs the tree out and builds there.
#
# Usage:
#   scripts/native-mirror.sh cargo check --locked
#   scripts/native-mirror.sh cargo test --locked
#   scripts/native-mirror.sh npm run tauri -- build
# The command runs with cwd = <mirror>/app/src-tauri for cargo, <mirror>/app otherwise.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${KAIROS_NATIVE_MIRROR:-$HOME/.cache/kairos-build}"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
mkdir -p "$MIRROR"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude dist --exclude .venv \
  --exclude __pycache__ --exclude .auth --exclude .git \
  "$REPO/app/" "$MIRROR/app/"
for d in src browser schools templates skills plugins design-system; do
  rsync -a --delete --exclude node_modules --exclude __pycache__ --exclude .auth \
    "$REPO/$d/" "$MIRROR/$d/"
done
cp -f "$REPO/pyproject.toml" "$MIRROR/pyproject.toml"
cp -f "$REPO/LICENSE" "$MIRROR/LICENSE"
cp -f "$REPO/README.md" "$MIRROR/README.md"
if [ "${1:-}" = "cargo" ]; then
  cd "$MIRROR/app/src-tauri"
else
  cd "$MIRROR/app"
  if [ ! -d node_modules ]; then
    ln -s "$REPO/app/node_modules" node_modules
  fi
fi
echo "[native-mirror] cwd=$(pwd)" >&2
exec "$@"
