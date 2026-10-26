---
name: audit-deep
description: >-
  Whole-system audit: the workbench the code lives in, git history and
  provenance, the product code, how a human actually operates the UI, UX and
  craft, micro code quality, safety invariants, supply chain, and macro shape.
  Also audits the audits. Use for "deep audit", "full-system audit", "audit
  everything", "why did the audits miss this", or before a hosting/release
  decision. Fixes what is safe; proposes what is not.
schema_version: 1
category: maintenance
model_tier: default
requires_cloud: false
---

# Deep audit — whole system

[`audit`](../audit/SKILL.md) audits the **product tree**. This skill audits the **system**: the machine and checkout the code lives in, the history behind it, the person operating it, and the audit apparatus itself. It delegates the product-tree passes rather than restating them.

Per-tier checklists are in [`TIERS.md`](TIERS.md). Read the tier you are on, not all of them.

**Read first:** `AGENTS.md` (the single copy of the hard prohibitions), `CLAUDE.md`, `docs/architecture.md`, `design-system/kairos/MASTER.md`. Product boundaries there override this skill.

## Launch conditions — load-bearing

- Run from the **real checkout**, not a git worktree and not a mirror. Worktrees contain only tracked files, so Tier 1 is undetectable from inside one. If the host forces a worktree, say so in §0 and mark Tier 1 **not run** rather than reporting it clean.
- Do **not** start from a prior audit report's file list. Confirm each path still exists and still owns what the doc claims.
- Record which harness you are in (Claude Code, Cursor, Codex, cloud). Tier 0 depends on knowing.
- `git fetch` first and check for concurrent sessions. Another agent may be committing to `main` while you work; a tree that changes under you is a finding, not a glitch.

## Rules

**Chat:** 3–5 words per tier (`Tier 4 done`). Evidence goes in the report. **Exception:** if you find something no tier asked about and it looks like it matters, say it in one line in chat *and* file it in §Z. A terse-output rule that suppresses off-rubric findings is how previous audits missed an entire layer.

**Commits:** stage deliberately, never `git add -A`. Never commit `.env`, `browser/.auth/`, `{user_root}/`, feed tokens, or anything under `**/auth/`. Do not commit unless the user asks in that session.

**Boundaries:** the prohibitions in `AGENTS.md` are not gaps. A finding against one is an intentional boundary — log as confirmed, do not "fix."

**Findings:** every one carries **observed** / **evidence** (the command and its real output) / **why it matters** / **fix applied, or why not** / **size-risk** (trivial / small / needs a plan). A grep hit is a lead, not a verdict. A finding you named, understood, and could safely fix is not done until it is fixed. A workaround is a finding, not a resolution.

**Verification:** `scripts/verify.sh` is the feedback loop (ruff, pytest, app vitest). Run it after every fix. A fix needs a test that fails when the fix is reverted. mypy, the browser tests, and cargo are separate — run them when you touch what they cover.

## Run order

Tiers 0–2 come before 3: you cannot reason honestly about code without knowing whether the checkout, the history, and the instructions are sound. Tier 9 is last because it needs everything above.

| Tier | Scope | The one thing it exists to catch |
|------|-------|----------------------------------|
| 0 | Audit the audit apparatus | An instruction file no launcher points at, so it is never read and never corrected |
| 1 | Workbench and environment | A workaround standing in for a fixable environment defect, reported as green |
| 2 | Git history and provenance | A secret, or a weight, that only the full history shows |
| 3 | Product tree (delegated) | — runs [`audit`](../audit/SKILL.md) passes 0–9 |
| 4 | Human operation of the UI | What happens to a person using it, which source review cannot answer |
| 5 | UX, craft, and copy | Overclaim: a scheduler state or a guess presented as fact |
| 6 | Micro code quality | A green test that never calls the real seam |
| 7 | Safety invariants | A written invariant with no check that can fail |
| 8 | Supply chain and agent tooling | New tooling that logs what must never be logged |
| 9 | Macro shape (propose only) | Complexity that no longer matches the problem |

**Tier 3 delegation.** Run `audit` passes 0–9 (inventory, git/GitHub, README and docs truth, landing parity, tests/lint/build, wiring and registry integrity, dead code, structure, reviewer notes, and its mandatory pass 9 security/latency/UI). Do not restate those passes and do not write a second report. Amendments while running under this skill:

- Run from the real checkout; their worktree recommendation does not apply here.
- Their pass 1 git work is superseded by Tier 2 — do it once, in Tier 2.
- Their pass 4 "skip `app/` build if parked" exemption does **not** apply: build it, or state in §3 why you could not.
- Fold their findings into §3, keeping their numbered subsections.

For pass 6 and 7, and for Tier 4's surface walk, you may spawn parallel subagents if the host supports it. Merge into one report.

## Related skills

- [`audit`](../audit/SKILL.md) — product tree, team-review scope. Tier 3 runs it.
- [`learning-program-audit`](../learning-program-audit/SKILL.md) — deep contract tracing of the learn loop and brief-continuity cue. Narrower than Tier 6; run it instead when only that program is in question.
- [`docs/audits/security-latency-ux-audit-prompt.md`](../../docs/audits/security-latency-ux-audit-prompt.md) — connection map, security, latency, UI. Reached through Tier 3.

## Report

Write **`docs/audits/deep-audit-<YYYY-MM-DD>.md`**:

0. **Audit apparatus** — instruction inventory, name collisions, harness context-load table, stale instructions fixed, blind-spot mechanisms found in prior reports
1. **Workbench** — disk vs tracked numbers, sync-layer exposure, build-in-place result, every workaround with its cost, verify command (created or found), reclaimed space
2. **Git and provenance** — history notes, secret-scan result (paths and patterns only), ignore-rule defects, topology, attribution
3. **Product tree** — delegated passes 0–9, their subsections preserved
4. **Human operation** — cold start, first-run step count, degraded-state table, four-way surface walk, honesty audit, departure-test rungs, frequency-test violations
5. **UX and craft** — fixed; open
6. **Micro code quality** — fixed; open, with `file:line`
7. **Invariants** — each check, pass/fail, and any new test added
8. **Supply chain** — dependency findings; verdict on any proposed agent tooling with the empirical evidence
9. **Macro proposals** — propose-only, each with size-risk
10. **Intentional boundaries confirmed**
11. **Unverified** — one named manual check each (live SSO, PAT, real Gmail/Calendar sends, funded relay)
**Z. Off-rubric** — anything no tier asked about. This section exists because the previous audits had nowhere to put the finding that mattered most. If it is empty, say why.

Then stop. Chat: report path, plus any one-line off-rubric flag.
