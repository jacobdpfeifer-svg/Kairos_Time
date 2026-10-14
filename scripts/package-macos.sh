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
# Smoke the mirror's build before it replaces anything in the repo checkout.
"$REPO/scripts/smoke-bundled-runtime.sh" "$SRC/macos/Kairos.app"
mkdir -p "$DEST/dmg"
rm -rf "$DEST/macos/Kairos.app"
ditto --norsrc "$SRC/macos/Kairos.app" "$DEST/macos/Kairos.app"
shopt -s nullglob
dmgs=("$SRC"/dmg/Kairos_*.dmg)
if (( ${#dmgs[@]} == 0 )); then
  echo "package-macos: no DMG in $SRC/dmg" >&2
  exit 1
fi
rm -f "$DEST"/dmg/Kairos_*.dmg
for dmg in "${dmgs[@]}"; do
  ditto --norsrc "$dmg" "$DEST/dmg/$(basename "$dmg")"
done
# Re-check after the copy: the iCloud checkout can attach xattrs that break the seal.
"$REPO/scripts/smoke-bundled-runtime.sh" "$DEST/macos/Kairos.app"
/usr/bin/codesign --verify --deep --strict "$DEST/macos/Kairos.app"
echo "package-macos: copied signed bundle to $DEST"
