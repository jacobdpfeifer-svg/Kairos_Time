# Comprehensive team review — 2026-10-23

Run per [`skills/audit/SKILL.md`](../../skills/audit/SKILL.md), in the working tree
(uncommitted motion §15 + weight §16/§17 work included). Two parts: an audit of the
weight-and-consequence pass itself, then passes 0–9.

Previous: [`security-latency-ux-2026-10-19.md`](security-latency-ux-2026-10-19.md),
[`loved-saas-build-audit-2026-10-13.md`](loved-saas-build-audit-2026-10-13.md).

---

## Part A — audit of the weight-and-consequence pass (MASTER §16/§17)

The pass was implemented against the plan. Nine of the twelve §16.8 debts and all three
§17.4 debts were genuinely paid; the wiring is complete (`remove_calendar_event` and
`restore_calendar_suggestion` are in `build.rs`, `main.rs`, `capabilities/default.json`
and have permission TOMLs; `useFlip` carries the hold as `transition-delay:
var(--t-hold)` with no duration in JS; keyboard `d` sets `instant` and skips the
transform; the toast queue holds a live Undo). What follows is what the pass got wrong.

### A1 — `remove_event` could destroy the student's calendar *(fixed)*

`app/src-tauri/src/calendar.rs`. The new undo rebuilt `inbox/calendar.jsonl` from rows
parsed through `read_events`, which **silently skips any line it cannot parse**, then
wrote the result with a non-atomic `fs::write`. Three failure modes, worst first:

- a malformed or partially-written line anywhere in the file was permanently deleted by
  an unrelated undo;
- a field written by a newer build was dropped on the serde round-trip;
- a crash or full disk during `fs::write` left a truncated calendar, with no temp file to
  fall back to — while three other modules in the same crate (`briefs.rs`, `prefs.rs`,
  `workspace.rs`) already had the tmp+rename pattern.

Now: lines are copied through byte for byte and only the line whose parsed `id` matches is
dropped; the write goes through a new `write_atomic` (tmp, 0600, rename, temp cleaned on
failure) which `dismiss_suggestion` and `restore_suggestion` also use. Tests assert a
`{not json` line survives a removal and that removing an absent id changes nothing.

### A2 — "Not now" left an invisible tab stop, and the toast could be its only way back *(fixed)*

`app/src/views/WeekView.tsx`, `app/src/notebook.css`. A declined suggestion collapsed to
`max-height: 0; opacity: 0; pointer-events: none` and stayed in the DOM forever. The two
buttons inside were still in the tab order and still exposed to assistive tech — a focus
stop the student cannot see (WCAG 2.4.3/2.4.7).

Worse, the way back depended on the toast, and `offerToast` caps the queue at one waiter:
when a live Undo and a waiting Undo are both present, **a third Undo-bearing toast is
dropped**. Decline was the one action with nothing on the page, so in that case the row
was gone with no recovery at all — a §16 violation ("an auto-dismissing toast is never
the only way back").

Now the row collapses to the single line that carries its own Undo button. §16.5 and
§16.8 item 4 in MASTER were corrected to state the resulting invariant: every rung-0 and
rung-2 action in §16.4 keeps a way back **on the page**, and nothing joins that table
without one.

### A3 — `Done` never left the week *(fixed)*

`app/src/week/plan.ts`. `buildWeek` pushed every capture with `done_at` onto
`model.done`, unfiltered, so the section accrued every item the student had ever finished
for the life of the profile. `doneThisWeek` now keeps only rows done on or after the
week's Monday. Only the lower bound is checked: a stamp ahead of the view is a clock, not
a reason to hide a row, and an unreadable stamp keeps the row rather than removing the
only `Not done`. `done` is sorted newest first.

### A4 — the export confirm sheet understated the ZIP *(fixed)*

`app/src/views/SettingsView.tsx`. Rung 2 exists so the sheet can say what will be written.
It said "courses, assignments, timestamps, and links"; `browser/scripts/export-portable.mjs`
also writes module contents, page text and published syllabus text. The sheet now names
those, and says what is *not* in the ZIP (Canvas session, feed links, submission files) —
which the exporter confirms: it builds explicit per-course views from the sync projection
and never walks `{user_root}`, so `auth/feeds.json` cannot reach it.

### A5 — dead code and duplicates the pass left behind *(fixed)*

- `.rows > li.is-leaving` and the `transition` on `.rows > li[data-flip]` in
  `notebook.css`: nothing applies `is-leaving` to a plan row any more (the studio's copy
  is `.studio-block.is-leaving`, its own rule), and `useFlip` sets its transition inline.
  Removed.
- `WeekView.test.tsx` asserted `not.toContain("is-leaving")` — a class nothing can add.
  Replaced with an assertion that the undone row is back under its day.
- `"ui/motion.css"` appeared **twice** in the extension manifest's
  `web_accessible_resources`.
- `.disclosure,` appeared twice in the same selector list in `notebook.css`.
- `busy={exporting}` on the export sheet was unreachable: the sheet closed before the
  export started. The sheet now stays up while the ZIP is written, so `busy` means
  something.

### A6 — §16.5 had no test; the rung-3 sheet did not open on its field *(fixed)*

The suggestion rungs were the largest behavioural change in the pass and had no
coverage. `WeekView` now takes a `suggestions` preview prop (the same pattern as
`surface`/`changes`/`snapshot`) and two tests cover it: an accepted block marks in place
and stays in the list, and a declined block leaves an Undo on the page. `ConfirmSheet`
passes `initialFocus` when `match` is set — it previously landed on the field only
because the primary button happens to start disabled.

### A7 — open, unchanged

`app/src/dev/frameRate.ts` is still imported nowhere, so §15.7's 60 Hz premise is
unmeasured. That is §16.8 item 12 and was explicitly out of scope for the pass.

---

## 0 — Inventory

| Area | Entry point | Depends on | Artifact |
|---|---|---|---|
| Mac app | `app/src-tauri/src/main.rs` → `app/src/main.tsx` | `commands.rs` (58 commands), `browser/` scripts via `daemon.rs`, `src/canvas_mcp` core via the daemon | signed `.dmg` |
| Extension | `app/extension-chrome/manifest.json` | `lib/canvas-read.js` (GET allow-list), `shared/*.js` generated from `browser/scripts/lib/freshness/` | unpacked MV3 |
| Sync | `browser/scripts/sync-canvas-canonical.mjs` | Playwright SSO session → `/api/v1` → `{user_root}/inbox/` | inbox JSON |
| Optional PAT MCP | `src/canvas_mcp/server.py` | 41 `@mcp.tool()`s, all `@validate_params` | stdio server |
| Connectors | `mcp-servers/{gmail,gcal}/server.py` | `common/actuator.py` → `gate_with_human` | stdio servers |
| Relay | `services/relay/` | unhosted; gated by the hosting-decision doc | — |
| Landing | `landing/index.html` + `config.js` | `motion.css`, `styles.css`, `/go/` | Vercel static |
| Design system | `design-system/kairos/MASTER.md` + `motion.css` | byte-identical copies in `landing/`, `app/extension-chrome/ui/` | — |

Verified by script, not by eye: all 58 `#[tauri::command]`s are in `main.rs`'s
`invoke_handler`, in `build.rs`, in `capabilities/default.json`, and have a permission
TOML; every `invoke("…")` in `app/src` resolves to a command and every command is called
(`take_pending_link.toml` is the only TOML whose fn lives in `main.rs` rather than
`commands.rs`). The three `motion.css` copies are byte-identical (md5
`3f5221dc81cf4034fc6d6c0d5047f27a`).

## 1 — Git & GitHub

- Remote `https://github.com/jacobdpfeifer-svg/Kairos_Time.git`, branch `main`. History
  readable; Kairos history starts at the rename, upstream canvas-mcp history is in
  `CHANGELOG.md` on purpose.
- `.env` (`.gitignore:27`) and `browser/.auth/` (`**/.auth/`, `:149`) are ignored. No
  secret patterns in tracked files.
- **Fixed:** `site/` existed as an empty, *untracked and un-ignored* directory — the exact
  stale path pass 3 warns about. Removed.
- Untracked local bulk is ignored and left alone: `var/` 236M, `_build-comparison/` 2.8M,
  `_candidate-b-integration/` 324K.
- **Manual:** repo description, topics, About link and social preview are remote-only
  settings this session cannot read. `gh repo edit --description … --homepage
  https://kairostime-landing.vercel.app --add-topic canvas,student,local-first`.

## 2 — Docs & README

- All relative links in `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`,
  `SECURITY.md` and `MASTER.md` resolve. The "missing" targets under `skills/*/SKILL.md`
  are all `{user_root}` paths (`USER.md`, `calibration/*`) — per-user data, never
  committed. Not defects.
- **Fixed — false product claim in the two packaging front doors.** `manifest.json`
  advertised "submissions (preview→confirm)" and `server.json` "SSO + REST +
  preview→confirm writes". Canvas submits, comments and discussion posts are
  preview-only with **no execution path, ever** (canvas-focus pivot; verified again in
  pass 5). Both now say so. `manifest.json`'s short description also claimed Kairos helps
  "complete academic fluff".
- **Fixed — wrong path for the generator** in `CLAUDE.md:60`,
  `skills/audit/SKILL.md:155` and `docs/audits/security-latency-ux-audit-prompt.md:45`:
  `tools/vendor-shared.mjs` does not exist; it is
  `app/extension-chrome/tools/vendor-shared.mjs` (the extension README had it right).
- **Fixed — `CLAUDE.md` layout block** omitted five tracked top-level directories, so an
  agent reading only `CLAUDE.md` would not know `mcp-servers/`, `services/relay/`,
  `config/overlays/`, `design-system/kairos/`, `scripts/`, `tools/` or `tests/` exist.
  Added.
- **Open:** the `Dockerfile` pins `python:3.14-slim` while CI's matrix is 3.10–3.13.
  Already noted in `vendor/internal/issue-triage/2026-08-12.md`; unchanged.

## 3 — Landing & marketing parity

- No retired brand anywhere in `landing/`: no Living Instrument, no Spatial Instrument,
  no Blot, no school name. Nav language matches Today · Week · Courses · Study · Advisor.
- `landing/config.js` keeps `downloadUrl: null`, so the download buttons stay off and say
  so; `sourceUrl` matches the git remote.
- Both landing pages and `panel.html` set `data-motion` from `prefers-reduced-motion` and
  keep it updated on change; `landing/motion.css` and `/go/` both load the token file.
- **Fixed:** `landing/index.html` had no reviewer header. Added.

## 4 — Tests, lint, build

| Suite | Result |
|---|---|
| `app` vitest | **237 passed / 39 files** (was 234; +3 from this pass) |
| `app` `tsc --noEmit` | clean |
| `app` `vite build` | clean; one 518 kB chunk warning (local webview load, left alone) |
| `browser` `npm test` | **442 passed / 118 suites** |
| `pytest tests/ -q` | **1013 passed, 37 skipped, 1 xfailed** |
| `cargo test --locked` | **60 passed** (via `scripts/native-mirror.sh`; iCloud blocks in-place builds) |
| `ruff check .` | clean |
| `mypy src/` | clean, 73 files |

- **Fixed — the Python suite was red.** `tests/core/test_brain_w2.py::test_skill_eval_bundled`
  failed: the new, still-untracked `skills/source-to-spec/SKILL.md` had a 12,693-char body
  against the harness's 12,000-char small-model prompt budget. Its stage-3 agent-prompt
  boilerplate moved to `skills/source-to-spec/agent-prompt.md` (the pattern
  `skills/audit` already uses for `docs/audits/*-prompt.md`); body now 11,700 and the
  skill reads better for it.
- **Fixed — `ruff check .` was meaningless.** All 58 errors were in the single dense
  research fixture `docs/research/fixtures/study_session_reference.py`, outside CI's
  `ruff check src/ tests/`, and logged as known on 2026-10-05. Excluded in
  `pyproject.toml` so the root command matches CI and the next real finding is visible.
- **Skipped (needs live credentials):** SSO sync against real Canvas, PAT MCP
  `--test`, real Gmail/GCal sends, the relay, and `KAIROS_LIVE_SKILL_EVAL=1`.

## 5 — Wiring & registry integrity

- Tauri registry: complete, verified mechanically (see §0).
- 41/41 `@mcp.tool()`s in `src/canvas_mcp/tools/` carry `@validate_params`.
- `submit_assignment` and `comment_on_my_submission`: `readOnlyHint=True`, no POST, no
  token-redeem branch. `mark_module_item_done` is the only preview→confirm write and is
  student-private. `STUDENT_WRITE_TOOL_NAMES` has no quiz entry.
- `mcp-servers/gcal` `create_event`/`update_event` and `mcp-servers/gmail` `send_email`
  all route through `gate_with_human`/`gate_connector_write`; `mcp-servers/apple-cal`
  `create_event` returns `blocked: true` with no EventKit call, matching CLAUDE.md.
- `app/extension-chrome/shared/` regenerated: no drift.
- Extension reads: `canvasGet` has no method parameter, never reads a CSRF token,
  rejects `..`/`//`, requires https + a real hostname with no port or credentials, and
  treats a redirect as unavailable (`redirect: "manual"`).

## 6 — Dead code removed

| Path | Reason |
|---|---|
| `app/src/spatial.css` (voice block, ~1.5 KB) | Retired-Blot chrome: `.voice-sheet button.blot` and `.blot canvas` matched no element, and the rest was superseded by `notebook.css`. The three rules `notebook.css` lacked (`.voice-actions:empty`, the `data-state` caption colour, the 520 px single-column collapse) moved into the component layer, which owns the voice sheet per MASTER §08. `vite build` clean afterwards. |
| `app/src/notebook.css` | Dead `.rows > li.is-leaving` + its transition; duplicated `.disclosure` selector (see A5). |
| `app/extension-chrome/manifest.json` | Duplicated `ui/motion.css` resource (A5). |
| `site/` | Empty, untracked, un-ignored. |

Checked and **not** removed: `app/src/dev/frameRate.ts` (declared open debt),
`app/src/voice/demo.ts` (dynamic `import()` in `App.tsx` behind `?blot`, dev builds only),
`app/src/test/setup.ts` (`vitest.config.ts` `setupFiles`), `app/src/blot/core/`
(CLAUDE.md keeps the level/state engine), `mcp-servers/apple-cal/` (an honest hard block
is the feature). No empty directories, no commented-out code blocks in `app/src`.

## 7 — Structure

**Fixed:** the voice-sheet split between `spatial.css` and `notebook.css` (§6); the
atomic-write pattern now consistent across `calendar.rs` and its three peers (A1).

**Proposals, needing product judgment:**

1. **`config/overlays/` describes controls this tree does not have.** `config.py`
   honestly warns about twelve unimplemented env vars, but the six `TS_SANDBOX_*`
   variables in `baseline.env`, `public.env` and `enterprise.env` are read by **nothing**,
   are absent from that warning list, and the overlay README described a working
   container sandbox with an outbound allowlist. The TypeScript-execution tool they
   guarded is gone (`CHANGELOG.md:324`). I marked all three files `INERT` and rewrote the
   README's sandboxing bullet to say so plainly, but the real question is whether a
   student-only, local-first product should ship an institutional overlay tier at all.
   The honest options are deleting `config/overlays/` or keeping it as an explicitly
   historical record; the README now at least cannot mislead a reviewer into reading
   `ENABLE_TS_SANDBOX=true` as protection.
2. **One school is hard-coded in the shipped extension.** `canvas.colorado.edu` is in
   `manifest.json` `host_permissions` and in `BUILT_IN_HOSTS` while the landing page
   promises any Canvas school. Defensible for a beta cohort, but a reviewer will notice;
   the alternative is granting every origin at runtime, which costs a first-run prompt.
3. **`mcp-servers/*` tool parameters have no `@validate_params`.** CLAUDE.md's rule is
   scoped to `canvas_mcp` tools and holds there 41/41. The connector servers already
   import from `canvas_mcp.core`, so extending the decorator is cheap; every write is
   already behind human elicitation, so this is defence in depth, not a hole.
4. **`offerToast`'s one-waiter cap silently drops a third message.** Recovery is now
   guaranteed on the page (A2), so nothing unrecoverable is lost — but a dropped
   *sync-failure* line is still information the student never sees. Either widen the
   queue or route sync status to a surface that is not the toast.

## 8 — Reviewer notes

Earlier passes had already covered the cold-open files (`main.tsx`, `main.rs`, `ipc.ts`,
`canvas-read.js`, `sync-canvas-canonical.mjs`, `skill_router.py`, `motion.ts`,
`notebook.css`, `motion.css`). Added this round: `landing/index.html`. Comments added
with the fixes above: `calendar.rs::write_atomic`'s rationale, `plan.ts::doneThisWeek`,
the `.is-declined` rule, `ConfirmSheet`'s `initialFocus`, and the `INERT` headers in the
three overlay env files.

## 9 — Security, latency, UI

Connection map in §0; the 2026-10-19 run's findings were spot-checked and hold.

- **Data loss, fixed:** A1 is the only finding of real severity this round. It was
  introduced by the uncommitted §16 work and was reachable from a single Undo click.
- **New IPC surface reviewed:** `remove_calendar_event` (id ≤ 128 chars) and
  `restore_calendar_suggestion` (id ≤ 300) only ever *compare* their argument; neither
  joins it into a path, so the webview cannot traverse out of `{user_root}`. Both write
  inside `inbox/` and both are now atomic.
- **Secrets:** `{user_root}/auth/feeds.json` written 0600 via `writeJsonAtomic` plus an
  explicit `chmodSync`, user root 0700, never logged. The Canvas export cannot reach it
  (A4).
- **Accessibility:** A2 removed an invisible focus stop. `ConfirmSheet` keeps WCAG 3.3.4
  satisfied by the Confirmed route for rungs 2–3 and by the Reversible route for rung 0.
- **Latency:** no padded waits, no fake progress, no shimmer anywhere (MASTER §15.6
  holds). `useFlip` does one `querySelectorAll` + `getBoundingClientRect` per row per
  commit — forced layout, but bounded by the rows on screen. The 518 kB JS chunk loads
  from disk in a WKWebView; not worth splitting.
- **Unmeasured:** the 60 Hz budget §15.7 asserts (A7).

## 10 — Intentional boundaries confirmed

No educator tools, no hosted Azure, no quiz automation. `submit_assignment` /
`comment_on_my_submission` preview-only with no execute path. No SIS/DegreeWorks scraper
or login, no registration execution. No RateMyProfessors scrape. No `self_improve`
cluster/draft/shadow/promote. No learning streak, leaderboard or losable state. Apple
Calendar hard-blocked. Gmail/GCal writes execute only behind per-instance human
confirmation with no standing posture. The relay stays unhosted. `frameRate.ts` unwired
by decision.

## 11 — Unverified (one manual check each)

1. **The running app.** This is a Tauri shell and this host cannot drive it, so the §16
   changes were verified by 237 view tests, `tsc` and `vite build`, not by clicking. Not
   clicked: defer and done from the pointer (the 90 ms hold is visual), `d` from the
   keyboard, the export and profile sheets in Settings, and a second toast arriving while
   an Undo is live. One run of `cd app && npm run tauri dev` covers all five.
2. **Reduced motion on the extension stage and the landing pages** — set the macOS
   "Reduce motion" switch and confirm no travel on either, plus that the cross-fade
   survives.
3. **Remote GitHub presentation** — description, topics, About link, social preview (§1).
4. **Live Canvas/PAT/connector paths** — SSO sync, `canvas-mcp-server --test`, a real
   Gmail send and a real GCal write (each should stop at its confirmation).

---

## Completion update

This follow-up completed the remaining local checks without exercising live
credentials or connector writes.

### Fixed

- **Webview / onboarding-draft boundary:** `app/src/workspace/interview.ts`
  imported `workspace/onboarding.mjs`, whose Node filesystem imports made Vite
  externalize `node:fs` and `node:path` into the browser build. The new pure
  `browser/scripts/lib/workspace/draft.mjs` owns normalization; Node-only
  persistence remains in `onboarding.mjs`. The app now imports the pure
  catalog, ranker, and normalizer directly. Declarations keep those shared
  modules typed.
- **Type-check command:** `[tool.mypy] files = ["src"]` makes the documented
  `uv run mypy` command useful from the repository root and removes stale
  unused overrides.

### Verification

| Check | Result |
|---|---|
| `cd browser && npm run test` | 442 passed, 118 suites |
| Focused workspace tests | 14 passed |
| `cd app && npm run build` | passed; Node built-in externalization warning removed; existing 518.70 kB chunk warning remains |
| `uv run ruff check .` / `uv run mypy` | passed; mypy checked 73 source files |
| `uv run python -m pytest tests/ -q` | started cleanly (1,050 collected / 1 skipped), but this runner ended capture at 30 seconds before completion; no full-result claim |
| `git diff --check` | passed |

### Open

- The 518.70 kB production JavaScript entry chunk remains a build warning, not
  a confirmed interaction defect. Splitting it needs a product-aware loading
  decision.
- Concurrent onboarding changes appeared in the worktree during this follow-up.
  They were left untouched and are not attributed to this audit.
