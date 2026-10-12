#!/usr/bin/env bash
# Build a signed arm64 Kairos.app and DMG. Does not submit the result to Apple.
#
# Nested Mach-O files are signed by scripts/macos-codesign/codesign when Tauri
# signs the app bundle. Tauri then creates and signs the DMG from that app.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$(cd "$(dirname "$0")/macos-codesign" && pwd):${PATH}"
export KAIROS_CODESIGN_IDENTITY="${KAIROS_CODESIGN_IDENTITY:-Developer ID Application: Jacob Pfeifer (BHFNTM69P2)}"

# Tauri notarizes only when Apple credential env vars are present. Keep them unset.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH || true

echo "package-macos: codesign on PATH is $(command -v codesign)"
bash "$REPO/scripts/native-mirror.sh" npm run tauri -- build

MIRROR="${KAIROS_NATIVE_MIRROR:-$HOME/.cache/kairos-build}"
SRC="$MIRROR/app/src-tauri/target/release/bundle"
DEST="$REPO/app/src-tauri/target/release/bundle"
mkdir -p "$DEST"
rsync -a --delete "$SRC/macos/" "$DEST/macos/"
rsync -a --delete "$SRC/dmg/" "$DEST/dmg/"
echo "package-macos: copied signed bundle to $DEST"
