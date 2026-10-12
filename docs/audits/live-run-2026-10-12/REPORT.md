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
