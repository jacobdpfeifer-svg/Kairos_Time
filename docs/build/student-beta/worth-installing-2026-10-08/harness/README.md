# Walkthrough and installed-path harness (evidence tooling, not product code)

Used for the 2026-10-08 "worth installing" pass. Nothing here ships.

## Webview walkthrough (synthetic profile, stubbed Canvas)

1. Build the real Rust file readers as a CLI: copy `harness.rs` to
   `<native mirror>/app/src-tauri/examples/` and run `cargo build --example harness`
   there (`#[path]` includes `semester.rs`, `canvas.rs`, `calendar.rs`).
   Point `HARNESS_BIN` at the built binary.
2. `cd app && node ./node_modules/vite/bin/vite.js --port 1430 --strictPort --host 127.0.0.1`
3. `REPO=<checkout> ROOT=<empty dir> [SSO=fail] [SYNC=fail|empty] node server.mjs`. This answers
   `invoke()` like the native app: real Python study core (packaged shape), real
   `school.mjs`, real Rust readers, real learn_loop/commitment/habit CLIs. Canvas
   SSO and network sync are stubbed: sync copies `tests/fixtures/study/ui-round1/*.json`.
4. `REPO=<checkout> OUT=<dir> [STATE='{"pn_onboarded":"1"}'] [VW=720 VH=520] node drive.mjs s7-fixed.mjs`
   (Playwright with installed Chrome; `shim.js` provides `__TAURI_INTERNALS__`).

Limits: the stubbed sync writes study-sources only, not a canonical generation. So
Home's sync-health banner reads "hasn't finished reading Canvas" in every harness
run. That is a harness artifact. In the app, the first-run sync is a full canonical
read (`sync-study-sources.mjs` runs `sync-canvas-canonical.mjs` when no generation exists).

## Installed-path probe

`installed-probe.sh <Kairos.app> <scratch dir>` runs the bundle's own Python and
Node against its own `core/` with `env -i` (no repo, uv, PYTHONPATH, npm, or system
Python), an empty synthetic profile, and an empty Playwright browser cache.
`probe-before.log` is the pre-fix DMG (SHA-256 f460f36a…); `probe-after.log`
is the fixed unsigned `.app` built in a private mirror.
Step 7 deliberately runs Node with no browser channel, to show the clean-machine
failure. The app itself now always passes `PLAYWRIGHT_CHANNEL=chrome` for installed
runs (`runtime.rs` `playwright_channel`, unit-tested).
