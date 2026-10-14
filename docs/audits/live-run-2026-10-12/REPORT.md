# Kairos live onboarding reliability report — 2026-10-12

## Scope

This report covers the CU Boulder first-run path: packaged runtime startup,
school discovery, Chrome SSO/MFA handoff, stale SAML recovery, post-login sync,
and release verification.

## Root causes

- The hardened-runtime Node binary lacked the JIT entitlement required by V8.
  It exited with `Failed to reserve virtual memory for CodeRange`, and the UI
  converted that process failure into an empty school result.
- The persistent Playwright profile could retain half-finished SAML pages. A new
  login attempt reused the first existing page, allowing CU's identity provider
  to reject an expired POST request as a stale request.
- The onboarding sync path completed from the UI's perspective without checking
  that a fresh canonical projection and real course progress artifact existed.

## Changes

- Sign bundled Node and Python with the runtime entitlements needed by V8 and
  CPython under Apple's hardened runtime.
- Add `scripts/smoke-bundled-runtime.sh`; packaging now fails if bundled Node or
  Python cannot start or Node lacks the JIT entitlement.
- Surface school-search failures as an actionable alert instead of `[]`.
- Start each headed SSO attempt on a new page after closing stale persistent
  profile pages.
- Detect CU-style stale-request pages and return a recoverable `login_expired`
  error.
- Add `Restart sign-in` and `Check again` onboarding actions, plus short
  post-browser session polling.
- Require a fresh `fresh_complete` sync projection, a sync id/timestamp, and a
  completed progress artifact containing courses before onboarding finishes.

## Verification

- Frontend tests: 77 passed.
- Browser tests: 316 passed.
- Rust tests: 20 passed.
- TypeScript/Vite production build: passed.
- Installed bundled-runtime smoke test: passed.
- `cargo fmt --all -- --check`: reports pre-existing formatting drift in
  untouched Rust files; no unrelated formatting rewrite was made.

## Release

- Commits: `4d50d2e`, `256873b`, `54c0395`, `3239c97`, `d5c5ed2`
- Branch: `main`, pushed to `origin/main`
- DMG: `app/src-tauri/target/release/bundle/dmg/Kairos_0.1.0_aarch64.dmg`
- DMG SHA-256: `af5eaed8d34197f658a13ab659e398c107cccbe950916f85bd9c617c5197be1d`
- `hdiutil verify`: passed.
- Developer ID signing and deep seal verification: passed.
- Bundled Node JIT entitlement: present.
- Notarization: not completed. No Apple notarization credentials or
  `notarytool` keychain profile were available in the environment; Tauri
  therefore skipped submission. `spctl` correctly reports
  `Unnotarized Developer ID`.
- Installed `/Applications/Kairos.app`: not replaced, because the DMG is not
  notarized/stapled yet.

## Follow-up audit (same day)

- `login_expired` never reached the student: `run_open_canvas` used
  `run_status`, which drops stderr, so the UI only saw `exited with exit
  status: 2` and showed the generic message. It now forwards the
  `login_expired:` line.
- `open-canvas.mjs` closed every existing page before opening the new one
  (closing the last page can end a persistent Chrome context before the
  `close` handler was attached). It now opens the fresh page first and
  attaches the handler first. Stale-request detection is limited to
  non-Canvas hosts so course content can't end a signed-in session.
- Onboarding sync dead end: `sync-study-sources` re-projected any existing
  generation without fetching, so a generation older than 24 h always
  verified as `stale_*` and every retry failed. It now fetches again unless
  the current generation is within the soft-stale window.
- Verification accepted only `fresh_complete`; one failed endpoint
  (`fresh_partial`) blocked onboarding. Both fresh states now pass. The raw
  "sync verification did not produce…" text was shown to students; failures
  now use the plain sync message, and zero courses gets its own wording.
- `scripts/macos-codesign/codesign` refused any call ending in
  `Kairos.app` without `--sign` (e.g. `codesign --verify`). It now passes
  non-signing calls through.
- `package-macos.sh` hardcoded `Kairos_0.1.0_aarch64.dmg`; it now copies any
  `Kairos_*.dmg`, smokes the mirror build before overwriting the checkout,
  and re-verifies the seal after the copy.
- Notarization note: `package-macos.sh` deliberately unsets Apple credentials,
  so it never notarizes; that is a separate manual step, not a missing
  credential in this environment.
- Tests: frontend 80 passed (3 new), browser 316 passed, Rust 20 passed.
