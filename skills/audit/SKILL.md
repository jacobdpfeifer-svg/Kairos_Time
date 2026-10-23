---
name: audit
description: >-
  End-to-end repository review for external coders: git hygiene, docs/README,
  landing parity, GitHub presence, dead code, structure, reviewer file notes,
  tests, and security/latency/UI. Use for "comprehensive audit", "team review",
  "prep repo for review", or before a release handoff.
schema_version: 1
category: maintenance
model_tier: default
requires_cloud: false
---

# Comprehensive team review audit

**Launcher:** Fresh session, git worktree or throwaway branch. Read `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` before any edit. Product boundaries in those files override this skill.

**Chat rule:** After each pass, reply in **3–5 words max** (e.g. `Pass 3 done`). All evidence, lists, and rationale go only in the report file. No summaries in chat unless the user asks.

**Commit rule:** Stage deliberately; never `git add -A`. Never commit `.env`, `browser/.auth/`, or `{user_root}/` secrets. Do not commit unless the user asks in that session.

**Do not** restore educator tools, hosted Azure, quiz automation, Canvas submit/comment/discussion execute paths, SIS/DegreeWorks scrapers, registration execute, RateMyProfessors scrape, `self_improve`, learning streaks, or leaderboards. Missing pieces there are **intentional** — log as confirmed boundary, do not “fix.”

**Live checks** (SSO, PAT, real Gmail/Calendar sends, funded relay) stay **unverified** unless the user runs them; name the single manual check in the report.

---

## Run order

Execute passes **in sequence**. Later passes may edit files earlier passes listed.

| # | Pass | Primary output |
|---|------|----------------|
| 0 | Inventory map | Rows in report §0 |
| 1 | Git & GitHub presence | Fixes + §1 |
| 2 | README & docs truth | Fixes + §2 |
| 3 | Landing & marketing parity | Fixes + §3 |
| 4 | Tests, lint, build | Fixes + §4 |
| 5 | Wiring & registry integrity | Fixes + §5 |
| 6 | Dead code & clutter | Deletions + §6 |
| 7 | Structural integrity | Fixes + proposals §7 |
| 8 | Reviewer orientation notes | Header comments + §8 |
| 9 | Security, latency, UI (deep) | Follow linked prompt; §9 |

For pass 6 and 7, you may spawn **parallel subagents** (dead-code-only vs structure-only) if the host supports it. Merge into one report.

**Do not** run pass 9 in the same session as a shallow skim of passes 1–8 only — pass 9 is mandatory for a “comprehensive” audit. Use [`docs/audits/security-latency-ux-audit-prompt.md`](../../docs/audits/security-latency-ux-audit-prompt.md) verbatim for pass 9 mechanics; fold its connection map and findings into §9 of this report (do not write a second security-only file unless pass 9 alone was requested).

Mechanical wiring and small safe fixes also align with [`docs/audits/full-repo-audit-prompt.md`](../../docs/audits/full-repo-audit-prompt.md) pass 1 — dedupe work, prefer one fix in the tree.

---

## Pass 0 — Inventory map

Walk the tree and record **entry point → depends on → artifact**:

- `README.md`, `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`, `package.json`, root scripts
- `app/` (Tauri `src-tauri/`, React `src/`, `extension-chrome/`, `native-messaging/`)
- `browser/` (sync, freshness, voice, connector registry)
- `src/canvas_mcp/`, `mcp-servers/`, `tests/`
- `skills/*/SKILL.md`, `skills/_SESSION.md`, skill router in Python
- `plugins/`, `schools/`, `landing/`, `marketing/`, `design-system/kairos/`
- `docs/` especially `architecture.md`, `handoff/`, `VOICE.md`
- `vendor/`, deleted paths still mentioned in docs

Flag: doc claims a path that does not exist; generated dirs (`app/extension-chrome/shared/`) out of sync with source; skill in `AGENTS.md` with no directory or router entry.

---

## Pass 1 — Git & GitHub presence

**Local git hygiene**

- `git log --oneline -30` — messages readable for reviewers; squash noise only if user asked (default: note, do not rewrite history).
- `git status` — no accidental secrets; `.env` / `browser/.auth/` untracked or gitignored.
- Scan for committed credentials: `git log -p --all -S 'api_key' -- '*.env' '*.json'` (patterns only; never paste secret values into the report).
- Large binaries or stray artifacts in history — note path and size; recommend `git filter-repo` only in report unless user asked.
- Default branch name, tags, release assets vs `landing/config.js` `downloadUrl`.

**GitHub (or Origin) remote presentation** — use `gh` when available:

- Repository **name**, **description**, and **topics** match Kairos positioning (local-first Canvas student companion; not “Canvas MCP educator”).
- **About** link matches README site URL (`landing` / Vercel).
- **Social preview**: README wordmark or repo image; no broken image URLs.
- Default branch protection / CI badges in README if CI exists — badge must match real workflow.
- Open issues/PR templates if present — professional, not empty boilerplate.

Fix in-repo what you can (README links, `landing/config.js`, assets under `design-system/kairos/logo/`). Remote-only settings → §1 **manual** checklist with exact `gh` commands.

---

## Pass 2 — README & docs

**README.md** is the reviewer front door:

- Accurate repo map table; commands run as written on a clean macOS dev machine.
- “For reviewers” section matches tomorrow’s expectations (architecture, MASTER, SECURITY, landing parity).
- Links resolve (relative paths, no dead `site/` or deleted explorations).
- Product name **Kairos** consistent; fork story (`CHANGELOG.md` vs product history) clear.

Cross-check:

- `docs/architecture.md` vs actual SSO → inbox → app path
- `docs/README.md` index complete
- `SECURITY.md` contact/path current
- Handoff docs under `docs/handoff/` — stale claims flagged or one-line “superseded by …” in report only unless a one-line doc fix is obvious
- `CLAUDE.md` layout block matches real top-level dirs

Update docs when you change behavior; do not expand scope.

---

## Pass 3 — Landing & marketing parity

Compare **`landing/`** (and deployed copy if `WebFetch` or browser available) to **README** and **app** reality:

| Claim area | Check |
|------------|--------|
| Product name, tagline, audience | Same as README |
| Screens / nav labels | Today, Week, Courses, Study, Advisor — not retired brands (Living Instrument, Spatial-only, Blot character) |
| Token / privacy story | Aligns with “no password”, preview-only Canvas actions |
| Download / repo buttons | `landing/config.js` switches; GitHub URL matches remote |
| Visual | Notebook tokens per `design-system/kairos/MASTER.md` — no glass/gradient/glow regressions |
| `marketing/` placements | QR/NFC targets still valid |

Fix copy and assets in `landing/` when drift is factual. Do not invent testimonials or metrics.

---

## Pass 4 — Tests, lint, build

Run and **read output** (exit code alone is insufficient):

```bash
uv run python -m pytest tests/ -q
cd browser && npm run test
uv run ruff check .
uv run mypy
cd app && npm ci && npm run test && npm run build
```

Skip only what needs live Canvas, PAT, or real connector sends — list in §4 **skipped**.

Fix failing tests and lint introduced by the audit; pre-existing failures → §4 **open** with file:line.

---

## Pass 5 — Wiring & registry integrity

- Every `skills/*/SKILL.md` link target exists.
- `AGENTS.md` skill index ↔ directories ↔ `skill_router` triggers.
- `@mcp.tool()` + `@validate_params`; preview-only submit/comment/discussion unchanged.
- Connector writes → `get_connector_guard`; Gmail/GCal → `ConfirmationGuard` only.
- `connector-registry.mjs` ↔ `plugins/*`.
- `app/extension-chrome/tools/vendor-shared.mjs` ↔ `app/extension-chrome/shared/`.
- `.env.example` (if present) ↔ code env reads.

---

## Pass 6 — Dead code & clutter

Goal: **remove** unused code, not comment it out.

Method:

1. List candidates: unused exports, unreferenced files, deleted scripts still imported, duplicate helpers, stale `design-system/explorations/`, empty dirs, commented-out blocks, obsolete tests for removed features.
2. Confirm **no callers** (grep, import graph, router registration).
3. Delete; run targeted tests from pass 4.
4. Do **not** delete intentional preview-only stubs, guard rails, or vendored upstream you cannot verify.

Record each removal as `path — reason` in §6.

---

## Pass 7 — Structural integrity

Step back from line edits:

- Duplication across `browser/`, `canvas_mcp/core/`, `app/src/`.
- Truth path violations (Canvas read not via SSO/API/extension allow-list).
- Error-handling and typing consistency on IPC/Tauri boundaries.
- Test pyramid holes on critical paths (sync parse, nav, notify policy, extension allow-list).
- `app/` vs docs saying “parked” — reconcile README/status.

**Implement** small structural fixes that are clearly correct (shared constant, extract duplicate 10-line function, fix wrong module boundary). **Propose only** (in §7) changes that need product judgment or large refactors — include observed / why / change / size-risk.

---

## Pass 8 — Reviewer orientation notes

Add **brief** human-facing notes at the **top** of files reviewers will open cold. Do not annotate every file.

**Format**

- JS/TS/TSX/CSS: `/* Reviewer: <what this file is>; <why it exists>. */`
- Python/Rust/Go/shell: `# Reviewer: ...`
- HTML: `<!-- Reviewer: ... -->`

Rules:

- One or two sentences max per file.
- Prefer: entrypoints (`main.rs`, `main.tsx`), IPC bridges, extension allow-list, sync orchestrator, skill router, connector registry, `landing/index.html`, top-level `README` siblings without their own README.
- Skip generated, vendored upstream, and single obvious re-exports.
- No narrative essays; no restating CLAUDE.md in full.

List touched paths in §8.

---

## Pass 9 — Security, latency, UI

Execute [`docs/audits/security-latency-ux-audit-prompt.md`](../../docs/audits/security-latency-ux-audit-prompt.md) **in full** (connection map → security → latency → UI → structural fixes). Merge results into §9 of this report instead of a separate dated security file unless the user requested only pass 9.

---

## Report

Write **`docs/audits/comprehensive-team-review-<YYYY-MM-DD>.md`** with:

0. **Inventory** — connection/area table from pass 0  
1. **Git & GitHub** — fixed; manual remote steps  
2. **Docs & README** — fixed; open drift  
3. **Landing parity** — fixed; open  
4. **Test/lint/build** — results; skipped; open failures  
5. **Wiring** — fixed; open  
6. **Dead code removed** — list  
7. **Structure** — fixed; proposals  
8. **Reviewer notes added** — file list  
9. **Security/latency/UI** — summary pointers (detail from pass 9)  
10. **Intentional boundaries confirmed**  
11. **Unverified** — one manual check each  

Then stop. Chat: **report path only** (3–5 words).

---

## Paste prompt (fresh session)

For a copy-paste block without loading this file, use [`docs/audits/comprehensive-team-review-prompt.md`](../../docs/audits/comprehensive-team-review-prompt.md).
