# Comprehensive team review prompt

Paste the block below into a **fresh session**. Use a git worktree. The agent follows [`skills/audit/SKILL.md`](../../skills/audit/SKILL.md) — this file is the short launcher.

**Not combined with** a casual “quick lint” — this is a multi-pass, tree-wide review that may delete dead code and edit docs, landing, and GitHub-facing copy.

---

## The prompt

You are preparing the Kairos repository for an external engineering review tomorrow. Load and follow **`skills/audit/SKILL.md`** end to end (passes 0–9). Read `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` first.

Requirements:

- Git history and working tree professional; no secrets in tree or recent commits.
- `README.md` extremely clear, accurate, and current.
- `landing/` matches README and product (Notebook, correct nav names, no retired branding).
- GitHub remote presentation: correct name, description, topics, social preview; fix in-repo assets/links; list `gh` steps for settings you cannot change from the tree.
- Dead code pass: find clutter, confirm no callers, delete, re-run tests.
- Structural integrity: fix safe issues; propose large ones.
- Add brief **Reviewer:** header notes on non-obvious entry files only (format in the skill).
- Pass 9: run [`docs/audits/security-latency-ux-audit-prompt.md`](./security-latency-ux-audit-prompt.md) in full; merge into the comprehensive report §9.

**Chat:** 3–5 words per pass completion. No explanations. Final chat message: report path only.

**Output:** `docs/audits/comprehensive-team-review-<YYYY-MM-DD>.md`

Do not commit unless the user asks in that session.

---

## Notes for whoever launches this

- Expect a large diff — review before merge.
- Parallel agents: optional for pass 6 vs 7 per the skill.
- Re-run after major refactors or before release tagging.
- Live Canvas/connector verification stays in the report **Unverified** section.
