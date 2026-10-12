#!/usr/bin/env bash
# Sign nested Mach-O code inside a Kairos.app bundle, deepest path first.
# The caller signs the bundle itself afterwards. This script never notarizes.
#
# Usage: scripts/sign-macos-nested.sh /path/to/Kairos.app [identity]
set -euo pipefail

APP="${1:?path to Kairos.app}"
IDENTITY="${2:-${KAIROS_CODESIGN_IDENTITY:-Developer ID Application: Jacob Pfeifer (BHFNTM69P2)}}"

if [[ ! -d "$APP" ]]; then
  echo "sign-macos-nested: not a directory: $APP" >&2
  exit 1
fi

# Resolve without requiring GNU readlink. Refuse anything that is not Kairos.app.
APP="$(cd "$APP" && pwd)"
if [[ "$(basename "$APP")" != "Kairos.app" ]]; then
  echo "sign-macos-nested: refusing to sign $(basename "$APP") (only Kairos.app)" >&2
  exit 1
fi

ENTITLEMENTS="$(cd "$(dirname "$0")" && pwd)/macos-codesign/runtime-entitlements.plist"
if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "sign-macos-nested: missing $ENTITLEMENTS" >&2
  exit 1
fi

python3 - "$APP" "$IDENTITY" "$ENTITLEMENTS" <<'PY'
import os, subprocess, sys

app, identity, entitlements = sys.argv[1], sys.argv[2], sys.argv[3]
# V8 (Node) and CPython need MAP_JIT under the hardened runtime. Without
# these entitlements they die at startup with "Failed to reserve virtual
# memory for CodeRange", which blanks school search and Canvas sync.
MAGICS = {
    b"\xfe\xed\xfa\xce",
    b"\xfe\xed\xfa\xcf",
    b"\xce\xfa\xed\xfe",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
}

found = []
for dirpath, dirnames, filenames in os.walk(app, followlinks=False):
    dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
    for name in filenames:
        path = os.path.join(dirpath, name)
        if os.path.islink(path) or not os.path.isfile(path):
            continue
        try:
            with open(path, "rb") as fh:
                magic = fh.read(4)
        except OSError as exc:
            print(f"sign-macos-nested: cannot read {path}: {exc}", file=sys.stderr)
            sys.exit(1)
        if magic in MAGICS:
            found.append(path)

# Deeper paths first so a parent signature is applied after its children.
found.sort(key=lambda p: p.count(os.sep), reverse=True)
if not found:
    print(f"sign-macos-nested: no Mach-O files in {app}", file=sys.stderr)
    sys.exit(1)

def needs_jit(path):
    base = os.path.basename(path)
    return base == "node" or base.startswith("python")

print(f"sign-macos-nested: signing {len(found)} nested binaries")
for path in found:
    cmd = [
        "/usr/bin/codesign",
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        identity,
    ]
    if needs_jit(path):
        cmd.extend(["--entitlements", entitlements])
        print(f"sign-macos-nested: {path} (jit)")
    else:
        print(f"sign-macos-nested: {path}")
    cmd.append(path)
    subprocess.run(cmd, check=True)
print("sign-macos-nested: nested binaries signed")
PY
