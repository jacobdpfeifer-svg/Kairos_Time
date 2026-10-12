# Continuation prompt — Apple signing, notarization, and beta distribution

You are continuing work on the Kairos Canvas companion project in:

`/Users/jacobpfeifer/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Canvas Competition`

Read `AGENTS.md` and `skills/_SESSION.md` before making changes. Preserve all
existing user and background-audit changes in the working tree. Do not reset,
checkout, or discard unrelated modifications.

## Conversation context

The project has reached the point where the actual macOS DMG has been rebuilt
and tested mechanically. The next focus is Apple code signing and notarization.
The user has now purchased the Apple Developer Program membership for $99 and
reported that Apple shows:

- Order Placed — Completed
- Electronically Delivered — Completed

The user is waiting for the developer account controls to become available and
will likely share screenshots. Help them verify the account state and guide
them through certificate creation without requesting or exposing passwords,
private keys, payment details, or MFA codes.

## What has already been completed

### Runtime and DMG

- Bundled Python 3.12.15 arm64.
- Bundled Node 24.21.0 arm64 LTS.
- Bundled Playwright/browser dependencies.
- Fixed `scripts/stage-runtime.sh` so broken Node symlinks do not break Tauri packaging.
- Fixed `scripts/native-mirror.sh` to include `design-system/`.
- Fixed `app/src-tauri/src/main.rs` so a packaged app validates the Tauri resource
  directory and falls back to the app bundle's `Contents/Resources` rather than
  silently using the developer checkout.
- Full tests previously passed:
  - app: 77 tests
  - browser: 316 tests
  - Python: 873 passed, 19 skipped
  - native mirror: 20 Rust tests

### Final DMG

Final artifact:

`/Users/jacobpfeifer/.cache/kairos-build/app/src-tauri/target/release/bundle/dmg/Kairos_0.1.0_aarch64.dmg`

SHA-256:

`c1b32207eafbaf945e2898e7b58b7cd54392d46ba4a484eb135af24f019ad08b`

`hdiutil verify` passed.

The DMG was copied to a fresh isolated app location:

`/tmp/kairos-clean-mac-final.4pui9D/Applications/Kairos.app`

The installed app reported:

`[kairos-daemon] runtime Bundled profile=cleanbeta ...`

This proves the packaged app uses bundled runtime resources.

### Canvas SSO walk

The fresh app successfully passed:

1. School selection for University of Colorado Boulder.
2. Beta terms acceptance.
3. Canvas connection screen.
4. Real headed Chrome/Playwright launch against `https://canvas.colorado.edu/`.
5. User completed the real university login/MFA in the opened browser.
6. After the browser was closed, Kairos displayed “You're already signed in.”
7. Kairos started the headless post-login study-source sync.

Credentials and MFA codes were never entered or inspected by automation.

The sync process was later stopped during investigation because it remained in
`{"phase":"running","courses":[]}` for several minutes. Do not claim that
real course sync completed unless it is rerun and produces concrete course/data
artifacts.

## Current Apple signing findings

The local Mac was checked with:

```bash
security find-identity -v -p codesigning
```

Result: `0 valid identities found`.

The installed app currently has an ad-hoc/linker signature only:

- no Apple Team ID;
- no Developer ID certificate;
- no notarization ticket.

`spctl` therefore does not provide a distribution pass. The local machine has
Command Line Tools' `notarytool`, but `xcrun stapler` reported that the active
developer directory is only Command Line Tools and that full Xcode is required.

The repository's historical packaging decision was “Not yet,” but the user has
now completed the Apple Developer membership purchase and is moving toward the
signing gate. Do not silently change the historical decision record; update a
new dated addendum/report if needed.

Relevant files:

- `docs/handoff/pre-ship-decisions.md`
- `docs/handoff/packaging-notes.md`
- `docs/build/student-beta/DMG-BUILD-2026-10-08.md`
- `docs/build/student-beta/WORTH-INSTALLING-AUDIT-2026-10-08.md`
- `app/src-tauri/tauri.conf.json`

The DMG build report now documents the signing audit and Apple prerequisites.

## Immediate continuation tasks

1. Ask the user to verify whether the Apple Developer account dashboard now
   shows active membership and exposes **Certificates, IDs & Profiles**.
2. If active, direct them to:

   `https://developer.apple.com/account/resources/certificates/list`

3. Explain that they should choose **Developer ID Application**, not Developer
   ID Installer. They must be the Account Holder.
4. Guide them through creating a CSR in macOS Keychain Access:

   `Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority`

   The CSR should be generated on the Mac that will sign the app so the private
   key remains in that Mac's login keychain.
5. After Apple issues the certificate, have the user install the downloaded
   certificate and run:

   ```bash
   security find-identity -v -p codesigning
   ```

   Expected result resembles:

   `Developer ID Application: <name> (<TEAM_ID>)`

6. Before building, check whether full Xcode is installed and selected:

   ```bash
   xcode-select -p
   xcrun --find notarytool
   xcrun --find stapler
   ```

   If only `/Library/Developer/CommandLineTools` is active and stapler still
   requires Xcode, explain that full Xcode must be installed from the Mac App
   Store and selected with `sudo xcode-select --switch ...` by the user.
7. Only after the certificate exists, inspect Tauri's current macOS signing
   configuration and add the smallest safe configuration needed. Do not put
   secrets in `tauri.conf.json`, source files, `.env` files committed to git,
   or the app bundle.
8. Use a protected local environment or CI secrets for:

   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` only if using a CI `.p12`
   - Apple notarization credentials, either Apple ID + app-specific password +
     Team ID, or App Store Connect API issuer/key/private-key credentials

9. Rebuild, then verify:

   ```bash
   codesign -dv --verbose=4 path/to/Kairos.app
   spctl --assess --type execute --verbose=4 path/to/Kairos.app
   xcrun stapler validate path/to/Kairos.app
   hdiutil verify path/to/Kairos.dmg
   ```

10. Repeat the isolated install and Canvas SSO/sync walk after signing. A
    signed DMG is not complete until the app launches from the DMG, uses bundled
    resources, and the user can complete Canvas SSO without a repository checkout.

## Credential and API-key boundaries

Keep these concerns separate:

- Apple signing/notarization credentials are build/release credentials. They
  must never be bundled into Kairos or exposed to beta users.
- Canvas should continue using the user's SSO/browser session. Do not ask the
  user to embed a Canvas API token into the DMG.
- Google Voice/Gemini credentials belong on the approved relay/server path, not
  in the desktop app. The browser/page must not receive the provider secret.
- Google/Microsoft OAuth client IDs and consent flows are a later onboarding
  design task. Do not broaden the signing task into connector implementation.
- Never request the user's Apple password, app-specific password, private key,
  MFA code, Canvas password, or OAuth client secret in chat.

## Communication style and stopping rules

Be concrete and reassuring. Explain what screen the user should see and what
the next click does. If Apple membership is still pending, tell them to wait
and check the account page/email rather than paying again. If a screenshot is
shared, ask them to redact personal information, payment details, passwords,
private keys, and MFA codes.

Do not claim the DMG is publicly distributable until all of these are true:

- Developer ID Application signing succeeds.
- Notarization succeeds and the ticket is stapled.
- Gatekeeper verification passes.
- A clean external-Mac install is completed.
- The live Canvas SSO/sync walk has concrete success evidence.

At the end of each turn, state the immediate next step so the work stays on
the signing/notarization path before moving to API-key and onboarding design.
