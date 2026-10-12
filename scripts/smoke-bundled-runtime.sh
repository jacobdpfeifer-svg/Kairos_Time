#!/usr/bin/env bash
# Verify the interpreters shipped inside a built Kairos.app can start.
set -euo pipefail

APP="${1:?usage: smoke-bundled-runtime.sh /path/to/Kairos.app}"
NODE="$APP/Contents/Resources/runtime/node/bin/node"
PYTHON="$APP/Contents/Resources/runtime/python/bin/python3"

[[ -x "$NODE" ]] || { echo "missing bundled Node: $NODE" >&2; exit 1; }
[[ -x "$PYTHON" ]] || { echo "missing bundled Python: $PYTHON" >&2; exit 1; }

echo "[smoke] Node: $("$NODE" --version)"
"$NODE" -e 'if (1 + 1 !== 2) process.exit(1); console.log("Node executable-memory smoke test passed")'
echo "[smoke] Python: $("$PYTHON" --version 2>&1)"
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -c 'import sys; assert sys.version_info >= (3, 12); print("Python runtime smoke test passed")'

if command -v codesign >/dev/null 2>&1; then
  ENTITLEMENTS="$(codesign -d --entitlements :- "$NODE" 2>/dev/null || true)"
  grep -q 'com.apple.security.cs.allow-jit' <<<"$ENTITLEMENTS" || {
    echo "bundled Node is missing com.apple.security.cs.allow-jit" >&2
    exit 1
  }
fi

echo "[smoke] bundled runtime passed"
