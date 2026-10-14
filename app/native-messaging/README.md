# Native Messaging host — `com.kairosstudy.daemon`

Moves data between the Chrome extension (`app/extension-chrome/`) and the
student's `{user_root}`. It never talks to Canvas.

`host.py` is **standard library only**. The app's launcher runs it with the
bundled Python; the developer script runs it under the system `python3`
(3.9 on macOS), so it must work with either. It mirrors
the user-root rule from `app/src-tauri/src/runtime.rs`: `DEV_USER_ROOT`, else
`<app support>/Kairos/<profile>` where the profile comes from
`PRODUCT_USER_ID`, then the app's `current_profile` file, then `dev`.

## Messages

| `type` | Does |
|---|---|
| `canvas_delta` | validates and queues the extension's change slice in `inbox/freshness/deltas/` (0600) for the freshness tick |
| `canvas_signed_out` | queues a signed-out status |
| `get_dashboard` | returns `inbox/freshness/dashboard.json` |
| `get_assignment_context` | skip cost + recent announcements/changes for one assignment |
| `queue_calendar_suggestion` | appends to `inbox/calendar-suggestions.jsonl` (the app's Week page, where the student says yes to each one) |
| `queue_ask` | saves a private question for the app's Ask (`study/ask-inbox/`); the app classifies it, live quizzes stay unanswered |
| `get_school` | the https Canvas origin chosen at sign-up, so the extension can offer to turn on there |
| `ping` | records beta funnel markers (timestamps and counts only) |
| `canvas_focus`, `canvas_visible` | legacy sensor rows in `sensors/chrome.jsonl` |

Tests: `tests/core/test_native_messaging_host.py` (runs the host with
`/usr/bin/python3 -S -I`).

## Install (macOS)

The desktop app installs the host on launch (`app/src-tauri/src/nativehost.rs`):
it copies `host.py` out of the bundle, writes a launcher that runs it with the
app's bundled Python (a stock Mac's `/usr/bin/python3` is only an Xcode
installer stub), and writes the manifest for each installed Chromium browser.
From a checkout without the app:

```bash
bash app/native-messaging/install-macos.sh
```

The installer copies `host.py` to
`~/Library/Application Support/Kairos/native-host/` and points the
Chrome, Chromium, and Canary manifests at the copy. Chrome-launched
processes cannot read files in iCloud Drive ("Operation not permitted"), so
the host is never run from the checkout. Re-run the installer after editing
`host.py`. Set `KAIROS_EXTENSION_ID` only for a differently keyed build.

## Files

| Path | Role |
|------|------|
| `host.py` | stdio NM host (length-prefixed JSON) |
| `com.kairosstudy.daemon.json` | manifest template (`path` + `allowed_origins` filled by the installer) |
| `install-macos.sh` | copies the host and writes the manifests |
