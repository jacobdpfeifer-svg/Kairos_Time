#!/usr/bin/env bash
# Stage the bundled runtime for the desktop app (no downloads happen here).
#
# Inputs (already downloaded and checksum-verified by the owner):
#   PYTHON_TARBALL  python-build-standalone "install_only" tarball for the target
#                   (e.g. cpython-3.12.x+YYYYMMDD-aarch64-apple-darwin-install_only.tar.gz)
#   NODE_TARBALL    Node LTS tarball for the target (e.g. node-v22.x.x-darwin-arm64.tar.gz)
#
# Output: app/src-tauri/runtime/{python,node,browser-node_modules} + manifest.json
# Tauri copies runtime/ into Contents/Resources/runtime (tauri.conf.json bundle.resources).
#
# The study journey needs only the Python standard library. The Plan tab's
# legacy commands import the vendored MCP package, whose third-party deps are
# installed into the bundled interpreter here with pip (pure-Python + platform
# wheels for the target arch). If that step fails, the app still runs the
# study journey and reports Plan features as unavailable.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$REPO/app/src-tauri/runtime"
PY_TARBALL="${PYTHON_TARBALL:?set PYTHON_TARBALL}"
NODE_TAR="${NODE_TARBALL:?set NODE_TARBALL}"

rm -rf "$RUNTIME/python" "$RUNTIME/node" "$RUNTIME/browser-node_modules"
mkdir -p "$RUNTIME"

echo "[stage] python ← $PY_TARBALL"
mkdir -p "$RUNTIME/python.tmp"
tar -xzf "$PY_TARBALL" -C "$RUNTIME/python.tmp"
mv "$RUNTIME/python.tmp/python" "$RUNTIME/python"
rm -rf "$RUNTIME/python.tmp"
"$RUNTIME/python/bin/python3" --version

echo "[stage] node ← $NODE_TAR"
mkdir -p "$RUNTIME/node.tmp"
tar -xzf "$NODE_TAR" -C "$RUNTIME/node.tmp" --strip-components=1
mkdir -p "$RUNTIME/node"
cp -R "$RUNTIME/node.tmp/bin" "$RUNTIME/node/bin"
rm -rf "$RUNTIME/node.tmp"
# Only the Node executable is needed at runtime. The npm/corepack launchers are
# symlinks into lib/, which is intentionally not bundled; leaving those broken
# symlinks in the resource tree makes Tauri reject the bundle during packaging.
rm -f "$RUNTIME/node/bin/npm" "$RUNTIME/node/bin/npx" "$RUNTIME/node/bin/corepack"
"$RUNTIME/node/bin/node" --version

echo "[stage] browser node_modules (playwright)"
if [ ! -d "$REPO/browser/node_modules/playwright" ]; then
  echo "run: cd browser && npm ci   (playwright package, no browser download needed with PLAYWRIGHT_CHANNEL=chrome)" >&2
  exit 1
fi
cp -R "$REPO/browser/node_modules" "$RUNTIME/browser-node_modules"

echo "[stage] python deps for Plan commands (best effort)"
if "$RUNTIME/python/bin/python3" -m pip --version >/dev/null 2>&1; then
  "$RUNTIME/python/bin/python3" -m pip install --quiet --no-warn-script-location \
    "fastmcp>=3.4.7,<4" "mcp>=1.26.0,<2" "httpx>=0.28.1,<1" "python-dotenv>=1.2.2,<2" \
    "pydantic>=2.13.1,<3" "python-dateutil>=2.9.0,<3" "pyyaml>=6.0" || echo "[stage] WARNING: Plan-command deps failed; study journey unaffected" >&2
fi

echo "[stage] manifest"
"$RUNTIME/python/bin/python3" - "$RUNTIME" <<'PY'
import hashlib, json, os, platform, sys
root = sys.argv[1]
files = {}
for dirpath, _, names in os.walk(root):
    for name in names:
        p = os.path.join(dirpath, name)
        if os.path.islink(p) or name == "manifest.json":
            continue
        rel = os.path.relpath(p, root)
        with open(p, "rb") as fh:
            files[rel] = hashlib.sha256(fh.read()).hexdigest()
json.dump({"arch": platform.machine(), "python": sys.version.split()[0], "files": len(files), "sha256": files}, open(os.path.join(root, "manifest.json"), "w"), indent=1)
print(f"staged {len(files)} files")
PY
echo "[stage] done → $RUNTIME"
