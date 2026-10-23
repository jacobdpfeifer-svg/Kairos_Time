# Comprehensive team review — 2026-10-23 (fresh)

Second run the same day, on the dirty working tree (`main` at `931637f`, plus uncommitted motion, weight, and workspace work). The earlier write-up stays at [`comprehensive-team-review-2026-10-23.md`](comprehensive-team-review-2026-10-23.md). This file is an independent pass of [`skills/audit/SKILL.md`](../../skills/audit/SKILL.md). Pass 9 follows [`security-latency-ux-audit-prompt.md`](security-latency-ux-audit-prompt.md) and is folded here.

---

## 0 — Inventory

| Area | Entry | Depends on | Artifact |
|------|--------|------------|----------|
| Reviewer door | `README.md`, `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md` | `docs/architecture.md`, `design-system/kairos/MASTER.md` | public story + boundaries |
| Desktop | `app/src/main.tsx` → `App.tsx` | `app/src/ipc.ts` → `app/src-tauri/src/main.rs` | WKWebView workspace |
| Sync | `browser/scripts/sync-canvas-canonical.mjs` | SSO profile `{user_root}/auth/browser` | `{user_root}/inbox/` |
| Freshness | `app/extension-chrome/lib/canvas-read.js` | `app/native-messaging/host.py`, `browser/scripts/lib/freshness/` | `inbox/freshness/` |
| PAT MCP | `src/canvas_mcp/tools/` | optional token | preview-only writes |
| Skills | `skills/*/SKILL.md`, `skills/_SESSION.md` | `src/canvas_mcp/core/skill_router.py` | ranked skill, no Canvas call |
| Connectors | `browser/scripts/lib/connector-registry.mjs` | `plugins/cu-boulder-campusgroups` | Bucket A only |
| Actuators | `mcp-servers/{gmail,gcal,apple-cal}` | `mcp-servers/common/actuator.py` | confirm-gated or hard-blocked |
| Landing | `landing/index.html`, `landing/config.js` | Notebook CSS | Vercel site |
| Marketing | `marketing/placements.json` | `baseUrl` (currently null) | QR/NFC targets |

Flags: `marketing/placements.json` `baseUrl` is null, so printed codes have no live target until that field is set. `landing/config.js` `downloadUrl` is null and the repo has no tags, so the download button cannot point at a release. Skill `audit` and `source-to-spec` are maintainer skills; they are not student-router triggers, which matches their role.

## 1 — Git and GitHub

**Observed**

- Branch `main` tracks `origin/main` (`https://github.com/jacobdpfeifer-svg/Kairos_Time.git`). Recent messages are readable. History was not rewritten.
- `.env` and `browser/.auth/` are gitignored. `.env` is mode `0600`; `browser/.auth/` is `0700`. Neither is staged.
- History contains `config/overlays/enterprise.env` with setting *names* (`MCP_CLIENT_API_KEY_REQUIRED`), not a live key. No secret values are copied here.
- Largest tracked blobs are design PNGs around 1 MB (`docs/design/references/`). No filter-repo recommendation.
- GitHub description matches the local-first student app. Homepage is `https://kairostime-landing.vercel.app`, same as the README. Topics are `canvas`, `education`, `macos`. Default branch `main`. CI workflows exist under `.github/workflows/`; the README does not claim a badge.

**Manual (remote only)**

```bash
gh repo edit jacobdpfeifer-svg/Kairos_Time --add-topic local-first --add-topic student
```

Social preview was not inspected in the GitHub UI.

## 2 — Docs and README

README names Kairos, links MASTER, SECURITY, and the live site, and has a "For reviewers" section. Architecture truth path matches SSO → `/api/v1` → inbox, with the extension as a GET-only side path. `CLAUDE.md` top-level layout matches the tree (`app`, `browser`, `src`, `skills`, `plugins`, `schools`, `landing`, `marketing`, `vendor`, `services`).

Open drift: `CHANGELOG.md` is the upstream canvas-mcp log, called out in architecture. Handoff docs stay historical; this pass did not rewrite them.

## 3 — Landing and marketing

`landing/index.html` shows Today, Week, Courses, Study, Advisor. Copy says the school login stays with the student and Kairos does not see the password. `sourceUrl` matches the GitHub remote. `downloadUrl` is null (no release asset).

`landing/styles.css` uses a marker swipe (`linear-gradient` on the highlight) and `box-shadow: 0 0 0 var(--hl)` (a zero-spread ring, not a glow). No glass regression found in that file.

`marketing/placements.json` slugs are still the print set. **Open:** `baseUrl` is null, so QR/NFC generation has nowhere to point.

## 4 — Test, lint, build

| Command | Result |
|---------|--------|
| `uv run python -m pytest tests/ -q` | 1013 passed, 37 skipped, 1 xfailed |
| `cd browser && npm test` | 442 passed, 118 suites |
| `cd app && npm test` | 39 files, 237 passed |
| `cd app && npm run build` | clean; one chunk is 518.70 kB (local webview) |
| `uv run ruff check .` | all checks passed |
| `uv run mypy src/` | no issues in 73 files (note: unused mypy override sections for `tests.*`, `mem0`, `numpy.*`) |

`npm ci` was not re-run; `app/node_modules` was already present.

**Skipped:** live SSO sync, `canvas-mcp-server --test`, real Gmail/GCal sends, relay, `cargo test` (iCloud; use `scripts/native-mirror.sh` when a Rust change needs it). This pass did not change Rust behavior beyond a comment.

## 5 — Wiring

- `submit_assignment` in `src/canvas_mcp/tools/student_write.py` is `readOnlyHint=True`, `@validate_params`, and its docstring says it never submits. Quiz-shaped assignments return a refusal.
- Tool modules that declare `@mcp.tool()` also declare `@validate_params` (discovery, student_write, messaging, student_tools, discussions, assignments, courses, files, modules, self_identity).
- Gmail and GCal call `gate_connector_write`. Apple Calendar `create_event` returns `blocked: true` with no EventKit call.
- Registry entry `cu-boulder/campusgroups` points at `plugins/cu-boulder-campusgroups`, which exists. `schools/cu-boulder.yaml` is the one curated overlay.
- `AGENTS.md` student skills have directories. `audit` and `source-to-spec` are maintainer skills and are not in `RELIABLE_SKILL_IDS`.

## 6 — Dead code removed

None this run. Retired Blot selectors are already gone from `app/src/spatial.css`. Ignored clutter (`_build-comparison`, `_candidate-b-integration`, `var/`) is not tracked.

## 7 — Structure

**Fixed:** none beyond reviewer comments in §8. Duplicated `write_atomic` helpers remain in `calendar.rs`, `workspace.rs`, and `briefs.rs`. Unifying them is a Rust refactor, not a one-line fix.

**Proposals**

1. Set `marketing/placements.json` `baseUrl` when a public go-link host is chosen. Observed: `null`. Why: printed QR codes would be blank. Size: one field, product decision.
2. Point `landing/config.js` `downloadUrl` at a real asset only after the first tagged release. There are no tags today.
3. Add `local-first` and `student` GitHub topics (§1). Remote-only.
4. mypy reports unused override sections because `mypy src/` does not include `tests/`. Either pass `tests` or drop the `tests.*` override. Low risk.

## 8 — Reviewer notes added

- `app/src/main.tsx`
- `app/src/ipc.ts`
- `app/src-tauri/src/main.rs`
- `src/canvas_mcp/core/skill_router.py`
- `browser/scripts/lib/connector-registry.mjs`
- `browser/scripts/sync-canvas-canonical.mjs`

`landing/index.html` and `app/extension-chrome/lib/canvas-read.js` already explained themselves.

## 9 — Security, latency, UI

Connection map is §0.

- **Canvas-visible boundary.** `submit_assignment` previews and returns. No execute branch was added. Extension reads stay in `canvas-read.js` (GET, no method parameter, no CSRF). Confirmed by reading the tool and the extension header, and by the green `tests/security/test_student_write_invariants.py` run inside the 1013.
- **Write gates.** Gmail/GCal go through `gate_connector_write` / `gate_with_human`. Apple Calendar stays blocked. No standing-yes path was found in `mcp-servers/common/actuator.py`.
- **Secrets.** Feed URLs and the browser profile are under gitignored auth paths. This pass did not print them.
- **IPC.** New calendar undo commands compare an id; they do not join it into a path (`remove_calendar_event`, `restore_calendar_suggestion`). `write_atomic` in `calendar.rs` is the crash-safe write for that file.
- **Latency.** Vite build is under a second. The 519 kB chunk loads from disk in the webview. No new padded wait was introduced.
- **UI.** Landing nav matches the app. Marker highlight is a Notebook swipe, not a glow treatment.

No new critical or high finding beyond what the same-day report already fixed in the working tree (calendar line-preserving undo, declined-row focus, week "done" window). Those fixes are still uncommitted.

## 10 — Intentional boundaries confirmed

No educator tools, hosted Azure, or quiz executor. Canvas submit, comment, and discussion post stay preview-only. No SIS or DegreeWorks scraper and no registration execute path. No RateMyProfessors scrape. No `self_improve` pipeline. No learning streak or leaderboard. Apple Calendar hard-blocked. Gmail and Google Calendar writes need a per-instance yes. Relay stays unhosted.

## 11 — Unverified

1. Click through the running app: `cd app && npm run tauri dev` (defer, done, export sheet, keyboard `d`).
2. macOS Reduce motion on the extension stage and the landing page.
3. GitHub social preview image in the repo About settings.
4. One live SSO sync, one PAT `--test`, one Gmail send, and one Google Calendar write, each stopping at its confirmation.
