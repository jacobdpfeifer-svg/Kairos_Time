# "Worth installing" pass — 2026-10-08

**Verdict: `not yet`.** The private-beta path now works end to end on a synthetic
profile, and the installed bundle no longer depends on a developer checkout for
the paths probed. Classmates still can't install it without a Gatekeeper override.
No one has walked it on a clean Mac against live Canvas SSO. Without the hosted AI
relay, "quiz me" produces practice only from questions the student writes, or from
synthetic packets. Section 7 lists what flips it.

The packaging decision (`docs/handoff/pre-ship-decisions.md` row 4) is unchanged.
That is the owner's call.

## 1. Scope and revision

- Branch `main` @ `754fd64`. This pass's changes are uncommitted in the working tree (§4).
- The tree was shared during this pass. Another tool staged `app/src-tauri/runtime/`,
  edited `scripts/stage-runtime.sh` (removes broken npm/npx/corepack symlinks), wrote
  `DMG-BUILD-2026-10-08.md`, and added `design-system/kairos/logo/`. None of that was
  modified here. To avoid clobbering that tool's builds, native work used a separate
  mirror (`KAIROS_NATIVE_MIRROR=~/.cache/kairos-build-wi`).
- Tools: node 26.8.2, npm 11.19.1, cargo 1.98.1, uv (`~/.local/bin`), `.venv` Python
  3.12.14. Staged runtime: Python 3.12.15, Node 24.21.0.
- Not done: signing, notarization, live Canvas SSO, OAuth, relay deployment, a
  clean-machine install, or a screen-reader run.

## 2. Baseline and final commands

| Command | Baseline (before changes) | Final |
|---|---|---|
| `cd app && npm run build` | ok | ok |
| `cd app && npm test` | 15 files, 66 pass | 17 files, 76 pass |
| `cd browser && npm test` | 313 pass | 316 pass |
| `scripts/native-mirror.sh cargo test --locked` | 18 pass | 20 pass |
| `.venv/bin/python -m pytest tests/ services/relay/tests -q` | 866 pass, 19 skip | 873 pass, 19 skip |
| `.venv/bin/ruff check src/ tests/` | 3 × I001 import order (`tenants.py`, `test_school_profile.py`, `test_study_audit_regressions.py`) | same 3, none new |
| `.venv/bin/mypy src/` | blocked: numpy stub needs a newer `python_version` | same, unchanged |
| `bash tests/fixtures/synthetic-students/probes/e2e_day.sh` | — | 5/6. Step 4 hard-codes deadline 2026-10-06, and the commitment CLI checks the real clock, so it fails on any later day. Probe time bomb, not a product regression |
| `npm run tauri -- build --bundles app` (private mirror) | — | unsigned arm64 `.app`, ad-hoc signature, includes staged runtime |

## 3. Student-path findings

Walked in the Vite build under Playwright with installed Chrome, on a blank synthetic
profile. `invoke()` was answered by the app's real Rust file readers, the real Python
study core in its packaged shape, and the real `school.mjs`. Canvas SSO and network
sync were stubbed with fixture courses. Harness, scenarios and screenshots are in
[`worth-installing-2026-10-08/`](worth-installing-2026-10-08/). The installed path was
probed separately (below).

| Step | What the student sees | Before this pass | Now |
|---|---|---|---|
| Blank launch | "Where do you go to school?", focus on search | works | works |
| School discovery | public Instructure search, or paste a host | works; real search found CU Boulder | works |
| Terms | dialog with terms + privacy | **backdrop covered only a 420px column; raw Markdown (`**`, `#`, dead `./privacy.md` link); focus stayed behind; Escape did nothing** | full-window backdrop, readable text, focus moves in, Escape closes and returns focus |
| Canvas sign-in failure | message + Try again | **raw process text: "open-canvas exited with exit status: 1"** | plain next step; real messages still pass through |
| First sync failure | — | **error set, then onboarding ended at once: student landed on "No courses yet." with no reason or retry** | stays on the sync screen with a reason, Try again / Sign in again / Continue without classes |
| Home | date, one lead item, Next up, semester line | works; due times sourced and zone-labelled | also refreshes after any background sync (`inbox-updated`) |
| Exam → "Let's test your knowledge" → Study | — | **"No practice item is ready" → "Canvas data" → Settings opened on Appearance, and Settings → Canvas was inspect-only: no import, authoring or packets anywhere. Practice was unreachable for every new student** | "Choose material" opens Settings → Canvas with import, question authoring, exam dates and bundled packets |
| Import Canvas course | — | unreachable; and in the core, **a syllabus over 20k chars failed the whole course** (live D5) | imports; long sources clipped and labelled "first 20,000 characters" |
| Answer → feedback | stem, typed fields, check | works; **a pending draft save fired after submit, onto the assessed attempt (rejected by the core)** | no write after submit |
| Reload / resume | "You have an unfinished attempt here; your draft is saved" | works | works (draft restored after reload) |
| Feedback honesty | "Correct. … a baseline, not evidence of retention" | works | works |
| Checkers | — | **`(-∞, 2) ∪ (2, ∞)` and `1/2` marked incorrect** (live D8) | accepted; ambiguous input still rejected |
| Plan | due checks, commitment, calendar block | renders | renders |
| Calendar | month + suggestions | renders; suggestions are local, nothing writes without per-action confirm | same |
| Settings → Calendar | connector status | **stuck on "Loading connector status…": every connector command crashed in the packaged invocation (`ImportError: attempted relative import beyond top-level package`)** | honest "not configured" states |
| Settings → Diagnostics | runtime, profile, Python, Node | **a broken install was labelled "developer checkout"** | "incomplete install" |
| New profile (Settings → Profiles) | — | **webview flag is shared across profiles, so a new profile skipped first run and had no school or sign-in path** | first run whenever this profile has no school |
| 720×520 (min window), dark, reduced motion | bottom tab bar; logical tab order with visible focus rings | ok | ok |

Canvas-visible writes: none from any surface walked. Submit/comment/discussion stay
preview-only, and calendar/email writes stay behind per-action confirmation. Nothing
in this pass touches those paths.

### Installed path (item 10)

`harness/installed-probe.sh` runs a `Kairos.app`'s own bundled Python and Node against
its own `core/`. It scrubs the environment (`env -i`), uses an empty synthetic profile,
and points the Playwright browser cache at an empty directory, standing in for a
classmate's Mac.

| Probe | Pre-fix DMG (other tool's build, SHA f460f36a…) | Fixed `.app` (this pass) |
|---|---|---|
| study status / template import / offer | ok | ok |
| connectors-status | **ImportError** | ok |
| Plan-tab `learn_loop` | ok | ok |
| `school.mjs choose` | ok | ok |
| Canvas session check, no channel | **crash: no downloaded Chromium** | same when Node is called directly; the app now always passes `chrome` (unit-tested) |
| Canvas session check, `PLAYWRIGHT_CHANNEL=chrome` | `{"loggedIn":false}` | `{"loggedIn":false}` |
| reconcile helper used by every canonical sync | **`core/scripts/py-mirror-run.sh` (uv + rsync) is not bundled: every sync would be marked partial/failed** | bundled Python via `reconcile-command.mjs`; runs, exit 0 |
| checkout paths in bundled text | none | none |

Remaining contract gap: Canvas sign-in and sync need **Google Chrome installed**. The
app now says so at launch and in Diagnostics if Chrome is missing.

### Live-audit defects (2026-10-07) re-checked against this tree

| ID | State now |
|---|---|
| D1 | Day keys use the school zone; plan ends at exam start. Scope still shows "unknown" even when the tick description names topics (minor) |
| D2 | Cutoff is window start, or end − 1 h; not re-verified on live data |
| D3 | Module pages followed (`canvas-snapshot.mjs`); module Files not re-verified |
| D4 | Fixed (full body stored, 100k cap) |
| D5 | **Fixed this pass** |
| D6 | **Open.** Without the relay, a Canvas import yields 0 items; practice needs student-authored questions or synthetic packets |
| D7 | Not re-verified |
| D8 | **Fixed this pass** |
| D9 | **Fixed this pass** (dev path); the installed path no longer uses the script |
| D10–D20 | Not re-verified in this pass |
| D21 | Fixed (suite green) |

## 4. Changes made

| Fix | Files | Regression test |
|---|---|---|
| Packaged study core loads connectors (Settings → Calendar, Plan calendar block) | `src/canvas_mcp/core/study/cli.py` | `tests/core/test_study_packaged_shape.py` (spawns `-m study` exactly as `runtime.rs`; fails without the fix) |
| Installed runs drive installed Chrome; diagnose a missing Chrome | `app/src-tauri/src/runtime.rs` | `installed_runs_drive_installed_chrome_not_a_downloaded_chromium`, `browser_scripts_get_the_app_python_and_an_installed_browser_channel` |
| Sync reconcile uses the app's Python, not a dev script | `browser/scripts/lib/reconcile-command.mjs`, `browser/scripts/sync-canvas-canonical.mjs`, `runtime.rs` (`KAIROS_PYTHON` to children) | `browser/tests/reconcile-command.test.mjs`; Rust env test |
| First-sync failure stays recoverable; plain sign-in errors; runtime blocker at launch; terms dialog focus/Escape | `app/src/components/FirstRun.tsx` | `FirstRun.test.tsx` (4 new) |
| Terms readable, backdrop covers window | `app/src/components/LegalText.tsx`, `FirstRun.tsx`, `Onboarding.tsx`, `notebook.css` | `FirstRun.test.tsx` (no Markdown in dialog) |
| Study → practice material reachable | `App.tsx`, `SettingsView.tsx` (`initialGroup`, full `SourcesView`), `SourcesView.tsx` (`embedded`), `StudyView.tsx` copy | `App.test.tsx`, `StudyView.test.tsx` ("practice material in Settings") |
| Onboarding per profile | `App.tsx` (`resolveOnboarded`) | `App.test.tsx` |
| Home refreshes after sync | `HomeView.tsx` | `HomeView.sync.test.tsx` |
| No draft write after submit | `StudyView.tsx` | `StudyView.test.tsx` (fails without the fix) |
| Broken runtime labelled | `study/types.ts`, `SettingsView.tsx` | `tsc` |
| D5 long sources clipped and labelled | `src/canvas_mcp/core/study/canvas.py` | `test_live_audit_d5_long_syllabus_imports_clipped_not_failed` |
| D8 interval notation and fractions | `src/canvas_mcp/core/study/checkers.py` | `test_live_audit_d8_course_notation_and_fractions_are_not_marked_incorrect` |
| D9 mirror `schools/` | `scripts/py-mirror-run.sh` | verified on a fresh mirror |

Copy changes changed one existing assertion (`"Canvas data"` → `"Choose material"`).
No assertion was weakened.

## 5. Remaining blockers and human gates

Blockers to `worth installing`:

1. **Signing / notarization.** Unsigned builds are blocked by Gatekeeper. Owner decision: Apple Developer enrollment.
2. **Clean-Mac walk of the fixed build.** Install → first run → real SSO in Chrome → sync →
   Home → import → answer → quit → reopen, on a machine with no repo, Homebrew or Playwright cache.
3. **Live Canvas SSO + sync from the installed app** for at least one real account. The
   reconcile path and the Chrome channel are verified only by unit tests and a direct probe.
4. **Practice without AI (D6).** Owner decision: deploy the relay for beta testers, or
   accept that day-one "quiz me" means writing your own questions plus synthetic packets,
   and say so in the invite.

Human-only checks (unchanged from `pre-ship-human-walk.md` unless noted):
counsel review of terms/privacy (the dialog still says "not lawyer-reviewed");
Google OAuth smoke; Chrome native-messaging round trip; second-account/two-device SSO;
VoiceOver pass over first run, Study and Settings; and confirming that Settings →
Calendar copy addressed to "the owner" ("Owner must supply GOOGLE_OAUTH_CLIENT_SECRETS…")
is acceptable for testers.

## 6. Structural suggestions (not release blockers)

1. **Two first-run components.** `FirstRun.tsx` is live; `Onboarding.tsx` survives as
   Settings → Preferences and still owns `bootstrapCanvasSync`. Risk: fixes land in one
   and not the other (legal text needed both). Smallest step: move the preference games
   into their own component and delete the dead onboarding steps. Keep `FirstRun` as is.
   About ½ day, after the clean-Mac walk.
2. **Packaged-shape coverage is ad hoc.** Production runs the `study` package top-level
   (cwd `core/`), while pytest imports `canvas_mcp.core.study`. That gap hid the connector
   crash. Smallest step: run `test_study_packaged_shape.py` over every command in `cli.py`'s
   dispatch. Keep the stdlib-only boundary. About 2 hours.
3. **Dev-only helpers inside product scripts.** `sync-canvas-canonical.mjs` called a repo
   shell script; the installed app never had it. Smallest step: a CI check that every
   path a bundled script spawns resolves inside `bundle.resources`. Keep `py-mirror-run.sh`
   for terminal syncs. About ½ day.
4. **Settings is where practice starts.** Study's recovery now jumps into Settings → Canvas.
   That works, but it is a detour on the main path. Smallest step: a "Practice material"
   sheet opened from Study, reusing `SourcesView embedded`. Keep the Settings entry.
   About 1 day, after D6 is decided.
5. **The installed-path probe and the walkthrough harness are evidence only.** Smallest
   step: promote `installed-probe.sh` into `scripts/` and run it after every bundle build.
   Keep the harness out of the product. About 1 hour.
6. **First cadence sync waits 2 h after each launch.** Data stays labelled with its age,
   so this is not misleading. Smallest step: run one sync shortly after launch when the
   last success is older than the interval. About 2 hours.

## 7. Verdict and what flips it

**`not yet`.** The product path a classmate would take now works on synthetic data, and
the installed bundle needs no checkout, uv, PYTHONPATH, system Python or npm in what was
probed. It still can't be installed normally, hasn't met live SSO as an installed app,
and offers no instructor-derived practice without the relay.

Flip to `worth installing` when all of these exist:

1. A signed + notarized build of a commit that includes this pass.
2. A clean-Mac walk record of that build: install, first run, live SSO, sync complete,
   Home shows real courses, Study import + one answered item, quit, reopen with state kept.
3. A recorded D6 decision (relay deployed and smoke-tested, or the invite copy states the
   no-AI practice model).
4. `cd app && npm test`, `cd browser && npm test`, `cargo test`, and pytest green on that commit.
