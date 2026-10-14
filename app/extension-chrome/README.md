# Kairos for Canvas (Chrome extension, MV3)

Keeps an eye on Canvas for the student and shows it where they already are.
Decision record: [`docs/handoff/freshness-extension-spike-2026-09-29.md`](../../docs/handoff/freshness-extension-spike-2026-09-29.md) (signed 2026-09-29).

## What it does

- **Background check, every 5 minutes** (`sw.js`, `chrome.alarms`): one
  `GET /api/v1/users/self/activity_stream/summary` with the student's own
  Canvas session. When the counts move, it fetches the changed slice (recent
  activity stream + a planner window), classifies it locally, and hands it to
  the desktop brain through the native host. A 401 shows a `!` badge: "sign
  in to Canvas". Otherwise the badge counts what needs the student (moved due
  dates, new assignments, comments) since they last opened the side panel.
- **Canvas dashboard stage** (`ui/dashboard.js`, shadow DOM): next step,
  what changed, what professors said (action items pulled from
  announcements), and work blocks suggested for the student's calendar
  (sent to Kairos, where nothing is added until they say yes on Week).
- **Side panel on assignment, quiz, and graded discussion pages** (`panel.html`): rubric as a checklist
  (state stays in this browser), announcements that mention it, what
  changed, cost of skipping, and a fastest honest path.
- **Open in Kairos** links use `kairos://` routes the Mac app registers.
- **Any school's Canvas** (2026-10-13): CU and `*.instructure.com` are granted
  in the manifest. Any other https Canvas is offered in the side panel from the
  school the Mac app found at sign-up (`get_school` on the native host); the
  student grants that one origin in Chrome's prompt, and the worker registers
  the dashboard stage for it.
- **Without the desktop app** it still shows changes and the digest from its
  own classification. Next step and cost of skipping need the app.

## Hard rules (tested in `browser/tests/extension.test.mjs`)

- Canvas access goes only through `lib/canvas-read.js`: GET, six
  allow-listed read endpoints (the quiz and discussion lookups only find the
  assignment behind a page), https origins the student's Chrome has granted,
  no method parameter, never reads the CSRF token. Nothing here can submit,
  post, comment, or edit in Canvas.
- Canvas-authored text is inserted with `textContent` only — no
  `innerHTML`, no `eval`.
- Permissions are exactly `alarms`, `storage`, `nativeMessaging`,
  `sidePanel`, `scripting` (only to run the dashboard stage on a granted
  school Canvas), host access to CU and Instructure Canvas, and optional
  https host access asked one origin at a time. No `tabs` or `cookies`.
- The beta funnel (`bumpFunnel` in `sw.js`) stores timestamps and counts
  only; see [`docs/handoff/hosting-decision-criteria-2026-09-30.md`](../../docs/handoff/hosting-decision-criteria-2026-09-30.md).

## Files

| Path | Role |
|---|---|
| `sw.js` | background worker: poll, delta, native bridge, views, funnel |
| `lib/canvas-read.js` | the only Canvas access (GET allowlist) |
| `lib/native.js` | promise wrapper for `com.kairosstudy.daemon` |
| `lib/format.js`, `lib/assignment-plan.js` | display helpers, checklist + path builders |
| `shared/*.js` | **generated** from `browser/scripts/lib/freshness/*.mjs` — edit the source, then run `node app/extension-chrome/tools/vendor-shared.mjs` |
| `ui/dashboard.js`, `ui/dashboard.css` | Canvas dashboard page (Notebook design system, `design-system/kairos/MASTER.md`) |
| `panel.html`, `panel.js`, `panel.css` | side panel (Notebook design system) |
| `shared/blot/*.js` | **generated** voice-level engine from `app/src/blot/core/` (same tool); not rendered in the panel (the Blot character was retired 2026-10-07) |
| `icons/kairos-*.png` | ink square with a highlighter "k", written by `node app/extension-chrome/tools/kairos-icons.mjs` (`--check` to verify) |
| `fonts/` | self-hosted Big Shoulders Display, IBM Plex Sans/Mono (OFL, licenses alongside) |
| `tools/` | dev only — not part of a packaged build |

## Try it

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
   The fixed `key` keeps the ID at `jkjkbgcbpakeenemjgkfohbcfbghmall`.
2. Open the Kairos app once. It installs the native host for Chrome,
   Chromium, Brave, Edge, and Arc (`app/src-tauri/src/nativehost.rs`). From a
   checkout without the app, `bash app/native-messaging/install-macos.sh`
   does the same.

3. Open Canvas. The stage appears above the dashboard; click the toolbar
   icon for the side panel.

## Check it without a Canvas account

```bash
node app/extension-chrome/tools/e2e-mock-canvas.mjs
```

It serves a mock `https://canvas.colorado.edu`, loads this extension in
Playwright's Chromium, runs the real native host and the real freshness tick,
and writes screenshots plus `report.json`. It needs Playwright's own Chromium
(`npx playwright install chromium` in `browser/`): branded Chrome no longer
loads unpacked extensions from the command line.
