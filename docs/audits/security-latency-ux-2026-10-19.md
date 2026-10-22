# Security, latency, and UI audit — 2026-10-19

Source audit of the Kairos repository, plus a Vite walk of the app shell with no Canvas session. No live SSO, PAT, Gmail/Calendar send, or funded relay. No secrets were read. Findings are source-confirmed unless marked unverified.

The uncommitted report that was already in this file treated a dead `.palette` override as a shipped fix. This pass rechecked that claim. The command bar does not use the `palette` class.

## Connection map

| Row | Path and caller → callee | Direction, trust, sync/async, failure | Secret touch and fan-out |
|---|---|---|---|
| C1 | SSO → Canvas REST → inbox: `app/src-tauri/src/daemon.rs` `run_canvas_sync` → `browser/scripts/sync-canvas-canonical.mjs` → `browser/scripts/lib/canvas-session.mjs` `api` | Student Playwright page fetches relative Canvas paths with cookies. Canvas text is data. The Tauri command waits on a background thread; the daemon cadence thread waits on the same script. A non-zero exit is an error string. A per-course 403 is recorded as `unavailable_endpoints` by the sync script (architecture claim; not re-timed here). | Cookies stay in the profile browser directory. One sync fans out to courses, projections, the freshness hook, and Today/Week. |
| C2 | Optional PAT MCP: `src/canvas_mcp/server.py` tools → `src/canvas_mcp/core/client.py` | `@validate_params` and `readOnlyHint` on the tools inspected. Canvas bodies are untrusted. API GETs in `client.py` set `follow_redirects=False` for the upload confirm path; file download uses `follow_redirects=True` (`src/canvas_mcp/tools/files.py` `download_course_file`). | PAT only when configured. Not used in this audit. |
| C3 | Freshness: `app/extension-chrome/sw.js` → `app/native-messaging/host.py` `handle` → `browser/scripts/freshness-tick.mjs` → `inbox/freshness/` → `daemon.rs` `spawn_freshness_loop` | Extension messages are limited by `senderMayAsk`. The host allow-lists message types and rejects unknown ones. The daemon thread runs the tick every 120s (`FRESHNESS_TICK`) and does not wait on the webview. A full delta backlog returns `backlog_full`. | Canvas cookies stay in Chrome. Deltas and `dashboard.json` fan out to Today, Week, and notification policy. |
| C4 | Tokenized feeds: `browser/scripts/lib/canvas-feeds.mjs` `captureFeeds` → `{user_root}/auth/feeds.json` → `pollFeeds` / `fetchFeed` | Bearer URLs. `feedList` drops the whole list when `base` is not a URL, and drops any feed whose origin is not that base. `fetchFeed` sets `redirect: "manual"`. Polling is sequential. A failed feed is recorded and the loop continues. | Feed URLs stay in the auth file. Parsed events fan out through the freshness dashboard. |
| C5 | Desktop shell: `app/src/ipc.ts` `invoke` → `app/src-tauri/src/commands.rs` → `daemon.rs` child processes | The webview is not the security boundary. Commands that wait on a child are `async` and enter `blocking` (`spawn_blocking`). `read_school_profile` and the other file readers stay synchronous on the main thread. `Runtime::usable` refuses Python commands when mode is `Broken`. | Profile root is chosen in Rust. Sync, study, and week plan fan out into projections and refresh events. |
| C6 | Study: `app/src/study/api.ts` `transport.send` → Tauri `study` → `daemon.rs` `run_study` | Request keys `now`, `user_root`, `root`, `path`, and `zone` are rejected. The child is waited with `wait_with_output` and no deadline or cancel. Outside Tauri, the same call fetches `127.0.0.1:1421` with no timeout. | Optional relay config under auth. Answer keys are not put in argv. |
| C7 | Connectors: `mcp-servers/gcal/server.py` and `mcp-servers/gmail/server.py` → `mcp-servers/common/actuator.py` `gate_with_human` / `gate_connector_write` | Writes require a fingerprint-bound token and `human_approved` set only from `gate_with_human`. Apple Calendar `create_event` stays a dry-run (`mcp-servers/apple-cal/server.py`). | OAuth tokens under auth. One confirmation is single-use in the gate tests; not re-executed against a live provider. |
| C8 | Plugins: `browser/scripts/lib/connector-registry.mjs` `cu-boulder/campusgroups` → `plugins/cu-boulder-campusgroups/` | Static registry entry and plugin directory both exist. Bucket-B device automation is refused in the registry comments. | Browser profile for the reviewed connector. Not invoked. |
| C9 | Deep links and prefs: `app/src-tauri/src/main.rs` `open_link` → `app/src/nav.ts` `routeFromUrl` | Any app can open `kairos://`. Rust rejects non-`kairos://`, control characters, and URLs over 512 characters. TypeScript checks course, item, and settings segments before they become a route. | No secret. Routes select a tab or an id already loaded. They do not open files or connector writes. |
| C10 | Skill routing: `skills/` + `AGENTS.md` index → `src/canvas_mcp/core/skill_router.py` | Router ranks bundled skill text. Canvas text is not a router instruction by itself. No `self_improve` package is present. | Local skill files only. |
| C11 | Shared extension code: `browser/scripts/lib/freshness/` → `app/extension-chrome/shared/` via `vendor-shared` | `browser/tests/extension.test.mjs` “vendored copies match the brain's source” passed. | No secrets. |
| C12 | Voice: `browser/scripts/lib/voice/tools.mjs` `save_goal` / `append_class_note` → inbox files; UI `app/src/voice/VoiceSheet.tsx` + `InkRing.tsx` | The tool map has those two names only. Audio leaves only toward the Live API from the voice session. The sheet is an ink ring plus a text state. | Transcripts stay local. |

Broken connections: none confirmed. Registry and plugin directory match. Generated shared JS matches its source. `docs/architecture.md` still matches the boundaries checked (preview-only Canvas writes, feed secret path, 2-minute freshness tick, native-host stdlib).

Hidden couplings:

- `spawn_freshness_loop` and `spawn_cadence_loop` are separate threads and both read and write the same profile while a manual sync can be in `blocking`.
- `refresh_briefs` in `commands.rs` coalesces with `BRIEF_REFRESH`, but it still shares inbox files with those loops.
- Study, voice, and sync are separate processes on the same profile directory.

## Changed

### 1. Canvas and feed fetches do not follow redirects

- Symptom: `canvasGet` and `fetchFeed` used `redirect: "follow"`, so a 302 could send the student session or a bearer feed URL to another host. The calendar ICS URL was also accepted with no captured origin.
- Earliest cause: those two functions are the only fetch entry points for extension Canvas reads and for the feed watcher. Callers never see the request.
- Edited layer: `app/extension-chrome/lib/canvas-read.js` `canvasGet` and `browser/scripts/lib/canvas-feeds.mjs` `feedList` / `fetchFeed`. A missing or invalid `base` yields no polls. A feed on another origin is dropped. A redirect response is a failed poll and its body is not read.
- Callers (`sw.js`, `pollFeeds`) do not each check origins or redirect mode.
- Verification: `browser/tests/extension-libs.test.mjs` (“canvasGet does not follow a redirect”) and `browser/tests/freshness.test.mjs` (origin filter and redirect poll). The freshness fixture now includes `base`, which `captureFeeds` already writes.

### 2. Child waits do not run on the webview thread

- Symptom: `choose_school`, `save_learning_profile`, `read_due_reviews`, and `record_review_outcome` were synchronous Tauri commands. `commands.rs` already states that a non-async command runs on the main thread, and each of these calls `Command::output`.
- Earliest cause: the command boundary, not the Node or Python scripts. `blocking` already existed for sync, study, and week plan. These four handlers never entered it.
- Edited layer: `app/src-tauri/src/commands.rs`. All four are `async` and call `blocking`. The helper comment now states that every child wait has to enter there.
- Callers in `app/src/ipc.ts` already `await invoke`, so they did not grow a special case.
- Verification: `scripts/native-mirror.sh cargo test --quiet` — 44 tests passed. This does not add a timeout. The wait can still run until the child exits; that remains open below.

### 3. Voice state is UI type

- Symptom: `.voice-label` rendered “Listening…”, “Thinking…”, and the other live states in Caveat. Those strings are `aria-live` status, not a margin note.
- Earliest cause: the shared `.voice-label` rule in `app/src/notebook.css`, which every voice state uses.
- Edited layer: that rule now uses `--font-ui` and `--fg`.
- No screen overrides the label typeface.
- Verification: `VoiceSheet.test.tsx` and `CommandBar.test.tsx` passed (14 tests). The voice sheet was not on screen during the browser walk because voice was not live.

### 4. Removed a command-bar override that did not apply

- Symptom: an uncommitted `.workspace .palette` rule disabled blur. Nothing in `app/src` renders `class="palette"`. The command bar is `.cmd-bar.sheet` (`app/src/components/CommandBar.tsx`).
- Earliest cause: `notebook.css` `.sheet` already sets `backdrop-filter: none`. The `.palette` glass in `spatial.css` is an unused recipe.
- Edited layer: the dead override was removed. The glass rule was not copied onto `.cmd-bar`.
- Verification: in the Vite shell, the open command bar computed `backdrop-filter: none`. Escape closed it and left the Study heading in place.

## Open

### Security

No further confirmed security defect was changed. These were traced and left open because a local patch would be the wrong layer or could not be verified:

- **Low, traced — in-page Canvas fetch still follows redirects.** `browser/scripts/lib/canvas-session.mjs` `api` calls `fetch` inside the Playwright page with no `redirect` mode. A Canvas 302 to another host would be followed with that page’s cookie rules. The extension and feed watchers no longer do this. Changing `api` without a Canvas session can break a legitimate redirect and was not landed. Confirm with one recorded 302 from a real Canvas API call.
- **Low, traced — extension links allow any https URL.** `safeHref` in `app/extension-chrome/ui/dashboard.js` and `app/extension-chrome/panel.js` accepts any `https:` URL. Assignment links and LTI escapes both use it. A same-origin lock would be a product change, not a one-line guard, so it was not added.

### Latency

- **Medium, traced — child processes have no deadline.** `daemon.rs` `run_freshness_tick`, `run_briefs`, `run_study`, and `run_week_plan` wait with `output()` or `wait_with_output()` until the child exits. `blocking` only moves that wait off the webview thread. A hung Node or Python process leaves the invoke pending. The structural change is one child supervisor used by every spawn, with cancel from the command that owns it. A timeout on one function was not added.
- **Medium, traced — feed polls are head-of-line.** `pollFeeds` awaits each feed before the next. One slow host delays later courses and the dashboard write. The structural change is bounded concurrency in `pollFeeds` with a single state merge. A per-feed timeout was not added.
- **Low, traced — profile files can sit on iCloud.** `scripts/native-mirror.sh` mirrors the build tree only. `read_school_profile` and the freshness tick still read `{user_root}` directly. If that directory is under iCloud, a non-local file stalls the command. A second cache was not added.

### UI/UX

No additional shipped-surface defect was confirmed beyond the voice label above. The Vite walk (no Tauri, no Canvas) showed:

- Today says Canvas has not been read, and that this is not an empty week.
- Week, after a short “Loading your week…”, shows an empty plan and an hours question.
- Courses says no courses until sync.
- Study says no exams in the Canvas copy, with Start practice still available.
- Advisor says it will not claim degree requirements until the student pastes an audit.
- Settings Canvas actions are disabled and say runtime details belong to the desktop app.
- ⌘K opens over Study, lists actions, and Escape returns to Study.

Connector preview, a signed-out versus empty distinction inside the desktop webview, and focus order with a real profile were not exercised. See Unverified.

## Startup and tick chains

- Startup, observed in Vite and traced in `App.tsx`: mount → `resolveOnboarded` → in Tauri, `read_school_profile` (sync file read) → workspace. While that flag is unknown the shell is `<div className="workspace" aria-busy="true" />`. The local read was not timed.
- Manual sync: Settings or ⌘K → `sync_canvas` → `blocking` → `run_canvas_sync` → Node canonical sync → `inbox-updated`.
- Freshness: daemon thread every 120s → `run_freshness_tick` → Node tick → deltas and `pollFeeds` → `freshness-updated`. A fixture tick in `browser/tests/freshness.test.mjs` took about 58ms. That is the test fixture, not a student profile.
- Study: Study view → `invoke("study")` → `run_study` → `wait_with_output`. This is still the longest unbounded wait. Moving it off the webview thread was already true before this pass.
- This pass removed the webview-thread wait on school choose, learning-profile save, and review score. It did not remove the freshness, study, or feed chains.

## Intentional boundaries confirmed

- `submit_assignment` and `comment_on_my_submission` are `readOnlyHint` previews in `src/canvas_mcp/tools/student_write.py`. No execute branch was added.
- Discussion post/reply stay preview-only (architecture and tool annotations; not given an execute path).
- Bucket-B / LTI / WebAssign / ZyBooks / PlayPosit / proctored work is not given a click path in the registry.
- No educator tools, quiz executor, SIS scraper, registration actuator, RateMyProfessors scraper, or `self_improve` package.
- Gmail send and Google Calendar create/update go through `gate_connector_write`. Apple Calendar stays a dry-run.
- Voice tools are `save_goal` and `append_class_note` only.
- The extension’s Canvas reader is GET-only, allow-listed, and does not read a CSRF token.
- The native host imports only the standard library and ignores unknown message types.
- `mark_module_item_done` still executes. The tool comment describes it as private module progress, not a submission. It was not treated as a preview-only defect.

## Unverified

- **Chrome redirect behavior:** confirm a Canvas 302 in the extension is reported as unavailable and that the request is not sent to the second origin. The unit test stubs `fetch`.
- **SSO `api` redirects:** one real Canvas 302 during sync, and whether the page follows it off the school host.
- **Two profiles:** switch `current_profile`, revoke the first session, and confirm each profile reads only its own auth and inbox.
- **Provider confirm:** change one argument on a Gmail or Calendar preview and confirm the old token is rejected, then approve the exact preview once.
- **Relay and voice egress:** with a test key, confirm outbound traffic is only the intended host and that logs stay content-free.
- **Desktop webview:** repeat Today → Week → Courses → Study → a connector preview → ⌘K inside the Tauri window, including keyboard focus and a real signed-out Canvas state. This walk used Vite at `localhost:1420` with onboarding skipped in `localStorage`.

## Verification

- `cd browser && node --test tests/extension-libs.test.mjs tests/freshness.test.mjs tests/extension.test.mjs` — 48 passed, including the vendored shared-code check.
- `cd app && npm test` — 24 files, 154 tests passed, then voice and command-bar tests again after the label change (14 passed).
- `scripts/native-mirror.sh cargo test --quiet` — 44 passed.
- Vite walk recorded above. No commit.
