# Full-repo audit prompt

**Team review tomorrow?** Prefer [`comprehensive-team-review-prompt.md`](./comprehensive-team-review-prompt.md) and [`skills/audit/SKILL.md`](../../skills/audit/SKILL.md) — they add git/GitHub, landing parity, dead code, reviewer file notes, and mandatory security/latency/UI pass 9.

A standing prompt for a comprehensive, end-to-end audit of this repo. Paste the block below into a **fresh session** (recommend a git worktree — this touches a lot of files) to run it. Two passes, run in this order: **fix pass** first (bounded, mechanical), **think pass** second (open-ended, structural). Don't skip straight to the think pass — you need the fix pass's inventory to reason about structure honestly.

---

## The prompt

You are doing a full audit of this repository. Read `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` first — they define scope boundaries that override anything below. In particular: **do not** restore educator tools, hosted Azure, or quiz-taking automation; **do not** add an execute path to `submit_assignment` or any Canvas comment/discussion-post tool (preview-only, permanently); **do not** build a Buff Portal/DegreeWorks scraper or registration execute path; **do not** re-add the `self_improve` cluster/draft/shadow/promote pipeline; **do not** add learning streaks or leaderboards. If your audit finds something that *looks* like a gap against one of these, it's a deliberate boundary — note it as "confirmed intentional," don't fix it.

### Pass 1 — Fix (mechanical, bounded)

Goal: everything that's wired together actually works, end to end, right now.

1. **Inventory.** Walk the full tree: `AGENTS.md`, `browser/` (SSO sync scripts), `src/canvas_mcp/` (vendored MCP + `core/`), `skills/*/SKILL.md`, `app/` (Tauri shell — note if genuinely parked vs. actively edited; git status will show which), `plugins/`, `schools/`, `docs/`, `tests/`. Build a mental map of what calls what.
2. **Run everything that can be run**, and read the output, don't just check exit codes:
   - `uv run python -m pytest tests/ -q` (and any narrower pytest markers/dirs you find)
   - `cd browser && npm run test` (`node --test tests/*.test.mjs`)
   - `uv run ruff check .` and `uv run mypy` (config is in `pyproject.toml`, `[tool.ruff]` / `[tool.mypy]`)
   - `cd app && npm run build` (tsc + vite build) if `app/` has uncommitted or recent changes — check `git status`/`git log` first; if it's truly untouched and parked, skip the build but still read the source for dead wiring
   - `cd browser && node scripts/validate-profiles.mjs` if it exists and is cheap
   - Any other `npm run` / `uv run` script you find that doesn't require live network/SSO/credentials. Skip anything that needs a real Canvas session, a PAT, or sends real email/calendar writes — those can't run headless here.
3. **Wiring audit**, specifically:
   - Every `SKILL.md` cross-reference (`[text](../other-skill/SKILL.md)`, doc links) — does the target file exist at that path?
   - `skills/_SESSION.md` and `src/canvas_mcp/core/skill_router.py` — does the router's trigger table actually match the skill index in `AGENTS.md`? Any skill directory with no router entry, or router entry with no directory?
   - `@mcp.tool()` definitions in `src/canvas_mcp/` — each has `@validate_params`? `submit_assignment` has no execute branch (still `readOnlyHint`)?
   - Bucket-A connector writes go through `canvas_mcp.core.connector_guards.get_connector_guard` — any write path that doesn't?
   - `plugins/*/` registry entries in `browser/scripts/lib/connector-registry.mjs` — every plugin directory registered, every registry entry backed by a real directory?
   - Personal Gmail/GCal write tools (`send_email`, `create_event`, `update_event`) — confirm `ConfirmationGuard`/`gate_connector_write` sits in front of every execute call, no bypass branch.
   - Dead imports, unused exports, TODO/FIXME/XXX comments older than the most recent related commit, config keys read by nothing, `.env.example` vs. actual env var usage drift.
   - `docs/architecture.md` and `docs/handoff/*.md` claims vs. actual code — flag (don't necessarily fix) doc drift.
4. **Fix what's safe to fix inline**: broken relative links, actually-dead code with no callers, mismatched router/skill entries, failing lint/type errors, obviously-wrong logic caught by a failing test, missing `@validate_params`, an unregistered plugin. Small, mechanical, low-risk — the kind of fix a reviewer wouldn't need to think hard about.
5. **Don't fix inline, just log to a findings list**: anything that requires a judgment call about product scope, anything touching the guardrails above, anything that would need live credentials to verify, anything non-trivial in size. These go to the report, not the working tree.
6. Follow the repo's git safety rules: no `git add -A`, no destructive commands, no force-push, never commit `.env` or `browser/.auth/`. Stage and describe your fixes; don't commit unless asked.

### Pass 2 — Think (open-ended, structural)

Goal: is this repo's *shape* right, not just its wiring.

You have real leeway here — use it. Step back from individual files and ask:

- Where is there duplicated logic across `browser/` scripts, `src/canvas_mcp/core/`, and `skills/` that a shared module would collapse?
- Is the "one truth path" (SSO → `/api/v1` → inbox, PAT as optional fallback) actually followed everywhere, or have shortcuts crept in that read Canvas some other way?
- Does the skill-router / SKILL.md-per-capability pattern still make sense at the current skill count, or is it starting to strain (e.g., skills that overlap, skills nobody's triggers actually reach)?
- Is the vendored `src/canvas_mcp/` fork drifting from upstream in a way that's getting harder to merge? (Check `vendor/README.md` for the boundary; you don't need network access to reason about this from the diff shape.)
- Is `app/` (Tauri shell) actually parked, or is it silently accumulating changes that contradict that status?
- Config/secrets handling, error handling conventions, test coverage shape (unit vs. integration, what's untested) — anything structurally thin?

**You're explicitly allowed to go outside the repo for this pass** — look at how comparable projects are built: other MCP servers (the upstream `vishalsachdev/canvas-mcp` this repo forks is a natural first stop), other "read-only assistant with human-confirmed write gate" architectures, other skill-routing / tool-routing patterns, other local-first SSO-cookie-sync tools. The point isn't to import someone else's stack — it's to sanity-check whether this repo's own patterns (connector guards, preview-only tools, skill router, inbox-as-single-source-of-truth) are the natural shape for this problem or whether they've calcified into something more complicated than the problem needs. Bring back concrete comparisons, not vague inspiration ("project X handles tool-gating with Y pattern — here's how that maps or doesn't onto `connector_guards.py`").

For this pass, **propose, don't implement.** Structural changes are too risky to land unreviewed in an audit sweep. Write up each proposal with: what you observed, why it matters, the concrete change, and a rough size/risk estimate (trivial / small / needs a real plan).

### Output

Produce a single report (`docs/handoff/audit-<date>.md`, dated) with three sections:

1. **Fixed** — each fix, one line, with the file(s) touched.
2. **Findings, not fixed** — each issue, why it wasn't safe to fix inline, and what a fix would require.
3. **Structural proposals** — from Pass 2, each with the observed/why/change/size-risk shape above, including any external comparisons that informed it.

Then stop. Don't commit. Tell the user what's in the working tree and hand them the report.

---

## Notes for whoever launches this

- Run it in a worktree or a throwaway branch — it touches files across the whole tree and Pass 1 alone can produce a sizeable diff.
- It deliberately can't verify anything gated behind live Canvas SSO, a PAT, or real Gmail/Calendar sends — those stay manual.
- Re-run periodically (e.g. before a release, or after a big refactor lands) rather than treating one run as exhaustive; Pass 2 in particular is meant to surface different things depending on what's changed since the last pass.
