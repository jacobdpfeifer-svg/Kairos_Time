# Release prompt — clean `main`, notarize, replace the installed app

You are releasing Kairos from:

`/Users/jacobpfeifer/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Canvas Competition`

Read `AGENTS.md` before you change anything. `main` is the only product branch.
Commit and push there. The old branch lock (`.cursor/rules/phase1-branch.mdc`)
has been deleted. Do not recreate that rule or the `phase1-productname-pivot`
branch. Do not widen this release into new product work.

The signed DMG currently on disk is stale. It was notarized on 2026-10-10 from
a 2026-10-09 build (`Kairos_0.1.0_aarch64.dmg`, SHA-256
`84106a30408c4d2a4cb4e53cbd5fea5be6aaf1cc2a2b88051c2d45cb75d96a4f`). Rebuild
from the current `main` commit before notarizing. `scripts/package-macos.sh`
signs the app and DMG and does not submit them to Apple.

## 1. Make git clean and push `main`

```bash
git status
git branch --show-current
git diff
git diff --cached
```

If you are not on `main`, stop and report the branch.

The working tree must be clean before you package.

- Commit product files that belong in this release, on `main`, with a message
  that says why. That includes the deletion of `.cursor/rules/phase1-branch.mdc`
  and this prompt, plus any other product edits already in the tree.
- Never commit `.env`, `browser/.auth/`, credentials, feed URLs, or anything
  under a user data root. If those are dirty, leave them unstaged and stop.
  Tell Jacob which paths blocked a clean tree.
- Do not `git reset`, `git checkout --`, or otherwise discard work to force a
  clean status.
- Do not skip hooks.

Push `main` to `origin`. Do not force-push.

```bash
git fetch origin
git status
git rev-parse HEAD origin/main
```

`HEAD` and `origin/main` must be the same commit, and `git status` must be clean.

## 2. Rebuild, notarize, and staple

Build from that commit:

```bash
bash scripts/package-macos.sh
```

The script mirrors the tree out of iCloud, runs `npm run tauri -- build`, signs
with `Developer ID Application: Jacob Pfeifer (BHFNTM69P2)`, and copies the
bundle to:

`app/src-tauri/target/release/bundle/dmg/Kairos_0.1.0_aarch64.dmg`

Do not re-run `scripts/stage-runtime.sh` unless the bundled Python or Node
tarballs are being replaced.

Notarization stays manual. Discover the existing `notarytool` keychain profile
on this Mac. Do not ask Jacob for his Apple ID password, app-specific password,
or API private key, and do not write credentials into the repo.

```bash
DMG="app/src-tauri/target/release/bundle/dmg/Kairos_0.1.0_aarch64.dmg"
xcrun notarytool submit "$DMG" --keychain-profile "<profile>" --wait
xcrun stapler staple "$DMG"
```

Stop if the submission is not `Accepted`. Then verify this new file:

```bash
shasum -a 256 "$DMG"
hdiutil verify "$DMG"
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -v "$DMG"
```

Record the new SHA-256. It must differ from `84106a30…`. `stapler validate` on
the loose `Kairos.app` under `bundle/macos/` has no ticket; the stapled DMG is
the artifact that ships. Do not commit the DMG.

## 3. Replace the installed app

Quit Kairos, drag `Kairos.app` out of the new DMG onto Applications, and replace
the existing copy. Launching the old Applications copy, or a dev window, will
keep showing the previous build.

Do that replacement yourself once the stapled DMG verifies:

```bash
osascript -e 'quit app "Kairos"'
hdiutil attach "$DMG" -nobrowse -readonly
# copy Kairos.app from the mounted volume over /Applications/Kairos.app with ditto
hdiutil detach "<mount point>"
```

Use `ditto` for the copy so signatures and extended attributes stay intact.
Confirm the installed bundle:

```bash
codesign -dv --verbose=4 /Applications/Kairos.app
spctl --assess --type execute --verbose=4 /Applications/Kairos.app
```

`TeamIdentifier` must be `BHFNTM69P2` and the assessment must report
`Notarized Developer ID`. Leave the app quit when you finish. Tell Jacob the
`main` commit SHA, the DMG SHA-256, the notarization submission id, and that
`/Applications/Kairos.app` was replaced from that DMG.
