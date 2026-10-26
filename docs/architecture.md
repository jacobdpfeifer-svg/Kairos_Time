# Architecture — Kairos (Phase 1)

As-built map for the local-first student Canvas platform. Truth path for general users (per-user `{user_root}`).

## Truth path

```text
Skill router ← {user_root}/ memory ← Canvas /api/v1 ← SSO (Playwright) or PAT
                     ↑
   freshness tick ← extension deltas (student's own Chrome session, GET only)
                  ← tokenized Canvas feeds (no session)
```

## Layers (what exists today)

| Layer | Owns | Module / path |
|-------|------|----------------|
| Tenant | School registry (Canvas URL, SSO, timezone, LTI catalog) | `schools/{slug}.yaml` via `canvas_mcp.core.tenants` |
| User root | Per-student data directory | `canvas_mcp.core.user_root` (+ `DEV_USER_ROOT`) |
| Permissions | Posture + k-counters + global STOP | `{user_root}/calibration/permissions.yaml` via `permissions` |
| Ledger | Append-only automation history + undo_ptr | `{user_root}/ledger.jsonl` via `ledger` |
| Skills | Instruction bundles (`SKILL.md`) | `skills/` (+ `{user_root}/skills/{active,provisional}`) |
| Skill routing | Load + rank + CLI for Tauri | `canvas_mcp.core.skill_router` (`python -m …skill_router`) |
| Learning profile | Start bias + initiation priors (not whether retrieval happens) | `canvas_mcp.core.learning_profile`; onboarding UI in `app/src/components/learningProfile/` |
| Learn loop | Teachable claims, exam-relative reviews, delayed-hit stability. Dock session reads `--json due` and writes student-scored `outcome`. Peek shows why a check is due, a durable-retrieval health line, a non-blocking review budget, and a counterfactual pair. `evaluate` is the local outcome check (delayed reviews, delayed hits, overdue work, deadline surprises); brief continuity is exposure only. `reconcile` remaps `checkpoint_due`/schedule when a synced exam/quiz date moves (`sync-week.mjs` runs it after every sync, best-effort) | `canvas_mcp.core.learn_loop` → `{user_root}/inbox/learn/items.yaml` |
| Professional context | Cached, sourced "why this matters" applications for a claim — skill-path opt-in only (student asks, or first exposure on request), never auto-injected into a due-review card. ≥2 sourced applications across ≥2 fields or a cached refusal; one-shot display via `context_shown`. Live web search is a skill-instruction concern (session tool), not a new scraper | `canvas_mcp.core.claim_context` → same `items.yaml`, via `skills/_claim_context.md` |
| Academic outcomes | Append-only delayed hit, corrected miss, and workflow path events. Trail and semester garden are read-only projections. Not the actuator ledger, not a streak, and not stability | `canvas_mcp.core.progress` → `{user_root}/inbox/learn/outcomes.jsonl` |
| Commitment | One opt-in appointment. Student marks started, kept, or released. No calendar write, no money, no shame. Does not change learn-loop stability | `canvas_mcp.core.commitment` → `{user_root}/inbox/commitments.yaml` |
| Brief continuity | Consecutive local days a brief was written (`write_focus`). Quiet line only — not a learning streak, no shame interrupt. Stored count is exposure, not evidence | `canvas_mcp.core.habit` → `{user_root}/inbox/habit.yaml` |
| Concept diagrams | Deterministic matplotlib PNGs | `canvas_mcp.core.diagram_gen` + skill `student-concept-visual` |
| Study sessions (2026-09-18) | Single state-transition authority for source-backed practice: append-only event log + rebuildable projection, evidence labels (`delayed_independent_retrieval` … `invalidated`), bounded deterministic checkers with abstention, versioned packets (six synthetic + Canvas-derived + student-authored items), exam caps, corrections replay, provisional AI proposals. Runs as the isolated stdlib-only `study` package in packaged builds. Legacy `learn_loop` claims stay a separate surface and never earn delayed credit | `canvas_mcp.core.study` → `{user_root}/study/{events.jsonl,projection.json,packets/}`; build record `docs/build/student-beta/` |
| Canvas study sources | Instructor-published pages/syllabus/assignment text + inferred exam dates → per-course JSON + honest `status.json`; never quiz questions/submissions/grades | `browser/scripts/sync-study-sources.mjs` → `{user_root}/inbox/study-sources/`; `canvas_mcp.core.study.canvas` |
| Funded AI relay | Invite-authenticated, capped relay: atomic reservations, pinned pricing, replay-by-id, content-free accounting; client selects minimal context locally | `services/relay/`, `canvas_mcp.core.study.ai` → `{user_root}/auth/relay.json` |
| Connectors (product-owned) | Google Calendar (installed-app flow) and Outlook mail (device code, school-managed + personal) with honest states; calendar writes preview → persisted single-use confirmation → execute | `canvas_mcp.core.connectors` → `{user_root}/auth/{connectors.json,google/,microsoft/,confirm-gcal.json}` |
| Browser sync | SSO cookies → REST → `{user_root}/inbox` (same resolver as Python/Tauri). Browser profile lives in `{user_root}/auth/browser`. The canonical sync ends with the freshness hook (snapshot diff, skip costs, weekly feed capture). A per-course 403 `unauthorized` (tab hidden from students) is recorded in `unavailable_endpoints`, not failed | `browser/` (`npm run sync`, `npm run sync-sources`, `npm run freshness`) |
| Desktop shell | **Workspace** (restructured 2026-10-13): Today, Week, Courses, Study, Advisor, Settings; ⌘K; the compact glass dock was retired. Rust `runtime.rs` owns installed-vs-dev resource resolution, profile identity and fail-closed `broken` mode; renderer requests are validated natively. Native builds run in place. `scripts/native-mirror.sh` is only for a checkout that is still under iCloud Drive | `app/src-tauri` + React `app/src/{App,views/*}` |
| Freshness (2026-09-29) | Always-fresh Canvas changes. Extension polls the activity-stream summary every 5 min with the student's own session (four allow-listed GETs, no write path) and sends the changed slice over native messaging; tokenized feeds (captured weekly during sync, secret in `auth/feeds.json`) are watched with no session; snapshot diffs catch moved due dates and edited instructions. The daemon runs the tick every 2 min → events → `dashboard.json` (next step, changes, announcement digest, cost of skipping, calendar-suggestion "agent can do"). Surfaces: Canvas dashboard stage + assignment/quiz/discussion side panel (extension, any school's Canvas once the student grants it), Today's "changed since you looked" row and Week's piles (app). The app installs the native host itself (`app/src-tauri/src/nativehost.rs`). Hosting deferred behind [`handoff/hosting-decision-criteria-2026-09-30.md`](handoff/hosting-decision-criteria-2026-09-30.md) ([`handoff/freshness-extension-spike-2026-09-29.md`](handoff/freshness-extension-spike-2026-09-29.md)) | `browser/scripts/lib/{freshness/,canvas-feeds,canvas-changes,skip-cost,freshness-*}.mjs`, `browser/scripts/freshness-tick.mjs`, `app/extension-chrome/`, `app/native-messaging/host.py` (stdlib-only) → `{user_root}/inbox/freshness/` |
| Actuators | Personal Gmail/GCal — read + draft always; `create_event`/`update_event`/`send_email` execute only behind `ConfirmationGuard`/`gate_connector_write` (per-preview confirm, never automatic). Apple Calendar stays hard-blocked. Canvas submit/comment/discussion-post stay preview-only ([`docs/handoff/canvas-focus-pivot-2026-09-11.md`](handoff/canvas-focus-pivot-2026-09-11.md) + 2026-09-13 addendum) | `mcp-servers/{gcal,gmail,apple-cal}` + `common/actuator.py` |
| Plugins | School Bucket-A connectors (static registry, `surface: "web"` only). Multi-step actions run through the action runner: fresh observation per step, halt on failed check, required `finish` verdict, diagnostics in `{user_root}/diagnostics/` (failure screenshots only). **Device-automation harnesses (cell-use, Appium/WebDriverAgent, idb, mobile-mcp, agent-device) follow the same Bucket A/B and Canvas-visible rules as Playwright — a mobile harness can never reach a write the web path blocks** ([`handoff/device-automation-scope-2026-09-29.md`](handoff/device-automation-scope-2026-09-29.md)) | `plugins/` + `browser/scripts/lib/{connector-registry,action-runner}.mjs` |
| Week plan (2026-10-13) | Student-owned plan state: per-item minute estimates (heuristic by kind and points, student-editable), weekly available hours (calendar busy blocks when connected, otherwise one student answer), deferrals, typed/voice/extension captures, and an accepted plan stamped `accepted_at` that never reorders itself. Arrivals are sorted into three correctable piles (needs you, changed, for your info) with per-course "always" overrides | `canvas_mcp.core.week_plan` → `{user_root}/inbox/plan/{week.json,items.jsonl}`, `{user_root}/calibration/piles.yaml` |
| Native opt-ins (2026-10-13) | All default off, per profile. Notifications are evaluated in the webview after each sync/freshness tick and every 15 min: due date moved, high-stakes work ≤48h not done, Canvas sign-in broken; quiet 11 PM to 8 AM and during Canvas calendar events, max three a day, each once. Keep-running hides the window on close (menu bar + sync continue); Dock click reopens. The capture shortcut opens ⌘K on the capture line. `kairos://` links (menu bar, shortcut, extension) arrive as one `deep-link` event, with a pending slot for cold starts | `app/src/notify/{policy,useNotifications}.ts`, `app/src-tauri/src/{prefs,shortcut,dock}.rs`, `tauri-plugin-{notification,global-shortcut,deep-link}` → `{user_root}/calibration/app-prefs.json` |
| Screen coach | Student sends screenshots of a tool they must operate (Bucket-B, LTI, confusing admin UI); agent reads the screen as untrusted data and suggests the next tap. Never taps, never answers graded items. Reuses photo-intake capture storage | `skills/student-screen-coach` → `{user_root}/inbox/captures/` |

## Product core vs vendored MCP

- **Product core (in tree under `src/canvas_mcp/core/`):** `user_root`, `skill_router`, `learn_loop`, `habit`, `permissions`, `ledger`, course policy, write confirmation — this is the local-first brain, not “archived.”
- **Vendored optional PAT MCP tools** (`src/canvas_mcp/tools/`, `server.py`): truth-path step 4. Upstream canvas-mcp boundary — root [`CHANGELOG.md`](../CHANGELOG.md) is upstream’s; see [`vendor/README.md`](../vendor/README.md).

## Explicitly out of truth path / archived

- **Upstream CHANGELOG / vendor archives** — [`vendor/articles/`](../vendor/articles/), [`vendor/examples/`](../vendor/examples/), [`vendor/internal/`](../vendor/internal/) — research / upstream notes; not the shipping product surface.
- **`app/telemetry/`** — opt-in Sentry helper only.
- **Billing / mobile** — **deleted** (signed 2026-09-12). Do not re-add Stripe/Twilio stubs.
- **Educator grading / quiz-taking / hosted Azure** — permanently out of scope (see `CLAUDE.md`).
- **`src/canvas_mcp/core/self_improve/`** — rewrite pipeline (`cluster`/`drafter`/`shadow`/`promoter`/`run` plus residual logger/distill) **deleted**. Do not re-add. `skill_router.route_intent` does not write a request log.

## Design docs (status)

| Doc | Status |
|-----|--------|
| [`design-system/kairos/MASTER.md`](../design-system/kairos/MASTER.md) | **Notebook — active** (2026-10-07; structure amended 2026-10-13) — source of truth for visual craft. Screen recipes now cover Today, Week, Courses, Study path, exam-week mode, ⌘K, capture window, tray menu and notifications ([`research/saas-themes-applied-to-kairos-2026-10-13.md`](research/saas-themes-applied-to-kairos-2026-10-13.md)) |
| [`docs/design/spatial-instrument-brief.md`](design/spatial-instrument-brief.md) | **Superseded on visuals** (2026-09-21) — product behavior/anatomy still applies; visual direction and style tile yield to MASTER. Original execution prompt: [`handoff/spatial-instrument-build-prompt.md`](handoff/spatial-instrument-build-prompt.md) |
| [`docs/design/ambient-dock-ui.md`](design/ambient-dock-ui.md) | **Parked** (signed 2026-09-12) — peek/expanded/onboarding + tray as built; Hidden/auto-peek design-only. See [`handoff/ui-shell-alternatives.md`](handoff/ui-shell-alternatives.md) |
| [`docs/design/learning-profile.md`](design/learning-profile.md) | **v1 built**; start bias only. Learn loop is the teaching model (`learn_loop.py`) |
| [`docs/design/class-standings.md`](design/class-standings.md) | **Framed, not built, not authorized** — optional hideable class leaderboard frame only; do not ship without a product decision |
| [`docs/handoff/degree-planning-scope-2026-09-13.md`](handoff/degree-planning-scope-2026-09-13.md) | **Built (Tier 1 + admin companion + Tier 2 import path)** — `gpa.py`, grades sync, `student-gpa` / `student-course-plan` / `student-registration-prep`; requirement claims only via dated `inbox/degree-audit.md` |
| [`docs/handoff/academic-advisor-product-plan-2026-10-13.md`](handoff/academic-advisor-product-plan-2026-10-13.md) | **Phase 1 slice built** — read-only advisor snapshot plus Snapshot/Path/Decision/Meeting workspace; no new SIS scraper or registration actuator |

## Schools

The student's school is discovered at onboarding and enriched from Canvas; curated `schools/*.yaml` overlays and `plugins/{school}/` connectors are optional extras. See [`architecture/school-personalization.md`](architecture/school-personalization.md). One curated overlay exists today (`cu-boulder`, with `plugins/cu-boulder-campusgroups/`); connector contract: [`plugins/README.md`](../plugins/README.md).
