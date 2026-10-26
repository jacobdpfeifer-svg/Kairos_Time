# CLAUDE.md — Kairos student Canvas platform

Load [`AGENTS.md`](./AGENTS.md) and `{user_root}/USER.md` (template: [`templates/USER.md`](./templates/USER.md)). Architecture: [`docs/architecture.md`](./docs/architecture.md). Visual craft (any `app/src`, `app/extension-chrome`, `landing/` change): [`design-system/kairos/MASTER.md`](./design-system/kairos/MASTER.md) — **Notebook** (adopted 2026-10-07), source of truth; supersedes Living Instrument, the Spatial Instrument brief, and the style tile.

**Default: no Canvas PAT.** Useful via SSO → `/api/v1` → inbox.

Hard prohibitions are in [`AGENTS.md`](./AGENTS.md). Do not restate them in this file.

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
design-system/kairos/  # Notebook: MASTER.md + motion.css, source of truth for all three surfaces
mcp-servers/           # optional personal-account connectors (gmail, gcal); apple-cal is hard-blocked
services/relay/        # tokenized-feed relay; unhosted until the hosting decision says otherwise
config/overlays/       # tiered .env overlays; the TS_SANDBOX_* block is inert (see its README)
scripts/, tools/, tests/
```

Per-user data lives under `{user_root}` (`inbox/`, `calibration/`, `ledger.jsonl`) — never committed.

## Commands

```bash
# Feedback loop: ruff, pytest, app vitest. Defined in AGENTS.md.
scripts/verify.sh

# Daily / weekly sync (no token)
cd browser && npm run open-canvas   # once
cd browser && npm run sync

# Optional MCP
uv pip install -e .
uv run canvas-mcp-server --test    # only after PAT in .env

# Optional voice goal capture (GEMINI_API_KEY in .env; docs/VOICE.md)
cd browser && npm run voice-models  # pick GEMINI_LIVE_MODEL
cd browser && npm run voice         # open the printed localhost URL
```

## Coding standards

Hard prohibitions are in [`AGENTS.md`](./AGENTS.md).

- Prefer extending SSO→API→inbox over new scrapers
- App structure (2026-10-13, [`docs/research/saas-themes-applied-to-kairos-2026-10-13.md`](docs/research/saas-themes-applied-to-kairos-2026-10-13.md)): sidebar Today · Week · Courses · Study · Advisor (+ Settings); ⌘K reaches every action; Ask is a sheet that never hides the next move; suggestions wait for a yes and never move after acceptance; notifications only for due-moved / high-stakes ≤48h not started / sync broken; native opt-ins (all default off, `calibration/app-prefs.json` via `app/src-tauri/src/prefs.rs`): keep running in the menu bar, notifications (policy in `app/src/notify/policy.ts`), a global capture shortcut; `kairos://` links route through `app/src/nav.ts` `routeFromUrl`
- UI (Notebook): near-white page, hairline rows, one highlighter `--hl` per screen, ink primary button with the highlighter offset shadow, Caveat margin notes only as decoration; Gabarito type; sentence case (no uppercase eyebrows, numbered indexes, or middle-dot chains); no glass, gradients, glow, mascots, or 3-up card grids; motion only on real state, never `transition: all`. Component layer: `app/src/notebook.css`. MASTER §13 anti-patterns and §14 acceptance test apply. **Motion is MASTER §15** (2026-10-23, [`docs/research/motion-system-2026-10-23.md`](docs/research/motion-system-2026-10-23.md)): paper is a fast medium with a slow settle, so nothing a student sees more than ~20 times a term is allowed to travel and nothing keyboard-initiated animates at all (⌘K and sidebar peers do not move); four curves and five distance-tiered duration tokens, 300ms ceiling; no spring, bounce, or overshoot; reduced motion zeroes `--travel-*` and keeps the cross-fade (`.01ms`, never `animation: none`); `transform`/`opacity` only on a 60Hz WKWebView budget; and no padded wait, fake progress, or shimmer — a product that won't invent a percentage doesn't get to invent a wait
- **Weight and consequence is MASTER §16; disclosure is §17** (2026-10-23, [`docs/research/game-design-as-product-design-2026-10-23.md`](docs/research/game-design-as-product-design-2026-10-23.md)): weight goes where the mark leaves the page, and in a product with undo weight means reversibility, not ceremony. The departure test ("can the student get this back themselves, inside Kairos, five minutes from now?") sets four rungs — none / a recovery window / a confirm sheet / a typed confirmation — and reversibility outranks confirmation (WCAG 3.3.4 needs only one of Reversible, Checked, Confirmed). An auto-dismissing toast is never the only way back. One new token, `--t-hold: 90ms`, a visual hold on the acted row implemented as `transition-delay` with the data committed first, one tier and never a timer. Weight must be contingent on the real outcome, never amplified (CHI 2024, n=1,699: amplification lowered competence and agency). Prohibited by name: sound (no web API reads the macOS UI-sound switch), screen shake, particles, celebration, streaks and any losable state, the whole free-to-play monetization ladder, and any offer or pressure timed to a moment of failure — Kairos may use that moment to reduce the cost of the next action, never to raise the price of staying. Disclosure is by the student's own data, never on a timer, two levels maximum, no tours
- Extension `shared/*.js` is generated from `browser/scripts/lib/freshness/` by `app/extension-chrome/tools/vendor-shared.mjs`. The native host stays stdlib-only. The read boundary is in AGENTS.md.
- Voice presence: an abstract "ink ring" (`app/src/voice/InkRing.tsx`, shown in `app/src/voice/VoiceSheet.tsx` only while voice is live). There is no character; the Blot character was retired 2026-10-07 (its dependency-free level/state engine stays in `app/src/blot/core/`, vendored to `app/extension-chrome/shared/blot/`). The voice model talks to the UI only through `app/src/voice/presence.ts`. Scope and limits: MASTER §08. The intake tool bound is a hard prohibition in AGENTS.md; field bounds are in [`docs/handoff/generative-workspace-architecture-2026-10-21.md`](docs/handoff/generative-workspace-architecture-2026-10-21.md) §2.

## Out of scope

Hard prohibitions are in [`AGENTS.md`](./AGENTS.md). The write-ups those boundaries come from:

- [`docs/handoff/degree-planning-scope-2026-09-13.md`](docs/handoff/degree-planning-scope-2026-09-13.md)
- [`docs/handoff/canvas-focus-pivot-2026-09-11.md`](docs/handoff/canvas-focus-pivot-2026-09-11.md)
- [`docs/handoff/freshness-extension-spike-2026-09-29.md`](docs/handoff/freshness-extension-spike-2026-09-29.md)
- [`docs/handoff/hosting-decision-criteria-2026-09-30.md`](docs/handoff/hosting-decision-criteria-2026-09-30.md)
