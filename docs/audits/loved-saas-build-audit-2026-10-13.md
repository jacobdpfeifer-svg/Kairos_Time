# Loved-SaaS build audit — 2026-10-13

This audit compares the approved plan in `docs/research/saas-themes-applied-to-kairos-2026-10-13.md` with the current working tree. It records existing work instead of treating the uncommitted tree as a blank slate.

## Already built before this pass

| Area | Evidence | Status |
| --- | --- | --- |
| Notebook shell and five destinations | `app/src/App.tsx`, `app/src/nav.ts` | Built: Today, Week, Courses, Study, Advisor, Settings; legacy tab names migrate. |
| Today focus and consequence copy | `app/src/views/TodayView.tsx`, `app/src/consequence.ts` | Built, with changed row, semester line, sync actions, exam-week focus behavior, and item sheet. |
| Ask as a sheet | `app/src/ask/AskSheet.tsx`, `app/src/ask/AskPanel.tsx` | Built; last answer is a row, Escape/cancel works, and the live-assessment safety gate is covered. |
| Command bar | `app/src/components/CommandBar.tsx` | Built: commands, navigation, recent actions, grouping, shortcut help, keyboard navigation, Ask fallback. |
| Week | `app/src/views/WeekView.tsx`, `app/src/week/plan.ts`, `src/canvas_mcp/core/week_plan.py` | Built: estimates, capacity, deferral, accepted plans, leftovers, piles, calendar approval, undo, and local captures backend. |
| Courses and Study path | `app/src/views/CoursesView.tsx`, `app/src/views/StudyPathView.tsx` | Built, including course files, exam scope plumbing, due reviews, exam tracks, and practice routing. |
| Advisor | `app/src/views/AdvisorView.tsx`, `app/src-tauri/src/advisor.rs` | Built and separately audited in `academic-advisor-build-audit-2026-10-13.md`. |
| First run and drop target | `app/src/components/FirstRun.tsx`, `app/src/components/FileDrop.tsx` | Built: school discovery, SSO, sync progress, three-step flow, and global file drop. |
| Extension read-only surface | `app/extension-chrome/` | Built for the currently supported Canvas origins: dashboard stage, side panel, freshness classification, native host calls, and read-only guardrails. |
| Native tray and autostart registration | `app/src-tauri/src/main.rs` | Tray and autostart plugin are registered; this pass adds the approved navigation menu entries. |

## Completed in this pass

- Added `app/src/capture/parseLine.ts`: dependency-free quick-add parsing for today, tomorrow, weekdays, and known course labels.
- Added date/course/title parser tests.
- Wired the Command Bar Add group to the existing `week_plan capture` bridge. Date-bearing lines show a muted date preview before saving; plain questions still fall through to Ask.
- Added a single deep-link event adapter in `ipc.ts` and route handling in `App.tsx`, including `today`, `week`, `course`, `item`, `study`, `advisor`, `settings`, and `capture` routes.
- Expanded the native tray menu to `Next: Open Today`, `Open Today`, `Capture…`, `Sync now`, and `Quit`, all using the same route/event path.

## Intentionally still open

These are real platform integrations, not merely missing React components:

1. Native notifications: `tauri-plugin-notification`, quiet-hours/calendar checks, deduplication, and the three-trigger daemon policy are not installed/wired yet.
2. Global hotkey capture window and hold-to-talk: the voice presence/sheet and local voice server exist, but no global shortcut plugin or secondary capture window invokes them.
3. Close-to-tray and URL scheme registration: the frontend route/event contract exists, but the macOS lifecycle and `tauri-plugin-deep-link` registration still need to be added to the native bundle.
4. Arbitrary-school extension permissions and first-run native-host installation: the extension remains constrained to the existing supported origins and the host installer is still a documented/manual step.
5. Settings controls for the four native opt-ins should be added only alongside their native implementations so the controls cannot promise behavior that is not active.

## Second pass (code quality and connections)

Reviewed the capture parser, the command-bar write, deep-link routing, the tray menu, and the week-plan store they talk to.

Fixed in this pass:

- Captures stored a UTC calendar day (`toISOString().slice(0, 10)`) while Week keys days in local time. An evening "thu" in a US timezone landed on Friday. The stored day is now the local calendar day, which is what `week_plan.py` validates.
- The parser only recognized three-letter weekdays, treated "sat" and "sun" as dates inside ordinary sentences, and matched a course label but never its name. Full weekday names work, those two short words only count when they read as a date, and the course name matches back to the course label. A trailing "for" left behind by the course is dropped.
- The command-bar hint used a middle-dot chain. It now reads "Thu, Oct 15 in CSCI 1300". Saving a capture offers Undo, which removes that local row.
- `kairos://ask` had no route. It opens the Ask sheet on Today, same as the other `kairos://` links.
- A capture did not show on Today, and Week did not reload if it was already open. Today shows a capture planned for today as the focus when Canvas has no next move, and lists the rest under "You added". Week refreshes from the plan-changed signal.
- Course labels for capture and file drop were loaded only after ⌘K had been opened once. They now load with the signed-in workspace.
- The tray row "Next: Open Today" duplicated Open Today. Today now sends the focus title, and the menu reads "Next: …". Sync now from the tray runs off the menu thread so a Canvas sync cannot freeze the menu.

Still open, and unchanged: native notification policy, the global-hotkey capture window, close-to-tray, macOS URL-scheme registration, arbitrary-school extension permissions, and automatic native-host installation. The route and tray events are the contract those pieces should call.

## Verification

- App tests: **131 passed / 22 files** after the second pass (125 before it).
- TypeScript: `npx tsc --noEmit` passed.
- Production frontend build: passed earlier in this audit.
- Native: `cargo check` passed; only two pre-existing dead-code warnings remain.
- No Canvas-visible write path was introduced. Typed capture writes only to the local week-plan store.

## Third pass: the open items, then a full repo audit

The second pass left the native and extension work open. This pass built it, then audited the whole working tree.

### Bugs found and fixed

- **Menu bar opened the glass Peek window.** "Open Today", "Next", and "Capture…" called `show_dock`, which shrank the workspace into a 320×300 always-on-top HudWindow (glass, MASTER §13), too small to read Today. The compact dock is retired: `dock.rs` keeps only the onboarding and workspace sizes, the tray opens the real workspace, and `window-vibrancy` is gone from `Cargo.toml`.
- **Every Canvas sync froze the window.** Non-async Tauri commands run on the main thread, and `sync_canvas` joined its thread there. `sync_canvas`, `sync_study_sources`, `export_canvas`, `open_canvas_sso`, `check_canvas_session`, `search_schools`, `study`, and `week_plan` are now async and do their work on the blocking pool.
- **The extension could drop Canvas changes.** It advanced its change signature even when the app's backlog was full, so that change never reached the app. It now advances only when the app accepted the delta or there is no app.
- **The App test hid a broken mock.** A `typeof onDeepLink === "function"` guard existed only because the test's `ipc` mock lacked the export. The guard is gone and the mock is complete.

### Built

| Item | Where | Notes |
| --- | --- | --- |
| Notifications | `app/src/notify/policy.ts` (pure, tested), `useNotifications.ts`, `tauri-plugin-notification` | Three triggers, quiet 11 PM to 8 AM and during Canvas calendar events, three a day, each once. Off until turned on; asks macOS permission when enabled. |
| Keep running, Dock reopen | `main.rs` `on_window_event`, `RunEvent::Reopen`, `prefs.rs` | Opt-in. Closing hides the window; the menu bar and sync loops continue. |
| Launch at login | Settings, existing autostart plugin | Opt-in toggle. |
| Capture shortcut | `shortcut.rs`, `tauri-plugin-global-shortcut` | Opt-in, three preset combinations, validated before registering. Opens ⌘K on the capture line. |
| `kairos://` links | `tauri-plugin-deep-link`, `main.rs` `open_link`, `take_pending_link` | One `deep-link` event; a pending slot covers cold starts. Non-`kairos://` URLs are ignored (tested). |
| Native host install | `nativehost.rs` | Copies `host.py` out of the bundle, runs it with the bundled Python, writes manifests for Chrome, Chromium, Brave, Edge, and Arc. Settings shows whether the extension has connected. |
| Any school's Canvas | `canvas-read.js`, `sw.js`, `panel.js`, `host.py get_school` | `optional_host_permissions: https://*/*`, granted one origin at a time from the side panel. Reads still require Chrome's grant. |
| Extension surface | `ui/dashboard.js`, `panel.js`, `lib/format.js` | Badge counts what needs you (ink, not red). Quiz and graded discussion pages resolve to their assignment. "Open in Kairos" links. Panel refreshes after each poll. Stale app data is said. MASTER §13 fixes: numbered indexes, dot chains, IANA zone names, uppercase labels, the colored left border, and "Agent can do". Beta readout button removed. |
| Landing | `landing/` | Says a Mac and Chrome are needed and names the extension; uppercase kicker removed; the GitHub path's button says what it does. |

### Removed in the repo audit

- 14 IPC commands nothing called (Top 3, brief streak, learn progress, evaluation compare, commitment ×3, check intention, route intent, work surface, bootstrap sync, save user profile, show/hide dock), with their TS wrappers, 8 unused types, Rust runners, capabilities, and permission files. The Python cores stay; skills use them.
- `inbox.rs` Top 3 parsing (and its two tests): dead since the dock was retired.
- About 1,890 lines of CSS whose selectors match nothing rendered (old dock, palette, Top 3, plan, calendar, Blot, Peek skeletons). Screens were compared pixel for pixel before and after in paper, night, and on each tab: identical apart from antialiasing.
- The retired 6-step onboarding wizard and its games, CalendarView, ApprovalSheet, NarrateAfter, LedgerViewer, Top3Sticky, Skeleton (earlier this session).

### Still open, on purpose

1. **Hold-to-talk voice.** The voice intake needs a Gemini key from a developer `.env`; the packaged app has no way to give students one. A control that can't work for any student was left out; MASTER §08 says so.
2. **First-run "Add Kairos to Chrome".** There is no Chrome Web Store listing to send students to. The native host installs itself, so the step can be added the day a listing exists.
3. **Notification clicks don't route.** The desktop notification plugin has no click callback on macOS; the body says to open Kairos instead.
4. **Extension e2e.** `tools/e2e-mock-canvas.mjs` needs Playwright's own Chromium, which isn't downloaded on this machine; branded Chrome no longer loads unpacked extensions. The pure libraries are unit-tested in `browser/tests/extension-libs.test.mjs`.
5. **`cargo fmt` drift** in files this pass didn't write (93 diffs), as recorded in the live-run audit. New Rust files are formatted.
6. **Waitlist and DMG hosting** stay out of scope.

### Verification (this pass)

- App: `npx tsc --noEmit` clean; Vitest **136 passed / 23 files**; `npm run build` clean.
- Browser and extension: **321 passed**, including the updated extension contract tests and new library tests.
- Native: `cargo test --locked` **31 passed**, zero warnings.
- Python: full suite **963 passed**, 36 skipped, 36 xfailed (remaining AI-eval findings still pinned).
