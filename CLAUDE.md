# CLAUDE.md — Kairos student Canvas platform

Load [`AGENTS.md`](./AGENTS.md) and `{user_root}/USER.md` (template: [`templates/USER.md`](./templates/USER.md)). Architecture: [`docs/architecture.md`](./docs/architecture.md). Visual craft (any `app/src`, `app/extension-chrome`, `landing/` change): [`design-system/kairos/MASTER.md`](./design-system/kairos/MASTER.md) — **Notebook** (adopted 2026-10-07), source of truth; supersedes Living Instrument, the Spatial Instrument brief, and the style tile.

**Default: no Canvas PAT.** Useful via SSO → `/api/v1` → inbox.

Do not restore educator tools, hosted Azure, or quiz-taking automation.

## Truth path

1. Brain: `{user_root}/USER.md` triage (+ `{user_root}/calibration/priority-rubric.md` for priority; `student-course-arc` when the student names a course)
2. Memory: `{user_root}/inbox/week.md` (+ `inbox/courses/*` catalogs + arc notes; optional dated `inbox/focus.md` Top-3 cache)
3. Fill memory: `cd browser && npm run sync` (SSO cookies → Canvas REST; honor `DEV_USER_ROOT`). Keep it fresh between syncs: the Chrome extension (`app/extension-chrome/`, GET-only on the student's own session) + tokenized feeds → `npm run freshness` → `{user_root}/inbox/freshness/`
4. Optional later: PAT + vendored `canvas-mcp-server` (`src/canvas_mcp/` — upstream canvas-mcp fork; see [`vendor/README.md`](./vendor/README.md)) for the same REST + preview-only tools
5. Escape hatch: browser UI for WebAssign / ZyBooks / PlayPosit / proctored / LTI — student operates; agent drafts

## Layout

```
AGENTS.md, templates/USER.md, docs/architecture.md
schools/               # optional curated per-school overlays (school is discovered at onboarding)
browser/               # SSO auth + sync scripts (not DOM-primary)
src/canvas_mcp/       # vendored optional PAT MCP (upstream canvas-mcp)
skills/                # student-* + canvas-week-plan + discussion
app/                   # Kairos Tauri shell + daemon; extension-chrome/ + native-messaging/ (Canvas-page surface)
plugins/               # school-conditional Bucket-A connectors (see plugins/README.md)
landing/               # static Vercel site; go/ = QR/NFC landing (phone → Mac hand-off), config.js = launch switches
marketing/             # placements.json → print-ready QR codes + NFC tag links (see marketing/README.md)
vendor/                # upstream CHANGELOG boundary + archived articles/examples/internal
```

Per-user data lives under `{user_root}` (`inbox/`, `calibration/`, `ledger.jsonl`) — never committed.

## Commands

```bash
# Daily / weekly sync (no token)
cd browser && npm run open-canvas   # once
cd browser && npm run sync

# Optional MCP
uv pip install -e .
uv run canvas-mcp-server --test    # only after PAT in .env
uv run python -m pytest tests/ -q

# Optional voice goal capture (GEMINI_API_KEY in .env; docs/VOICE.md)
cd browser && npm run voice-models  # pick GEMINI_LIVE_MODEL
cd browser && npm run voice         # open the printed localhost URL
```

## Coding standards

- Prefer extending SSO→API→inbox over new scrapers
- MCP tools: `@mcp.tool()` + `@validate_params`; `submit_assignment` is preview-only (readOnlyHint, no execution path — canvas-focus pivot) and never gains a confirm/execute branch back
- Bucket-A connector MCP writes: dedicated `ConfirmationGuard` via `canvas_mcp.core.connector_guards.get_connector_guard` — no first-write exemption
- External tool inventory is discovery-only; gaps go to `inbox/tool-gaps.md` — never auto-fetch connector code
- App structure (2026-10-13, [`docs/research/saas-themes-applied-to-kairos-2026-10-13.md`](docs/research/saas-themes-applied-to-kairos-2026-10-13.md)): sidebar Today · Week · Courses · Study · Advisor (+ Settings); ⌘K reaches every action; Ask is a sheet that never hides the next move; suggestions wait for a yes and never move after acceptance; notifications only for due-moved / high-stakes ≤48h not started / sync broken; native opt-ins (all default off, `calibration/app-prefs.json` via `app/src-tauri/src/prefs.rs`): keep running in the menu bar, notifications (policy in `app/src/notify/policy.ts`), a global capture shortcut; `kairos://` links route through `app/src/nav.ts` `routeFromUrl`
- UI (Notebook): near-white page, hairline rows, one highlighter `--hl` per screen, ink primary button with the highlighter offset shadow, Caveat margin notes only as decoration; Gabarito type; sentence case (no uppercase eyebrows, numbered indexes, or middle-dot chains); no glass, gradients, glow, mascots, or 3-up card grids; motion only on real state, never `transition: all`. Component layer: `app/src/notebook.css`. MASTER §13 anti-patterns and §14 acceptance test apply
- Chrome extension reads Canvas only through `app/extension-chrome/lib/canvas-read.js` (GET, allow-listed paths, no CSRF token; any school's https Canvas only after the student grants that origin in Chrome) and renders Canvas text with `textContent` only; `shared/*.js` is generated from `browser/scripts/lib/freshness/` (`tools/vendor-shared.mjs`). Native host stays stdlib-only
- Voice presence: an abstract "ink ring" (`app/src/voice/InkRing.tsx`, shown in `app/src/voice/VoiceSheet.tsx` only while voice is live). There is no character; the Blot character was retired 2026-10-07 (its dependency-free level/state engine stays in `app/src/blot/core/`, vendored to `app/extension-chrome/shared/blot/`). The voice model talks to the UI only through `app/src/voice/presence.ts`. Scope and limits: MASTER §08
- Tokenized Canvas feed URLs are secrets: `{user_root}/auth/feeds.json` only (0600), never logged, exported, or held server-side without a signed hosting decision
- Never commit `.env` or `browser/.auth/`
- Voice intake (`browser/scripts/lib/voice/`): the model gets exactly two local-append tools (`save_goal`, `append_class_note`) into `{user_root}/inbox/` — no Canvas access, no submits; raw transcripts in `{user_root}/inbox/voice/sessions/` never leave the machine except as audio to the Live API

## Out of scope

Handshake, Azure hosting, educator grading, auto-driving LTI tools / Bucket-B assessment automation. **No student-portal (SIS)/DegreeWorks scraper or login, and no registration/add-drop execution path** — see the bounded GPA + course-planning scope below.

**Degree planning scope (2026-09-13, [`docs/handoff/degree-planning-scope-2026-09-13.md`](docs/handoff/degree-planning-scope-2026-09-13.md)):** GPA calculation and interest/prereq-aware course *suggestions* are in scope, computed from Canvas grades + `USER.md` + a small student-maintained `calibration/credit-hours.yaml`. Anything that claims a specific degree/major requirement is satisfied must trace to a dated `{user_root}/inbox/degree-audit.md` import the student pasted from their own student-portal/DegreeWorks audit — never inferred from Canvas data alone, never live-scraped.

**Canvas-focus pivot (2026-09-11, [`docs/handoff/canvas-focus-pivot-2026-09-11.md`](docs/handoff/canvas-focus-pivot-2026-09-11.md)):** this product reads Canvas and helps a student plan and study. It does not act on a student's behalf toward anyone else — an instructor, a classmate, or anyone on the other side of a Canvas submit/comment/discussion-post, all of which stay preview-only with no execute path, ever. RateMyProfessors scraping (their ToS prohibits it) and any self-rewriting-prompts pipeline (`self_improve` cluster/draft/shadow/promote — deleted, don't re-add) stay out. `submit_assignment` is preview-only and stays that way. Any gamification on `learn_loop`/`habit` must have no losable state — no learning streaks, no leaderboards (brief-day continuity exposure in `habit` is fine; it is not a learning streak). **Personal Gmail send / Google Calendar event writes (2026-09-13 addendum, same doc):** reopened — these are the student's own accounts, not Canvas-visible. `send_email`/`create_event`/`update_event` execute for real, but only behind `ConfirmationGuard`/`gate_connector_write` (preview → per-instance human "yes, do that" → execute); there is no automatic/standing posture and none may ever escalate to one. Apple Calendar stays hard-blocked (no EventKit helper built, not a policy stance).

**Always-fresh Canvas (2026-09-29, [`docs/handoff/freshness-extension-spike-2026-09-29.md`](docs/handoff/freshness-extension-spike-2026-09-29.md)):** the Chrome extension is a product surface (Canvas dashboard stage + assignment side panel) that reads Canvas with the student's own session; "agent can do" is the student's own logistics (calendar suggestions approved in the app), never a Canvas-visible action or graded work. Never hold a student's Canvas session or cookies server-side. The brain stays local until [`docs/handoff/hosting-decision-criteria-2026-09-30.md`](docs/handoff/hosting-decision-criteria-2026-09-30.md) says otherwise.
