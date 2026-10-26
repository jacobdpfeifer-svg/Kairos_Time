# Comprehensive team review — 2026-10-25

An independent run of [`skills/audit/SKILL.md`](../../skills/audit/SKILL.md), passes 0–9, on branch
`audit/comprehensive-2026-10-25` off `main` at `60261f3` (clean tree at start). Pass 9 follows
[`security-latency-ux-audit-prompt.md`](security-latency-ux-audit-prompt.md) and is folded into §9.

The two reports from 2026-10-23 ([`comprehensive-team-review-2026-10-23.md`](comprehensive-team-review-2026-10-23.md),
[`-fresh`](comprehensive-team-review-2026-10-23-fresh.md)) are the baseline. Their open items are
re-checked here and marked **still open**, **closed**, or **reclassified**. Everything else is new.

## Follow-up, 2026-10-26

A second pass checked this report against the code and landed the onboarding gap
it had left as a proposal. Two corrections to §7 proposal 1:

- `user_profile.py` does not own Throwaway. Its docstring and tests leave that
  section alone, and no skill reads Values. The lines skills actually weigh are
  Career priorities, Interests, Program, Academic floors, transfer notes, and the
  Student overrides in `templates/calibration/priority-rubric.md`.
- Program was not fully orphaned. Advisor and Settings already write major,
  catalog year, and target term through `study/audit_copy.py`.

What changed: `save_onboarding` now seeds `USER.md` and the calibration files,
then sets Institution and School slug only. Settings → Profile has "What to
weigh" (three aims, three optional interests, courses to put first, courses to
keep light). Light courses are written to both the rubric and the Throwaway
section. A list the form did not send is left alone, so this does not wipe a
major. Those writes are owner-only (`0600`), including a later program-field
save. The template no longer says those sections are written during onboarding.
First-run did not grow a questionnaire. The weekly feed capture and the
`claude-haiku-4-5` default are still unchanged, for the reasons in §7 and §9.
§11's live checks are still unverified.

---

## 0 — Inventory

| Area | Entry | Depends on | Artifact |
|------|-------|------------|----------|
| Reviewer door | `README.md`, `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md` | `docs/architecture.md`, `design-system/kairos/MASTER.md` | public story + the one prohibition list |
| Desktop shell | `app/src/main.tsx` → `App.tsx` | `app/src/ipc.ts` → `app/src-tauri/src/main.rs` (59 commands) | WKWebView workspace |
| Student-file writes | `app/src-tauri/src/userfile.rs` (**new, §7**) | `{user_root}` | one crash-safe `0600` writer for calendar, briefs, workspace |
| Sync | `browser/scripts/sync-canvas-canonical.mjs` | SSO profile `{user_root}/auth/browser` | `{user_root}/inbox/` |
| Freshness | `app/extension-chrome/lib/canvas-read.js` → `app/native-messaging/host.py` → `browser/scripts/lib/freshness/` | `inbox/freshness/deltas/` | `dashboard.json` |
| Feed capture | `browser/scripts/lib/canvas-feeds.mjs` `captureFeeds` | live SSO page, weekly staleness check | `{user_root}/auth/feeds.json` (0600) |
| PAT MCP | `src/canvas_mcp/tools/` — 41 `@mcp.tool()`, 43 `@validate_params` | optional token | preview-only Canvas writes |
| Study + relay | `canvas_mcp.core.study`, `study/ask.py` → `study/ai.py` → `services/relay/` | invite + pinned pricing `2026-09-18` | capped, content-free accounting |
| Skills | `skills/*/SKILL.md` (19 dirs), `skills/_SESSION.md` | `core/skill_router.py` | ranked skill, no Canvas call |
| Connectors | `browser/scripts/lib/connector-registry.mjs` | `plugins/cu-boulder-campusgroups` | Bucket A, `surface: "web"` only |
| Actuators | `mcp-servers/{gmail,gcal,apple-cal}` | `mcp-servers/common/actuator.py` | confirm-gated or hard-blocked |
| Landing | `landing/index.html`, `landing/config.js` | `landing/motion.css` (byte-identical to the design system) | Vercel site |
| Marketing | `marketing/placements.json` | `baseUrl` (null) | QR/NFC targets |

**Flags raised in pass 0 and resolved later in this report**

- 24 markdown link targets do not resolve. 22 are `{user_root}`-relative paths inside `skills/*/SKILL.md`
  (`../../USER.md`, `../../calibration/*`) — per-user data, never committed, and the 2026-10-23 report
  already ruled them not defects. Of the rest, `docs/research/…-2026-10-13.md:3` is a false positive
  (`%20` in the target), and two are literal `url` placeholders inside example output blocks. **No
  action.**
- `app/extension-chrome/shared/` is in sync with its source: `vendor-shared.mjs` regenerated with no
  diff, and `--check` is green.
- `skills/` directories, the `AGENTS.md` index, and `RELIABLE_SKILL_IDS` agree. `audit`, `audit-deep`,
  `source-to-spec` and `learning-program-audit` are maintainer skills and are deliberately not router
  triggers.
- Two `core/` modules have no caller outside `tests/`: `skill_eval.py` and `user_profile.py`. The first
  is a CI harness and is fine. The second is a **regression — §7 proposal 1.**

---

## 1 — Git and GitHub

**Observed**

- `main` tracks `https://github.com/jacobdpfeifer-svg/Kairos_Time.git`. Recent messages read well. No
  history rewrite, no tags, no releases.
- `.env` is gitignored and mode `0600`; `browser/.auth/` is gitignored and `0700`. Neither is staged.
- History search for `sk-ant` and `AIza` returns nothing. `config/overlays/*.env` hold setting *names*
  and placeholder paths only; no secret value is reproduced here or in those files.
- Largest tracked blobs are design PNGs ~1.1 MB and `uv.lock` revisions ~750 KB. No `filter-repo`
  recommendation.
- GitHub: description and homepage match the README, default branch `main`, MIT, public. Four issue
  templates plus `config.yml`, `dependabot.yml`, three workflows. The README claims no CI badge, so
  there is no badge to mismatch.
- `landing/config.js` `downloadUrl` is `null` and there are no releases — consistent, not drift.

**Manual (remote only, unchanged from 2026-10-23 — still open)**

```bash
gh repo edit jacobdpfeifer-svg/Kairos_Time --add-topic local-first --add-topic student
```

Topics are still `canvas`, `education`, `macos`. The social preview image was not inspected.

---

## 2 — Docs and README

**Verified true:** every top-level path in the `CLAUDE.md` layout block exists. `README.md` commands
resolve to real files and scripts (`scripts/dev-app.sh`, `scripts/verify.sh`, every `npm run` target
named). `SECURITY.md` contacts and boundaries match the code. The `~40 tools` claim in `manifest.json`
is accurate — 41 `@mcp.tool()` registrations. The preview-only wording that the 2026-10-23 run fixed in
`manifest.json` and `server.json` is **still correct** (closed).

**Fixed**

- `docs/README.md` — the index omitted `docs/VOICE.md`, which `CLAUDE.md` points at by name, and
  `docs/audits/`, which `README.md` "For reviewers" step 6 points at. Added a row for each.

**Open drift**

- `docs/handoff/architect-brief.md:93` and `:255` claim `COURSE_AGENT_POLICY_DEFAULT` is enforced in
  code via `get_config().course_agent_policy_default`. It is not — see §5. Left as a dated handoff
  record rather than rewritten; this report is the correction.
- `CHANGELOG.md` is upstream canvas-mcp's log on purpose (`vendor/README.md`, `docs/architecture.md`).

---

## 3 — Landing and marketing parity

**Verified true:** nav and copy name Today, Week, Courses, Study, Advisor. No retired brand survives
(no Living Instrument, no Spatial-only, no Blot). The single `streak` hit is the honest negative claim
"has no streaks to lose". No testimonials and no invented metrics — the numbers on the page are a
worked grade example and illustrative course lanes. `landing/motion.css` is byte-identical to
`design-system/kairos/motion.css`. `sourceUrl` matches the remote. The waitlist and early-access forms
are `mailto:` only, matching the copy that says nothing was stored.

**Fixed**

- `landing/index.html:200` — the page loads Vercel Web Analytics (`/_vercel/insights/script.js`), which
  `landing/README.md` documents but the visitor-facing privacy section did not mention. For a product
  whose privacy section is titled "Where your stuff lives", that omission is factual drift. Added one
  sentence to the existing `.wont` paragraph: the page counts visits by path and device type, from its
  own domain, without cookies, and the app sends it nothing. Put in the existing paragraph rather than a
  third privacy column, because `.privacy-cols` is a two-column grid and MASTER §13 bans 3-up grids.

**Reclassified (was 2026-10-23 §7 proposal 1 and §3 open)**

- `marketing/placements.json` `baseUrl: null` is **not a defect.** `marketing/make-codes.mjs:27-40`
  refuses to print until it is a bare `https://` domain, and `marketing/README.md` says why. It fails
  closed and is honestly documented. No action until a go-link host is chosen.

---

## 4 — Test, lint, build

| Command | Result |
|---------|--------|
| `uv run python -m pytest tests/ -q` | **1013 passed**, 37 skipped, 1 xfailed (42s) |
| `cd services/relay && pytest tests/ -q` | **23 passed** (22 before this run, +1 added in §9) |
| `cd browser && npm test` | **442 passed**, 118 suites |
| `cd app && npm test` | **39 files, 237 passed** |
| `cd app && npm run build` | clean; one chunk 518.70 kB |
| `uv run ruff check .` | all checks passed |
| `uv run mypy src/` | no issues in 73 source files |
| `cd app/src-tauri && cargo check --all-targets` | clean |
| `cd app/src-tauri && cargo test` | **61 passed** (60 before, +1 added in §7) |
| `cd app/src-tauri && cargo clippy --all-targets` | no warnings |

**Note on cargo.** `AGENTS.md` and the 2026-10-23 run treat cargo as skipped because the checkout may
sit under iCloud Drive. This checkout is at `/Users/jacobpfeifer/dev/kairos`, not under iCloud, and
`cargo check`, `cargo test` and `cargo clippy` all run clean in place — so the Rust change in §7 is
compiled and tested, not shipped blind. `scripts/native-mirror.sh` is still the answer for a checkout
that *is* under iCloud.

**Skipped (needs something live):** SSO sync, `canvas-mcp-server --test`, real Gmail/GCal sends, a
funded relay dispatch with a real key. Each appears in §11 with the single check that settles it.

**Open, pre-existing, now reduced:** `mypy` printed `unused section(s): module = ['mem0', 'mem0.*',
'numpy.*', 'tests.*']`. `mem0` appears nowhere in the tree, so those two entries were dead config and
are removed (§7). `numpy.*` and `tests.*` still print, because `mypy src/` does not reach either —
`numpy` is imported inside a function and matched by the bare `numpy` entry, and `tests/` is out of
scope. Either run `uv run mypy src tests` or drop the `tests.*` override; a one-line product call, not
an audit fix.

**Not a defect:** the 518.70 kB chunk loads from disk in a local WKWebView. It costs no network time.

---

## 5 — Wiring

- `submit_assignment`, `comment_on_my_submission`, and every discussion post/reply tool are
  `readOnlyHint=True` with no execute branch and no `.post(` anywhere in `student_write.py` or
  `discussions.py`.
- Every `@mcp.tool()` module also declares `@validate_params` (41 tools, 43 decorators).
- `mcp-servers/gmail/server.py:48,118` call `gate_connector_write`; `mcp-servers/gcal/server.py:48,112`
  call `gate_with_human` with a `confirmation_token`; `mcp-servers/apple-cal/server.py:35` returns
  `blocked: true` with no EventKit call.
- `connector-registry.mjs` rejects any `surface` but `"web"` and its one entry resolves to
  `plugins/cu-boulder-campusgroups`, which exists; `schools/cu-boulder.yaml` is the one curated overlay.
- `vendor-shared.mjs` ↔ `app/extension-chrome/shared/`: no drift.

**Fixed — a config block that reads like a live security control and gates nothing**

`env.template:28` and `config/overlays/baseline.env:33` declared
`COURSE_AGENT_POLICY_ENABLED=true` / `COURSE_AGENT_POLICY_DEFAULT=deny` under the comment
"Multi-tenant write policy — deny until syllabus/calibration allows (fail closed)". Nothing reads
either name: `core/course_policy.py` now contains only `assert_no_identity_override`, and the
per-course syllabus policy belonged to the upstream educator-era write path, which is gone. The risk
here is the unusual direction — a reviewer auditing the posture would believe a gate exists. Labeled
**INERT** in both files and documented in `config/overlays/README.md` beside the `TS_SANDBOX_*` block,
which was already handled this way. Kept rather than deleted, to preserve the record of what a future
write path would have to re-establish.

**Checked and honest already:** every other unread variable is declared unenforced in
`config/overlays/README.md` (`TS_SANDBOX_*`, `MCP_BIND_*`, token storage, client auth, audit logging,
SIEM). `STUDENT_WRITE_TOOLS` and `INSTITUTION_NAME` are both read (`core/config.py:237`, `:225`).

**Low, no change:** `env.template:31` ships `INSTITUTION_NAME=University of Colorado Boulder` a few
lines from the architecture's rule that the school is discovered at onboarding. It is a dev template
default, not product UI, and `README.md` tells developers to set `SCHOOL_SLUG` — but a reviewer reading
only the template could mistake it for an assumption.

---

## 6 — Dead code removed

**None.** Every candidate turned out to be live or deliberately retained:

- `app/src/blot/core/**` and `app/extension-chrome/shared/blot/**` — retired character, engine retained
  by the 2026-10-07 decision recorded in `CLAUDE.md`. Imported by `App.tsx` and `voice/presence.ts`.
- `app/src/voice/demo.ts` — dev-only, dynamically imported behind `?blot`, documented in its header.
- `core/skill_eval.py`, `core/user_profile.py` — reachable as CLIs and exercised by tests. The second
  has lost its product caller; that is a regression to restore, not code to delete (§7 proposal 1).
- Remaining `streak` / `leaderboard` matches in `core/` are negative assertions in comments.
- No empty tracked directories, no `TODO`/`FIXME`/`XXX`/`HACK` in `src`, `app/src`, `browser/scripts`
  or `mcp-servers`, no commented-out blocks.

---

## 7 — Structure

### Fixed — one crash-safe writer for student-owned files

**Symptom.** Three copies of `write_atomic` in `app/src-tauri/src/{calendar,briefs,workspace}.rs`. The
2026-10-23 run logged this as duplication and left it. Reading the three side by side, they had drifted
into three different behaviors, and two of the differences are security-relevant:

| | `calendar.rs` | `briefs.rs` | `workspace.rs` |
|---|---|---|---|
| failed `chmod 0600` | ignored (`let _ =`) | ignored | fails closed, removes temp |
| temp file name | pid-scoped | `with_extension("json.tmp")` — not pid-scoped, and rewrites the extension of a non-`.json` target | pid-scoped |
| temp left after a failed rename | removed | **left behind** | removed |
| parent directory mode | `create_dir_all` | `create_dir_all` | `0700` |

So on any filesystem where `set_permissions` fails, the student's calendar and briefs were written at
the umask default instead of `0600` — and `SECURITY.md` says this data stays private to the student.
Two concurrent brief writes could also clobber each other's temp file.

**Earliest cause.** There was no single authority for "replace a file under `{user_root}`", so each
module re-derived the invariant and each got a different part of it wrong.

**The layer edited.** New `app/src-tauri/src/userfile.rs` holds one `write_atomic(&Path, &[u8])` and one
`ensure_dir`, with the strictest behavior of the three: parents at `0700`, pid-scoped temp, `0600`
enforced or the write fails and the temp is removed, temp removed on a failed rename. The three modules
now import it; the `&str` call sites pass `.as_bytes()`. No caller special-cases anything.

**Verified.** `cargo check --all-targets`, `cargo clippy --all-targets` clean; `cargo test` 61 passed,
including a new `userfile::tests::write_atomic_leaves_no_temp_file_and_a_private_mode` that asserts the
`0600` mode and that no `.tmp-` file survives.

### Fixed (small)

- `pyproject.toml` — dropped the `mem0`, `mem0.*` mypy override entries. `mem0` is not a dependency and
  appears nowhere in the tree.

### Proposals

**1. Onboarding no longer writes the student's own USER.md — a regression of the 2026-09-13 fix.
Medium.**

- *Observed.* `core/user_profile.py` owns `## Identity`, `## Program`, `## Interests (ranked)`,
  `## Academic floors`, `## Career priorities (ranked)`, `## Values about college` and
  `## Throwaway / low-attention courses` in `{user_root}/USER.md`. Nothing in `app/src` or
  `app/src-tauri` calls it. `save_onboarding` (`commands.rs:153`) now writes only the school slug, and
  the `save_user_profile` command that `docs/handoff/fix-claims-remediation-2026-09-13.md:22` recorded
  as allowlisted in `build.rs` and `capabilities/default.json` is gone from the tree. The only writer
  left is `core/learning_profile.py:250`, which owns `## Learning profile` — exactly the state the
  2026-09-13 audit found and fixed ("the template said 'written during onboarding' but only
  '## Learning profile' … were ever populated", quoted in that module's own docstring).
- *Why it matters.* `USER.md` is step 1 of the truth path in both `CLAUDE.md` and `AGENTS.md`.
  `student-task-brief`, `canvas-week-plan` and `student-course-arc` all triage against it, and
  `templates/USER.md:3` still tells the student it is "Written during onboarding". Today those sections
  stay as placeholders like `(fill during onboarding)`, so priority scoring optimizes against template
  text. No error is raised — the brief simply has no goals to weigh.
- *Probable cause.* The 2026-10-13 restructure into Today · Week · Courses · Study · Advisor dropped the
  screen that collected these answers; the Python writer and its tests survived the caller.
- *Change required.* Restore a caller: either an onboarding step that posts the identity/program
  answers to a `save_user_profile` command wrapping `user_profile.apply_onboarding_identity`, or route
  them through the voice intake, which already collects goals (into `inbox/`, not `USER.md`).
- *Size and risk.* Small-to-medium in code, but it is a product decision — which questions, in which
  surface, in what order — so it is a proposal, not an audit edit. Until it lands, either the template
  line or the skills' expectations are wrong.

**2. Stale Anthropic model default. Low, but it is a correctness-and-cost item. Deliberately not
changed.**

- *Observed.* `core/llm_provider.py:17` `DEFAULT_WRITE_MODEL = "claude-haiku-4-5"`, repeated in
  `env.template:51` and `config/overlays/baseline.env:25`. The relay pins the same id with its own
  prices: `services/relay/relay/config.py:13` `{"input": 1.00, "output": 5.00}` at
  `PRICING_VERSION = "2026-09-18"`.
- *Why it matters.* `claude-haiku-4-5` is a generation behind. The current Haiku is `claude-haiku-5-5`:
  1M context instead of 200K, and $0.10/$0.50 per MTok up to 100K tokens instead of $1.00/$5.00 — about
  ten times cheaper for this workload.
- *Why I did not just bump it.* It is not a drop-in. On `claude-haiku-5-5` thinking is adaptive and
  **on when `thinking` is omitted**, which is what both callers do. `llm_provider.py:153` sends
  `max_tokens: 1024`, and the relay bounds `MAX_OUTPUT_TOKENS = 2400` with the comment "reasoning
  disabled for Claude baseline" — so on the newer model reasoning tokens would share those ceilings and
  could truncate the visible answer, and the relay's flat per-model price table cannot express the
  newer model's tiered rate (above 100K input it is $0.50/$2.50). I made the change, found this, and
  reverted it.
- *Change required.* Bump the id **and** set an explicit effort (`output_config: {"effort": "low"}`) or
  raise `max_tokens` on both callers; for the relay, add the model to `PRICING`/`PROVIDER_OF`, bump
  `PRICING_VERSION`, and decide how the tiered rate is represented. The relay is unhosted, so its half
  can wait on the hosting decision.

**3. `app/src/styles.css` holds rules that contradict Notebook and are superseded by a later layer.
Low, partly unverified.**

- *Observed.* `styles.css:720` sets `text-transform: uppercase` on `.eyebrow`, which MASTER §13 bans by
  name and `notebook.css:974-986` explicitly resets (`text-transform: none`). `styles.css:211,358,412`
  set `box-shadow: 0 10px 28px rgba(0,0,0,.32)` and `0 12px 32px rgba(0,0,0,.45)`, where MASTER §05
  specifies one page shadow, `0 1px 0 var(--hairline), 0 18px 40px rgba(29,29,31,.06)` — five to seven
  times the opacity. `notebook.css:369` overrides `.sheet` with `var(--page-shadow)`, so the sheet is
  fine in the running app; `.onboarding` (`styles.css:358`) has no such override and may still carry the
  heavy shadow.
- *Why it matters.* Load order is `styles.css` → `spatial.css` → `notebook.css` (`main.tsx:7-9`), so
  most of this is dead-but-contradictory: a reviewer reading the base layer takes the wrong rule as
  current, and the next edit to `notebook.css` can silently un-shadow it.
- *Change required.* Delete the superseded `.eyebrow` uppercase and the three hard-coded shadows from
  `styles.css` and let the token own it. Not done here because the `.onboarding` elevation appears
  **live** and judging it needs the running app — see §11.

**Carried forward, unchanged:** GitHub topics (§1) and the mypy override sections (§4).

---

## 8 — Reviewer notes added

The six entrypoints annotated on 2026-10-23 still carry their notes (`app/src/main.tsx`,
`app/src/ipc.ts`, `app/src-tauri/src/main.rs`, `core/skill_router.py`, `connector-registry.mjs`,
`sync-canvas-canonical.mjs`). This run added or repaired:

- `app/src-tauri/src/userfile.rs` — new file, opens with a `Reviewer:` note explaining why it exists.
- `app/src/App.tsx` — the 507-line shell had a one-line `// Purpose:` comment. Replaced with what it
  owns (sidebar, mounted view, ⌘K, Ask and voice sheets) and what it does not (no Canvas calls; views
  own their data).
- `app/src/notify/policy.ts` — the file's explanation sat *below* its imports, so a cold reader saw
  imports first. Hoisted above them. Text unchanged.

Checked and deliberately left alone, because they already explain themselves at the top:
`app/native-messaging/host.py`, `app/extension-chrome/lib/canvas-read.js`, `app/src/nav.ts`,
`src/canvas_mcp/server.py`, `mcp-servers/common/actuator.py`, `core/connector_guards.py`,
`browser/scripts/freshness-tick.mjs`, `services/relay/relay/app.py`, `app/src/notebook.css`,
`design-system/kairos/motion.css`, `landing/index.html`.

---

## 9 — Security, latency, UI

The connection map is §0. Every finding below names a row in it.

### Changed — Canvas text reached the model as prose, not as fenced data (security, medium)

- *Connection.* Study + relay: `study/ask.py` → `study/ai.py` → `services/relay/`.
- *Observed.* `services/relay/relay/providers.py` `build_user_content` concatenated every forwarded
  field into one user message under plain bracket headers — `[Source 1 — {locator}]`, `[Question]`,
  `[Rubric or key]`, `[Student answer]` — and then appended the response contract ("Respond with JSON:
  …" or `BRIEF_INSTRUCTIONS`) **after** that text. Those fields are third-party: `source_passages[].text`
  comes from instructor-published pages, syllabi and announcements via
  `browser/scripts/sync-study-sources.mjs`, and `stem` comes from Canvas assignment text staged by the
  extension (`host.py` `handle_queue_ask`). A passage could therefore print `[Rubric or key]` or the
  JSON contract itself and the model had no way to tell that from a real section, and injected text sat
  below the only instruction block.
- *Why it matters.* A crafted course page could reframe the task and steer the `feedback` string that
  `ask.py:_maybe_relay` shows the student as an explanation. It is **not** critical: the relay forwards
  only allowlisted fields (`service.py:38`), accounting stays content-free, there is no Canvas write
  path, and `SYSTEM_PROMPT` already says to ignore instructions inside the material. What was missing is
  the non-forgeable boundary the rest of the tree has had since issue 239 —
  `core/untrusted_content.fence_untrusted`, used by every read tool and by
  `prompt_assembly.assemble_turn:434`. The one path where Canvas text actually leaves the machine was
  the one path not using it.
- *Earliest cause.* The builder that assembles the model request put untrusted text in the same
  namespace as its own instructions. Not a per-field sanitize step and not a stronger system prompt.
- *The layer edited.* `build_user_content` only — the single funnel both providers call. Each field is
  now wrapped in `<<<UNTRUSTED COURSE CONTENT (label) … >>> / <<<END UNTRUSTED COURSE CONTENT>>>`
  markers; `neutralize_markers` collapses any `<<<`-run that precedes the marker phrase (one linear
  pass over maximal runs — the obvious `<{3,}(?=phrase)` is quadratic and would be a DoS reachable
  through any page body, the same trap `core/untrusted_content.py` documents); locators additionally
  get `>>>`-runs collapsed so a locator cannot close its own opening marker; the trust framing now
  precedes the material and the contract follows it, so nothing inside a fence is the first or last
  thing the model reads. The vocabulary is duplicated rather than imported because the relay is
  stdlib-only by design and cannot import `canvas_mcp`; the comment says so.
- *Verified.* `services/relay` 23 passed, including a new
  `test_untrusted_material_is_fenced_and_cannot_forge_a_delimiter` that feeds a passage containing both
  `<<<END …>>>` and the `<<<<END …>>>` extra-bracket forgery plus a fake JSON contract, and asserts four
  intact fences, two degraded markers, the degraded locator, and the ordering. Token accounting stays
  honest: `estimate_input_tokens` measures `build_user_content`, so the ~175 tokens of markers count
  against the 8000-token bound and the reservation.

### Changed — see §7 for the `{user_root}` writer (security/correctness, medium-low)

### Open — security

Nothing else. Independently re-verified, all clean:

- **Canvas-visible boundary.** No execute branch on submit/comment/discussion. The extension reads only
  through `canvas-read.js`, whose single `fetch` is `method: "GET"` with no CSRF token and no method
  parameter.
- **Native host.** `app/native-messaging/host.py` is stdlib-only with a fixed ten-entry `HANDLERS`
  table, an unknown `type` refused, oversize and bad JSON refused in framing, no message field that
  reaches a path, every string clipped, and `0700` on every directory it creates. There is no message
  that widens the extension allow-list, writes Canvas, or returns a local path. `handle_legacy_sensor`
  strips the query string before logging a URL because it can carry tokens.
- **Path traversal.** `library.rs` `safe_name` splits on both separators, drops control characters and
  leading dots, and caps at 180 characters, so `..%2F..%2Fevil` stages as `evil` and a bare `..` becomes
  `file`. `library_stage_file` calls `rt.usable()` first, which fails closed in `RuntimeMode::Broken`.
- **Write gates.** As §5. No standing-yes path and no first-write exemption.
- **Secrets.** Feed URLs stay in `{user_root}/auth/feeds.json` at `0600`; feed state keys are URL
  hashes so the watcher state never repeats a token; `safeFeedUrl` requires https with no embedded
  credentials and, when an origin is known, the same origin.

### Open — latency

**Weekly feed capture sits on the sync's completion path, serially, unbounded. Medium. Local patch
refused.**

- *Connection.* Feed capture, on the tail of Sync.
- *Observed.* `sync-canvas-canonical.mjs:235` awaits `afterCanonicalSync`, which at
  `freshness-run.mjs:155` awaits `captureFeeds`. `canvas-feeds.mjs:61-79` loops over courses and, per
  course, awaits up to two in-page full-HTML loads one at a time; `pageGetText` (`:50`) runs
  `page.evaluate` with a bare in-page `fetch` — no `AbortController`, no timeout, and `page.evaluate`
  itself has no deadline here. `writeState`, `rebuildDashboard` and `context.close()` all come after it.
- *Why it matters.* The work is independent per course but serial, so a student with six courses takes
  up to twelve sequential page loads, and one slow or hung Canvas page stalls the end of
  `npm run sync`, the dashboard rebuild and the browser teardown. The surrounding `try/catch` contains
  an *error*, not a hang. Because the result is written only once at the end
  (`writeFeedsSecret(userRoot, await captureFeeds(...))`), a hang on the last course also discards the
  feeds already collected for the first five. Classification: **traced**, not measured — I did not time
  a live sync.
- *Earliest cause.* A weekly, best-effort capture is on the critical path of an interactive command,
  and the producer does per-item serial work.
- *Why no patch.* The pass-9 prompt names exactly this: a timeout or retry wrapped around a call that
  should not be synchronous or unbounded is a failed fix. The structural change is to move the capture
  off the sync completion path into the freshness tick — which already owns a cadence
  (`FEED_CADENCE_MS`) and already runs without a session — and to bound and persist it per course. That
  touches concurrency against a school's Canvas host, where politeness and 429 behavior are a product
  call, so it is recorded rather than landed.

Nothing else surfaced: no `transition: all` in any shipped CSS, and the only unbounded `fetch` calls
outside this path are inside Playwright page contexts on the same sync.

### Open — UI/UX

- §7 proposal 3 (superseded Notebook rules in `styles.css`; `.onboarding` elevation possibly live).
- No dead controls found: no `onClick={() => {}}`, no `href="#"`, no 3-up grids (`repeat(3,` /
  `1fr 1fr 1fr`) in `app/src/*.css`.
- The remaining `linear-gradient` uses are a 1px fading paper edge and a CSS dropdown caret, not
  surface decoration. Not findings.
- The app was **not exercised in a browser** this run, so the Pass-4 walk (Today → Week → Courses →
  Study → a connector preview → ⌘K), the empty/loading/error/signed-out states per view, focus order
  and hit targets are reviewed from source only. See §11.

---

## 10 — Intentional boundaries confirmed

Do not "fix" these. No educator tools, no hosted Azure, no quiz taking or generation, no auto-grading.
Canvas submit, comment and discussion post stay preview-only with no execute path. No SIS or
DegreeWorks scraper and no registration or add-drop execution. No RateMyProfessors scrape. No
`self_improve` pipeline. No learning streaks and no leaderboards — the `habit` brief-day count is
exposure, and the landing page advertises having none. Apple Calendar hard-blocked. Gmail and Google
Calendar writes need a per-instance human yes. Relay unhosted. `TS_SANDBOX_*`, `MCP_BIND_*`, token
storage, client auth, audit logging and SIEM variables are documented placeholders — and as of this
run, so is `COURSE_AGENT_POLICY_*`. The `{user_root}`-relative links in `skills/*/SKILL.md` point at
per-user data and are not broken links. `marketing` `baseUrl: null` fails closed by design. The Blot
engine is retained without a character by the 2026-10-07 decision. `CHANGELOG.md` is upstream's.

---

## 11 — Unverified

Each line is one check that would settle it.

1. **The UI walk.** `cd app && npm run tauri dev`, then Today → Week → Courses → Study → a connector
   preview → ⌘K, watching for empty vs signed-out states and whether Today's next action is visible
   without scrolling.
2. **`.onboarding` elevation** (§7 proposal 3). In the running app, inspect `.onboarding` and read its
   computed `box-shadow`: if it is `0 10px 28px rgba(0,0,0,.32)` rather than `var(--page-shadow)`, the
   `styles.css` cleanup is a live fix, not a dead-rule tidy.
3. **Reduced motion.** macOS System Settings → Accessibility → Display → Reduce motion, then reload the
   extension stage and the landing page; travel should be zero and the cross-fade should remain.
4. **One live SSO sync**, including whether `captureFeeds` is the long pole (`npm run sync` with a stale
   capture, timing the tail after "freshness").
5. **One PAT check** — `uv run canvas-mcp-server --test` with a token in `.env`.
6. **One Gmail send and one Google Calendar write**, each stopping at its confirmation and refusing
   without a token.
7. **One relay dispatch with a real key**, to confirm the fenced user content still returns schema-valid
   JSON and that `usage` lands inside `MAX_OUTPUT_TOKENS`.
8. **GitHub social preview** in the repo About settings, plus the two topics in §1.

---

## Files this run touched

Working tree on `audit/comprehensive-2026-10-25`, nothing committed:

```
new:  app/src-tauri/src/userfile.rs
mod:  app/src-tauri/src/{main,calendar,briefs,workspace}.rs
mod:  services/relay/relay/providers.py, services/relay/tests/test_relay.py
mod:  app/src/App.tsx, app/src/notify/policy.ts
mod:  env.template, config/overlays/{baseline.env,README.md}, pyproject.toml
mod:  docs/README.md, landing/index.html
new:  docs/audits/comprehensive-team-review-2026-10-25.md
```
