# Deep audit — tier checklists

Full checklists for [`audit-deep`](SKILL.md). Read the tier you are on; do not read all of them up front. The contract, launch conditions, finding discipline, and report spec live in `SKILL.md`.

---

## Tier 0 — Audit the audit apparatus

Nothing else in this repo audits the auditor. Audits are launched **by path**, so an instruction file nobody's launcher points at is never read and never corrected.

1. **Inventory every instruction surface** an agent can load:
   `CLAUDE.md`, `AGENTS.md`, `README.md`, `skills/_SESSION.md`, `skills/*/SKILL.md`, `.cursor/rules/*.mdc`, `.cursor/skills/**`, `.claude/**`, `.github/**` prompts, `docs/audits/*prompt*.md`, any `.agents/` or `.mdc` elsewhere.

2. **Name collisions and divergent duplicates.** Two files claiming the same skill `name:` are a defect even when both are good, because the winner depends on the harness. For each pair: `diff`, decide one canonical home under `skills/`, and leave a pointer — never a second copy.

   ```bash
   grep -rh '^name:' skills/*/SKILL.md .cursor/skills/*/SKILL.md 2>/dev/null | sort | uniq -d
   git ls-files -i -c --exclude-standard   # tracked but ignored: both-states files
   ```

3. **Harness context-load map.** Build the actual table, not the assumed one:

   | Harness | Loads |
   |---------|-------|
   | Claude Code | `CLAUDE.md`, `AGENTS.md`, `.claude/`, `skills/` via Skill tool |
   | Cursor | `AGENTS.md`, `.cursor/rules/*.mdc` (respecting `globs` / `alwaysApply`), `.cursor/skills/` |
   | Codex / others | `AGENTS.md` |

   Then answer: **for each hard prohibition in `CLAUDE.md`, which harnesses can reach it?** Any invariant reachable from only one harness is a finding. A rule with `alwaysApply: false` and a `globs` list does not load outside those globs — check what an agent editing `src/canvas_mcp/` or `browser/` actually sees. Fix by keeping invariants in `AGENTS.md` (read by every harness) and referencing them from `CLAUDE.md`, or by one `alwaysApply: true` rule that points at the canonical file. **Do not** solve it by duplicating the prohibition list; two copies drift.

   As of 2026-10-25 (`c320e1e`) `AGENTS.md` carries the single copy under **Hard prohibitions** and says so in the file. The standing check is therefore: is it still the only copy, does `CLAUDE.md` still point rather than restate, and has a second list reappeared anywhere in Tier 0.1's inventory?

4. **Stale instructions.** Every instruction file: branch pins (`git branch --list <pinned>` — a pin to a deleted branch is obeyed blindly), dated claims, link targets, referenced commands, and factual claims about the product. Spot-check each audit prompt's technical assertions against `CLAUDE.md` — these drift silently because no pass reads them.

5. **Blind-spot check.** For each prior report in `docs/audits/`, ask what question it could not have asked given where it ran and what it was told to look at. Record the mechanism, not just the miss. Known mechanisms to test for: worktree launch hides untracked state; `.gitignore` trust turns bulk into a non-finding; terse-output mandates suppress off-rubric observation; launch-by-path leaves unreferenced instruction files uncorrected; running only in the harness that loads the full context hides context-asymmetry.

6. **Fix the apparatus** before using it. If this skill or `skills/audit/SKILL.md` is wrong, fix it in this pass and note it in §0.

---

## Tier 1 — Workbench and environment

The conditions the code is developed and built under. Every previous audit skipped this tier entirely.

1. **Working-directory physics.** Record real numbers:

   ```bash
   du -sh .                                   # total working directory
   find . -type f | wc -l                     # files on disk
   git ls-files | wc -l                       # files tracked
   du -sh */ .*/ 2>/dev/null | sort -rh | head -15
   git count-objects -vH                      # history weight
   ```

   Report **disk vs tracked** as a ratio. A large gap is untracked build output, caches, or synthetic fixtures; it is invisible to `git status` and to any audit run in a worktree, and it is what an IDE indexer and file watcher actually pay for. Gitignored is not the same as harmless: `.gitignore` answers "should this be committed," never "should this exist here."

2. **Sync-layer hazards.** Is the checkout inside a syncing or network filesystem (iCloud `Mobile Documents`, Dropbox, OneDrive, SMB)?

   ```bash
   pwd | grep -q "Mobile Documents" && echo "UNDER ICLOUD"
   find . -name '*.icloud' | wc -l            # dataless placeholders
   ```

   Dataless placeholders make an agent's read or grep return nothing **silently** — a correctness hazard, not a speed one. Zero today is not a guarantee; report the exposure, not the snapshot.

3. **Build-in-place.** Can the native and web halves build where they sit? Try the real command, read the real error. If a workaround script exists (`scripts/native-mirror.sh`, `CARGO_TARGET_DIR` redirection, `node ./node_modules/<pkg>/bin/...` instead of a bare binary, `PYTHONPATH=src`, hardcoded `/opt/homebrew/bin`), then:

   - Log each one as an **open environment defect with a cost**, not as a solved problem. Name who pays: an agent that cannot infer the workaround, a new machine, CI.
   - A consistent workaround is indistinguishable from a healthy design to a wiring audit. That is precisely why this tier exists. Do not report green because the workaround works.
   - Say plainly whether the root cause is fixable (move the checkout off the sync layer) and what that would cost.

4. **Toolchain reproducibility.** Assumed `PATH` entries, hidden `.pth` files, `uv` vs `pip`, Node version, Rust toolchain, Playwright channel, unpinned dev tools. A command in `README.md` or `AGENTS.md` that does not run as written on a clean machine is a doc defect — fix the doc or the script.

5. **One-command verify.** `scripts/verify.sh` is that entry point as of 2026-10-25 (`c320e1e`): it puts `/opt/homebrew/bin` on `PATH`, sets `PYTHONPATH=src`, and runs ruff, pytest, and the app vitest suite. Check, and fix if false:

   - It runs green from a **cold shell** (`env -i` plus only what it sets itself), not just from a warm dev session.
   - It is still referenced at the top of `AGENTS.md`, and that reference is well-formed markdown.
   - Its deliberate exclusions — mypy, the browser tests, cargo — are named where an agent will see them, so their absence is a known gap rather than a silent one. Verify each excluded suite still has a documented way to run it.
   - It fails loudly on a real break. Introduce a trivial lint error in a scratch copy and confirm a non-zero exit.

   If no such entry point exists, **create it**. An agent that can tell whether it broke something improves code quality more than any amount of written guidance.

6. **Stale working state.** Leftover worktrees (`.claude/worktrees/`), orphaned `node_modules` inside them, scratch dirs (`var/`, `_build-comparison/`, `_candidate-b-integration/`), caches (`.mypy_cache/`, `.ruff_cache/`). For each: still referenced? If dead, delete and record the reclaimed size.

---

## Tier 2 — Git history and provenance

Micro (one commit) and macro (the shape of the whole history).

1. **History readability.** `git log --oneline -40`. Messages that explain *why*. Note WIP/fixup noise and squash-worthy runs, but **default to noting, not rewriting** — history rewrites need the user's explicit yes.

2. **Secret archaeology, including deleted files.** Patterns only. **Never paste a secret value into the report** — report `path:line` and the pattern that matched.

   ```bash
   git log --diff-filter=D --name-only | sort -u | head -40   # what was deleted, and when
   git log -p --all -S 'BEGIN PRIVATE KEY' -- . | head
   ```

   Test for this repo's specific exposure classes, which generic scanners miss because none of them look like a credential: tokenized Canvas feed URLs (an ordinary https URL with an opaque path token), Canvas PATs (`<id>~<opaque>`), SSO cookie jars under `**/auth/`, `GEMINI_API_KEY`. Read the `internal/*` postmortem in `.gitignore` and confirm the deny-by-default inversion still holds — a directory whose name implies privacy but whose default is publication will keep failing the same way.

3. **Ignore-rule correctness.** Tracked-but-ignored files (both states at once), ignore rules that mask a health signal, un-ignore exceptions (`!path`) that have outlived their reason.

4. **Weight and blobs.** Large objects in history, packfile size against tracked size. Recommend `git filter-repo` in the report only; never run it unprompted.

5. **Branch and remote topology.** Stale branches, unmerged work, divergence from `main`, tags against release assets and `landing/config.js` `downloadUrl`. Note that cloud sessions may push to `main` — fetch before judging divergence.

6. **Attribution and provenance.** Co-author trailers present and correct. The vendored fork boundary in `vendor/README.md` still accurate; upstream drift getting harder to merge.

---

## Tier 3 — Product tree (delegated)

Defined in full in [`SKILL.md`](SKILL.md) under **Tier 3 delegation**: run [`audit`](../audit/SKILL.md) passes 0–9 with the amendments listed there. Nothing further here, so the two files cannot drift.

---

## Tier 4 — Human operation of the UI

Not "does the UI render" but "what happens to a person using it." Source review cannot answer this tier. If you cannot run the UI, mark it **not run** — do not infer it.

Harness: `docs/build/student-beta/worth-installing-2026-10-08/harness/README.md` (webview walkthrough with synthetic profile and stubbed Canvas, plus the `env -i` installed-path probe). Reuse it; do not build a second one.

1. **Cold start on a clean machine.** Installed-path probe with `env -i`: no repo, no `uv`, no `PYTHONPATH`, no system Python, no npm, empty browser cache. The bundle must work from its own `core/`. This is the only test that catches "works in the dev tree, broken in the DMG."

2. **First run as a person.** Empty `{user_root}`, no PAT, onboarding from zero. Count the steps to the **first genuinely useful screen** and write the number down. Does the student know what to do next at every step without reading documentation? Is the school discovered, never assumed?

3. **Degraded-state walk.** Force each and record what the student sees: SSO failed, sync failed, sync empty, no network, stale freshness, expired cookies, malformed state files, daemon or Python crash, clock skew, a timezone and DST boundary, school-local day boundary. The bar: **a broken Canvas sign-in must be visibly different from an empty week**, and a dock that cannot read state must fail quiet rather than invent a streak, a due card, or a congratulatory empty state.

4. **Operate every surface, four ways.** Today → Week → Courses → Study → Advisor → a connector preview → ⌘K → Ask sheet → capture → voice sheet, each: (a) keyboard only, including focus order and escape paths; (b) reduced motion; (c) high contrast and dark; (d) at a small window (720×520). Note dead controls, buttons that call nothing, errors shown only in the console, truncated due dates, a primary action pushed below the fold, hit targets under 44px.

5. **Honesty audit.** For every state a student could misread, confirm the UI distinguishes it: guess vs confirmed, preview-not-sent vs sent, disconnected vs needs-confirm vs failed vs success, scheduler state vs mastery, brief continuity vs learning streak. Overclaim here is a safety bug, not a copy nit.

6. **Weight and reversibility (MASTER §16).** Apply the departure test to every outward or destructive action: *can the student get this back themselves, inside Kairos, five minutes from now?* Then check the rung is right — none / recovery window / confirm sheet / typed confirmation — and that reversibility is preferred over ceremony. An auto-dismissing toast is never the only way back. Weight must track the real outcome and never be amplified.

7. **Frequency test (MASTER §15).** Anything a student sees more than ~20 times a term must not travel. Nothing keyboard-initiated animates. No spring, bounce, overshoot, padded wait, fake progress, or shimmer. Reduced motion zeroes `--travel-*` and keeps the cross-fade; never `animation: none`.

8. **Re-walk after any UI fix.** A screenshot is not the audit.

---

## Tier 5 — UX, craft, and copy

Judge against `design-system/kairos/MASTER.md` §13 anti-patterns and §14 acceptance, plus §15–§17.

- Notebook look: near-white page, hairline rows, **one** `--hl` per screen, ink primary button with the highlighter offset shadow, Gabarito for UI, Caveat decorative and `aria-hidden` only. No glass, gradient, glow, mascot, 3-up card grid, uppercase eyebrow, `01/02` index, or middle-dot chain.
- Every view that waits on sync or a connector has empty, loading, error, and signed-out states.
- Read the copy aloud. Sentence case. No shame, no streak language, no implied submit. Plain dates via `app/src/format.ts`. Never name or assume a school.
- Disclosure (§17): driven by the student's own data, never a timer, two levels maximum, no tours.
- Prohibited by name (§16): sound, screen shake, particles, celebration, streaks, losable state, the free-to-play ladder, and any offer or pressure timed to a moment of failure.
- Suggestions wait for a yes and never reorder after acceptance. Ask is a sheet that never hides the next move. Notifications only for due-moved, high-stakes ≤48h not started, or sync broken.

---

## Tier 6 — Micro code quality

1. **Read the code as a reviewer, not a linter.** Does new code read like its surroundings — comment density, naming, idiom? Flag where a file has two conflicting styles.
2. **Seams.** Error handling and types at every boundary: Python `--json` output vs `app/src/ipc.ts` payload types vs daemon argv vs Tauri command names and capabilities. A payload field the UI requires and the CLI can drop is a defect even when tests pass.
3. **Owning layer.** When Python, Rust, and React disagree, name the owner and delete the duplicate instead of adding a third implementation. Prefer deleting the wrong path to adding a reconciling one.
4. **Duplication** across `browser/`, `src/canvas_mcp/core/`, `app/src/` that a shared module would collapse. Generated code (`app/extension-chrome/shared/`) actually regenerated from source.
5. **Tests that assert the story but not the behavior.** Green tests that never call the real seam — daemon argv, IPC payload, school-local day boundary, same-session flag, extension allow-list. Also: test pyramid holes on critical paths, fixtures drifted from real shapes, slow or flaky tests, obsolete tests for removed features. **A fix needs a test that fails when the fix is reverted.**
6. **Rot.** Dead imports, unused exports, config keys read by nothing, `.env.example` drift, TODO/FIXME older than the code around them, commented-out blocks. Delete rather than comment out; confirm no callers first; never delete an intentional preview-only stub, a guard rail, or unverifiable vendored upstream.

---

## Tier 7 — Safety invariants as executable checks

Turn each written invariant into a check that can fail. Where a check is cheap and durable, add it to `tests/` so the next audit does not have to remember.

| Invariant | Check |
|-----------|-------|
| `submit_assignment`, `comment_on_my_submission`, discussion post/reply are preview-only | no execute branch; `readOnlyHint` intact |
| Every `@mcp.tool()` validated | `@validate_params` present |
| Bucket-A connector writes gated | via `canvas_mcp.core.connector_guards.get_connector_guard`, no first-write exemption |
| Gmail/GCal writes gated | `ConfirmationGuard` / `gate_connector_write` in front of every execute call, no bypass, no standing posture |
| Apple Calendar | still hard-blocked, no EventKit helper |
| Feed tokens | only `{user_root}/auth/feeds.json`, mode 0600, never logged, exported, or held server-side |
| Canvas session/cookies | never held server-side |
| Extension reads | only `app/extension-chrome/lib/canvas-read.js`, GET, allow-listed paths, no CSRF token, `textContent` only |
| Native host | stdlib-only |
| Voice intake | exactly three local-append tools (`save_goal`, `append_class_note`, `save_workflow_draft`), declared only while `mode === "onboarding"`, every field enum- or length-bound by `normalizeWorkflowDraft`, `status` hardcoded `draft`, no Canvas access, no submit |
| Raw transcripts | stay in `{user_root}/inbox/voice/sessions/`, leave only as audio to the Live API |
| Degree claims | trace to a dated `inbox/degree-audit.md` paste; never inferred from Canvas alone |
| Gamification | no losable state, no learning streak, no leaderboard |
| Untrusted input | Canvas and inbox text treated as data, never instructions |

**Then the check nobody wrote:** grep the tree for any path that writes secrets, prompts, commands, or diffs to a log, a telemetry sink, or an external service. New observability or agent-memory tooling is the live risk here — see Tier 8.

**Standing out-of-scope grep.** Search for streak-freeze, badge, XP, hearts, exam-ready, grade prediction, quiz generation, leaderboard, "invent a check." Fix leaks; do not delete refusal language that is doing its job.

---

## Tier 8 — Supply chain and agent tooling

1. **Dependencies.** Advisories, unpinned versions, dev-tool bumps, a lockfile that disagrees with the manifest, transitive additions since the last audit.
2. **Vendored upstream.** Fork drift against the boundary in `vendor/README.md`.
3. **New agent tooling is audited before install, not after.** Any telemetry, observability, or agent-memory layer (the `agent-beacon` class of tool) must be evaluated against the invariant that feed tokens, Canvas cookies, and PATs are **never written to a log**. Required evidence before adoption:
   - Where does it store data, and is local-only actually selected rather than defaulted?
   - Is redaction pattern-based? If so, does any pattern match *this repo's* secret shapes — an opaque path token in an ordinary URL, `<id>~<opaque>`, a JSON cookie jar? Generic AWS/GitHub patterns do not.
   - Does redaction cover every exporter branch, or only the local writer?
   - Prove it empirically: run it, then grep its own store for a known token. Treat "stores only locally" as unverified until the file has been read.
   - A tool whose value is cross-session memory earns little in a repo whose knowledge is already written down; the cheaper fix is making the written knowledge load (Tier 0.3) and giving agents a verify loop (Tier 1.5).
4. **Secrets surface.** `.env` handling, `config/overlays/` tiers, CI secrets, anything a hook or MCP server can read.

---

## Tier 9 — Macro shape (propose only)

Step back. **Propose, do not implement** — structural change is too risky to land unreviewed in an audit sweep.

- Is the one truth path (SSO → `/api/v1` → inbox, PAT optional) actually followed everywhere, or have shortcuts crept in?
- Does the skill-router / SKILL.md-per-capability pattern still fit at the current skill count, or do skills overlap and triggers go unreached?
- Does the complexity match the problem, or has a pattern calcified into something more complicated than the problem needs?
- Is the local-first boundary still coherent against `docs/handoff/hosting-decision-criteria-2026-09-30.md`?
- Compare against comparable projects (upstream `canvas-mcp`, other local-first SSO-sync tools, other preview-only-with-confirm-gate architectures). Bring back concrete mappings, not vague inspiration.

Each proposal: observed / why it matters / the concrete change / size-risk.

---
