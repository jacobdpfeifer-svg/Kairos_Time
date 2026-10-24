# Foundation hardening program — 2026-10-23

## Purpose

This is the implementation program following the foundation review of Kairos.
It is intentionally a sequence of small, reversible migrations rather than a
rewrite. Its goal is to make the existing product behave as one system at
student scale and remain reliable as features, schools, courses, and local
history grow.

The primary outcome is a single local **student work state** read model:

```text
Canvas raw generations ─┐
Canvas freshness events ├─> student-work projection ─> Today / Week / Study /
Student planning choices┘                              Advisor / briefs / workspace
```

This does **not** replace the immutable Canvas source record, the study event
log, or student-owned source files. It provides one stable, versioned answer to
the questions every surface currently asks independently:

- What work exists, and where did it come from?
- What changed since the student last looked?
- What has the student decided to do, defer, or complete?
- What is the next supported action, and what data supports it?

## Why this holds up

The repo is already strong where it needs to be conservative: Canvas sync has
immutable raw generations and an atomic projection pointer; study has an
append-only event log and rebuildable projection; writes have explicit safety
boundaries. This program preserves those choices.

It changes the current fan-out architecture, where browser scripts, Python,
Rust, and React each derive overlapping product facts. The new projection is a
read model with a narrow contract, not a database migration, cloud service, or
new generic framework. Raw source data stays authoritative; personal decisions
stay separate from sync-owned facts; old agent-facing artifacts remain derived
compatibility outputs until their consumers migrate.

At every phase:

1. Existing public/user-visible artifacts remain readable.
2. A new output is built beside the old one.
3. Fixtures prove old and new outputs agree where they represent the same fact.
4. One surface moves only after those tests are green.
5. Deletion occurs only after no production reader remains.

This is what permits long-term scale. A school with 200 courses, a student with
several years of history, a partial Canvas failure, or an old local profile is
handled by the same versioned, rebuildable pipeline rather than a special UI
path.

## Product and safety invariants

These are release blockers for every prompt below.

- Canvas remains read-only. Submission, comment, and discussion tools remain
  preview-only; external/LTI/proctored work remains student-operated.
- No Canvas cookies, passwords, or tokenized feed URLs leave the local user
  root. Canvas-derived text remains untrusted data.
- Student decisions never disappear merely because a Canvas sync is partial,
  stale, or temporarily lacks an endpoint.
- A failed build of a derived projection never replaces the last known-good
  projection pointer.
- Every durable file has one named owner, a schema version, an atomic-write
  policy, and a recovery rule.
- A renderer cannot be the only validator of data it displays. Native code
  validates data crossing the WebView boundary.
- A configuration preference (including Workspace) cannot create, mutate, or
  become a second source of academic truth.
- No feature may bypass the school/plugin registry or its school gate.
- The program must work without a Canvas PAT, live relay, Gmail/GCal write, or
  an available SSO session. Those remain manual integration checks.

## Existing facts to preserve

| Existing owner | Current artifact | Keep because |
|---|---|---|
| Canonical sync | `inbox/canvas/raw/`, `inbox/canvas/projections/current.json` | source provenance, partial-sync safety, stable identifiers |
| Freshness | `inbox/freshness/events.jsonl`, `dashboard.json` | change detection and safe local polling |
| Week plan | `inbox/plan/items.jsonl`, `week.json` | student ordering, estimates, deferrals, and captures |
| Study | `study/events.jsonl`, `study/projection.json`, packets | evidence-labelled practice and replayability |
| Mission Control | `inbox/briefs/v1/` | deterministic explanation/ranking copy, not source ownership |
| Workspace | `workspace/workspace.json` and history | student-owned presentation choice and reversible edits |
| Agent compatibility | `inbox/week.md`, course Markdown, grades YAML, study-source JSON | local agent/skill workflow while clients migrate |

## Target boundary

Create a versioned projection under:

```text
{user_root}/inbox/work-state/v1/
  current.json                 # small atomic pointer / metadata
  generations/<generation-id>/
    state.json                 # normalized read model
    health.json                # input freshness and partial-data facts
```

Do not use this exact layout if existing `canvas-store` helpers provide a safer
equivalent; reuse the same staged-generation and confined-pointer pattern.
Never mutate a promoted generation in place.

`state.json` must stay deliberately small. It is a product read model, not a
dump of Canvas responses:

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-10-23T00:00:00Z",
  "source": {
    "canvas_sync_id": "...",          // nullable before first sync
    "freshness_event_cursor": 42,
    "plan_revision": "..."
  },
  "courses": [{ "id": "canvas:course:42", "label": "MATH 1234", "name": "…" }],
  "work_items": [{
    "id": "canvas:assignment:42:99",
    "course_id": "canvas:course:42",
    "kind": "assignment",
    "title": "Problem set 4",
    "due_at": "2026-10-25T23:59:00-06:00",
    "canvas": { "url": "…", "submission_state": "unsubmitted" },
    "provenance": { "sync_id": "…", "source_ids": ["…"] },
    "change": { "kind": "due_moved", "seen_at": "…" },
    "student": { "status": "planned", "estimate_minutes": 45, "planned_day": "2026-10-24" },
    "study": { "readiness": "source_partial", "exam_id": null }
  }]
}
```

The exact fields should be refined from existing canonical data. These rules
are non-negotiable:

- IDs are namespaced stable IDs derived from existing canonical IDs; never from
  a title, index, or transient UI sort order.
- Canvas-owned fields and student-owned fields are visibly separate objects.
- Missing/partial/unavailable input is represented honestly. Do not infer
  completion, source coverage, or a due date.
- There is no free-form executable field, HTML rendering field, or model-owned
  field in this contract.
- The projection only stores what its consumers need. Link to an existing
  source by ID/path rather than copying a large Canvas body.

## Compatibility policy

During migration the old artifacts remain **derived outputs**, never peer
authorities. The ownership table must be recorded in the architecture document
before the first cutover.

| Concern | Authoritative during migration | Compatibility output |
|---|---|---|
| Canvas facts | canonical Canvas generation/projection | `week.md`, course Markdown, grades YAML, study-source summaries |
| Student plan decisions | current `week_plan.py` state | work-state `student` fields |
| Freshness events | current append-only freshness event store | work-state `change` fields |
| Study record | current study event/projection store | work-state `study` summary only |
| Brief copy and ranking | brief assembler | a reader of work-state, never a work-state writer |
| Workspace layout | accepted workspace spec | a reader of the standard product state |

## Quality gates for the whole program

Run the relevant targeted tests during each phase and the whole suite before a
cutover. Do not replace a green existing test with a weaker assertion.

```bash
uv run python -m pytest tests/ -q
uv run ruff check .
uv run mypy src/
cd browser && npm test
cd app && npm test && npm run build
# For Rust changes: use scripts/native-mirror.sh as required by CLAUDE.md,
# then run cargo check --locked from the mirror / equivalent supported path.
```

Add these gates as the work progresses:

1. **Contract fixtures.** A compact corpus covering empty account, normal
   account, partial sync, changed due date, completed work, capture, deferred
   work, and a historical profile. Every producer and reader validates it.
2. **Reducer determinism.** Same inputs in different source order produce byte
   equivalent normalized records and stable ordering.
3. **Pointer safety.** Failed writes preserve the previous pointer and no
   pointer can escape its scoped user-root directory.
4. **Compatibility parity.** For shared fields, the old Week/Today/brief
   output and new work state agree on item IDs, due time, completion, and
   student plan order.
5. **Scale fixture.** At least 200 courses / 10,000 work records, with a
   bounded generation time and no renderer request that reads every raw Canvas
   file. Choose an evidence-based threshold after measuring the baseline; do
   not invent one.
6. **Upgrade fixture.** An older user root with no work-state directory opens
   safely; a malformed work-state falls back to the last valid generation or
   the existing readers with a clear health state.
7. **No hidden live dependencies.** All unit and contract tests run without
   Canvas, relay, email/calendar credentials, or the network.

## Agent operating rules

Every implementation agent using a prompt below must first read:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/architecture.md`
- `design-system/kairos/MASTER.md` for app/landing work
- `docs/handoff/canvas-focus-pivot-2026-09-11.md`
- this document

The agent must inspect existing tests and local ownership before editing. It
must preserve unrelated working-tree changes, use `apply_patch` for edits, not
commit unless asked, and report exact tests run plus any intentionally unrun
live checks. It must not perform a broad formatting rewrite.

The prompts are sequential. Do not begin a later prompt until the earlier
prompt's acceptance criteria are met and its compatibility observations are
recorded.

---

# Prompt 0 — Contract reconnaissance and decision record

Copy the following into a fresh implementation-agent session.

```text
You are hardening the Kairos local-first student platform. This is Prompt 0 of
the foundation-hardening program. Do not implement a new feature or change
student-visible behavior in this task.

Read AGENTS.md, CLAUDE.md, docs/architecture.md,
docs/handoff/foundation-hardening-program-2026-10-23.md, and the Canvas-focus
pivot before working. Respect all Canvas preview-only, external/LTI, local
privacy, and connector boundaries.

Mission: make the implicit ownership and data contracts explicit before a
migration. Kairos currently has canonical Canvas projections, freshness events,
week-plan state, study event state, Mission Control briefs, and workspace
configuration. The problem is overlapping derived facts, not a lack of
features. We need a single student-work read model without destabilizing any
existing path.

Inspect, at minimum:
- browser/scripts/sync-canvas-canonical.mjs
- browser/scripts/lib/{canvas-store,canvas-project,canvas-adapters}.mjs
- browser/scripts/lib/{freshness-store,freshness-run}.mjs
- browser/scripts/lib/briefs/
- src/canvas_mcp/core/week_plan.py and core/study/
- app/src-tauri/src/{canvas,briefs,semester,advisor,workspace,commands}.rs
- app/src/{App,ipc}.ts[x], views/TodayView.tsx, views/WeekView.tsx,
  missionControl/, workspace/
- tests and browser/tests covering these paths.

Deliverables:
1. Add docs/architecture/student-work-state-contract.md. It must contain:
   - a current producer -> durable artifact -> reader table;
   - a target ownership table that labels every artifact authoritative,
     projection, compatibility output, or preference;
   - the v1 work-state record contract: ID policy, required fields, optional
     fields, ordering rules, partial-data semantics, and prohibited fields;
   - source precedence when Canvas, freshness, and student decisions disagree;
   - atomic promotion, retention, corruption fallback, and migration policy;
   - a concise, explicit non-goals section.
2. Add a small fixture plan under tests/ or browser/tests (documentation only
   is acceptable in this prompt) naming the exact existing fixtures to reuse
   and the missing cases.
3. Update docs/architecture.md with a short link to the new contract and a
   clearly marked "planned migration" status. Do not claim it is built.

Constraints:
- Do not add a database, service, cloud sync, or new dependency.
- Do not rename/delete existing user-root artifacts.
- Do not alter current sync, Today, Week, briefs, study, or workspace behavior.
- Do not make generic claims like "single source of truth" without naming the
  owner and recovery rule for each field.
- Keep the contract under 300 lines; it must be a useful engineering boundary,
  not another long product narrative.

Verification:
- Run link/path checks appropriate to docs changed.
- Run no broad test suite unless code changes unexpectedly become necessary.
- Report the exact unresolved decisions that require product judgment; do not
  silently choose a destructive migration policy.
```

---

# Prompt 1 — Add a rebuildable work-state projection, shadow-only

```text
You are implementing Prompt 1 of docs/handoff/foundation-hardening-program-2026-10-23.md.
Prompt 0's contract must already exist and be treated as binding. Read all
repository instructions and the contract before editing.

Mission: add work-state/v1 as a shadow, rebuildable local projection. It must
be produced beside the existing artifacts and consumed by no student-facing UI
yet. This phase earns trust through determinism, compatibility, atomicity, and
fixtures—not by changing screens.

Existing foundations to reuse:
- canonical Canvas raw generations and projection pointer in
  browser/scripts/lib/canvas-store.mjs and canvas-project.mjs;
- freshness's append-only event data and rebuild function;
- week_plan.py's student-owned plan/deferral/capture state;
- study's existing projection as the only source for study readiness;
- current user-root resolver and atomic-write/confinement patterns.

Implement:
1. A pure normalizer/reducer in the runtime that already owns canonical sync
   (prefer browser/scripts/lib/ unless the Prompt 0 contract gives a strong,
   tested reason otherwise). It reads existing local artifacts only. It must
   not fetch Canvas, call AI, or invoke the app.
2. Versioned staged output and an atomic current pointer under the contract's
   work-state/v1 path. Preserve the previous pointer on every failure.
3. An explicit health record describing input versions, stale/missing inputs,
   partial Canvas state, and projection errors. Never hide an unavailable input
   by presenting an empty list as authoritative.
4. A development/diagnostic CLI or existing sync hook that rebuilds the
   projection after a successful canonical sync and after freshness/plan
   changes. It must be idempotent and safe under overlapping local processes.
5. Fixtures and tests for determinism, pointer confinement, partial sync,
   missing plan, moved due date, student deferral/order, and old profile with no
   work-state directory.

Important semantics:
- Canvas ownership wins for title, course, due date, URL, and submission fact.
- A freshness event annotates a work item; it must not duplicate one.
- Student planning decisions annotate the canonical work-item ID and survive
  Canvas partial sync. Unknown/orphaned choices must be retained honestly, not
  silently dropped.
- Study contributes a small readiness summary only; it must not copy packets,
  answers, or raw source text into work state.
- Stable IDs must be derived from canonical IDs, never titles or list position.
- Sorting must be specified and deterministic; locale/timezone conversion must
  reuse the existing school-timezone code.

Do not:
- migrate a React/Rust/Python reader yet;
- delete or stop generating week.md, briefs, course Markdown, grades YAML, or
  study sources;
- create a second week-plan or study state;
- modify Canvas write restrictions or credential handling;
- add a full-text cache to this projection.

Required verification:
- Existing browser canonical-sync, freshness, brief, and workspace tests still
  pass.
- New projection tests are network-free and use frozen fixtures.
- `uv run python -m pytest tests/ -q`, `cd browser && npm test`, `uv run ruff
  check .`, and `uv run mypy src/` pass unless a pre-existing failure is proven
  and reported.
- Record a measured projection time and output size for the normal and scale
  fixture. Do not impose an arbitrary performance target before measuring.

At handoff, report the schema, writer, read inputs, pointer recovery behavior,
test names, measurements, and every compatibility field intentionally deferred.
```

---

# Prompt 2 — Migrate Today and Week behind parity gates

```text
You are implementing Prompt 2 of docs/handoff/foundation-hardening-program-2026-10-23.md.
Prompt 1's shadow projection and tests must be green before you begin.

Mission: make Today and Week read a single typed work-state snapshot through
the native app boundary, while retaining the legacy readers as a tested
fallback. Do not redesign the screens. The student should see the same or more
honest information, never a different unexplained priority system.

Inspect the actual current paths before editing:
- app/src-tauri/src/canvas.rs, briefs.rs, semester.rs, commands.rs, and main.rs;
- app/src/ipc.ts, app/src/views/TodayView.tsx, WeekView.tsx, missionControl/,
  week/, and their tests;
- work-state contract and Prompt 1's projection fixtures.

Implement:
1. A narrowly typed native read command for the current validated work-state
   snapshot and health. Do not expose arbitrary filesystem reads or raw paths
   to React. Validate schema version and pointer confinement natively.
2. TypeScript types and a single app-side loader/hook. UI components should not
   know the user-root layout or open independent files.
3. Migrate Today/Mission Control and Week one at a time. Their existing ranking
   policy remains in its current owner until a later explicit migration; they
   consume canonical item facts, student decision state, and health from the
   shared snapshot.
4. A safe fallback: missing/malformed work state reads the existing stable
   projection path and exposes an honest non-blocking health message. It must
   not clear plan state or show a false empty week.
5. Parity tests proving normal fixtures yield the same item identity, due date,
   completion state, accepted plan order, and changed/moved-date indication in
   legacy and new paths. Add rendering tests for partial sync and fallback.

Rules:
- Do not pass generic `{cmd, params}` envelopes for this new read path.
- Do not embed ranking heuristics in React. React displays a typed view model.
- Do not make all old outputs disappear after this migration; skills and other
  consumers still need them.
- Preserve keyboard, reduced-motion, notification, and undo behavior.
- App startup must not block indefinitely waiting for a projection. Treat a
  missing first-sync projection as a normal first-run state.

Required verification:
- Targeted Today, Week, Mission Control, IPC/native tests.
- Full browser, Python, and app test/build commands from the program document.
- For Rust changes, run cargo check --locked through the supported non-iCloud
  mirror flow and report it.
- Exercise fixtures with no Canvas account, partial Canvas sync, a fresh
  moved-date event, an accepted plan, and an invalid work-state pointer.

At handoff report the exact fallback condition, migration coverage, and any
remaining reader that still directly reads legacy artifacts.
```

---

# Prompt 3 — Make briefs, Study, and Advisor consumers—not competing cores

```text
You are implementing Prompt 3 of docs/handoff/foundation-hardening-program-2026-10-23.md.
Prompts 1 and 2 must have passed their acceptance criteria. Read their contract,
test results, and implementation before editing.

Mission: remove duplicate product-world stitching from Mission Control, Study,
and Advisor without flattening their domain-specific logic.

This is a boundary cleanup, not a rewrite:
- Briefs retain their deterministic copy, ranking explanations, preferences,
  and "four islands" policy.
- Study retains its append-only events, reducers, packets, evidence labels,
  checkers, and safety boundaries.
- Advisor retains degree-audit provenance and its explicit no-SIS-scraper rule.
- Work state becomes their common identity/context input for a course/work item.

Implement in small commits/changes:
1. Make the brief assembler consume work-state item identity and health where
   it currently restitches Canvas/freshness/plan facts. It remains a projection
   writer only; it must never write Canvas, plan, study, or work-state facts.
2. Add a documented work-item reference seam to Study. A study session can
   identify its related work item, but study events remain the authority for
   practice/evidence. Do not migrate or rewrite historical study events.
3. Make Advisor use the shared course/work-item identity where relevant, while
   preserving the degree-audit import as the sole authority for requirement
   claims.
4. Delete duplicate derivation only after a search proves no production caller
   needs it and after parity tests demonstrate equivalent output. Keep
   compatibility adapters when skills still consume their Markdown/JSON files.
5. Update the ownership table in docs/architecture/student-work-state-contract.md
   with every migrated reader and any remaining exception.

Do not:
- put all brief/study/advisor behavior in one huge reducer;
- make work-state write study answers, degree decisions, or model text;
- claim source coverage or degree satisfaction without their current evidence;
- change Canvas write policy, relay policy, or student confirmation rules.

Tests must prove:
- a brief links to the same work item Today/Week identify;
- a moved due date appears once, not once per subsystem;
- an accepted Week plan retains its order after a brief rebuild;
- a study item with missing sources remains honestly partial;
- a missing/dated degree audit stays unable to make requirement claims;
- legacy agent-facing outputs still exist and remain bounded.

Run the full quality gate and report code deleted versus deliberately retained
as compatibility. A "simplification" that merely moves duplicate code to a new
module does not satisfy this task.
```

---

# Prompt 4 — Contracted IPC and durable-state registry

```text
You are implementing Prompt 4 of docs/handoff/foundation-hardening-program-2026-10-23.md.
This prompt starts only after the work-state projection is live for Today and
Week and Prompt 3 has recorded ownership exceptions.

Mission: make cross-runtime interfaces and durable files maintainable at scale.
Kairos has Rust, TypeScript/React, Node sync code, and Python core code. That
is acceptable; undocumented generic envelopes and invisible direct writers are
not.

Inspect:
- app/src-tauri/src/commands.rs, daemon.rs, runtime.rs, and main.rs;
- app/src/ipc.ts, study/api.ts, week/api.ts;
- Python study/week CLI handlers and validation;
- browser user-root, work-state, sync, and freshness writers;
- all direct filesystem writes under the user root.

Implement:
1. A durable-state registry in docs/architecture/ (machine-readable only if it
   demonstrably prevents drift). For every owned file/directory record: owner,
   schema, primary writer, readers, atomicity, retention, source of recovery,
   and whether it is source/projection/preference/compatibility.
2. Replace the ambiguous new work-state paths with typed, versioned native
   commands. For existing generic `study` and `week_plan` envelopes, introduce
   discriminated command types at the boundary incrementally; keep a temporary
   adapter only if removing it would break a packaged build.
3. Add native command registration/capability tests for every new command and
   request validation tests for malformed/unrecognized variants.
4. Extract only clearly shared local utilities such as atomic writes after
   proving equivalent permissions/error behavior. Do not perform a broad Rust
   module reshuffle.
5. Ensure all state writers either reuse the documented atomic pattern or are
   explicitly append-only with crash-safe line semantics.

Do not:
- expose arbitrary paths, shell commands, or generic file operations over IPC;
- change the packaged-runtime resolution or weaken fail-closed behavior;
- replace local files with a database or remote API;
- use the registry as a reason to merge unrelated domain ownership.

Required tests:
- malformed input cannot select a different file or command;
- all registered Tauri handlers are still in manifest/capabilities;
- every durable artifact in the registry has a test, schema validator, or a
  documented reason it cannot;
- normal app/browser/Python suites and cargo check remain green.

At handoff report which generic commands remain, why, and a bounded follow-up
plan for each. Do not claim completion while an untyped escape hatch is still
the normal route for new product work.
```

---

# Prompt 5 — Workspace boundary, connector repair, and retirement pass

```text
You are implementing Prompt 5 of docs/handoff/foundation-hardening-program-2026-10-23.md.
Do not start until work state is the live source for Today/Week and the
durable-state registry exists.

Mission: make Workspace a safe, reversible presentation preference; repair
registry bypasses; then remove confirmed dead architecture. This is not a UI
redesign and not permission to delete intentional guardrails or vendor code.

Workspace rules:
- The accepted workspace spec controls layout, density, home surface, and
  notification preferences only.
- It reads typed product view models. It does not own Canvas facts, plan state,
  freshness state, or study state.
- Its existing native validation remains. Any duplicate validation across
  browser/TypeScript/Rust must have an authored source, generated artifact, or
  parity test. Do not casually remove native validation.
- Split app/src-tauri/src/workspace.rs only along demonstrated ownership
  boundaries (for example spec storage vs usage/amendments vs tool-gap
  reconciliation). Preserve histories and accepted specs exactly.

Connector rules:
- Inspect root CampusGroups wrapper scripts and the static registry.
- Enforce the promised `SCHOOL_SLUG=cu-boulder` gate before any plugin command
  can run, or move those commands behind a registry-owned dispatcher.
- Preserve the existing explicit student-operated RSVP preview/confirm
  exception. Do not turn it into an MCP execute path, background automation,
  or a cross-school feature.
- Add tests for an incorrect/missing school slug and for valid CU Boulder use.

Dead-code rules:
1. Produce a candidate list: unreferenced files/exports, duplicate helpers,
   obsolete wrappers, and historical documentation that claims to be current.
2. For each candidate, prove no runtime import, package script, router entry,
   generated-artifact relationship, or supported compatibility consumer.
3. Delete only confirmed unused code; delete tests only when their subject is
   deleted. Never delete preview-only stubs, security checks, vendor boundaries,
   raw Canvas retention, or intentional legacy readers before migration is
   complete.
4. `app/src/dev/frameRate.ts` is a candidate, not pre-approved deletion;
   confirm import/build behavior first.

Documentation rules:
- Keep docs/architecture.md concise and current.
- Keep the work-state contract and durable-state registry current.
- Mark historical build prompts/handoffs as historical rather than editing
  history to sound current. Do not mass-delete research or decision records.

Required verification:
- Full quality gate from the program document.
- Workspace catalog/parity tests, app startup/onboarding tests, connector
  registry tests, and targeted packaged/native checks.
- Before/after inventory of deleted paths and an explanation for every retained
  duplicate that crosses a trust boundary.

At handoff provide a final migration table: old path, status (authoritative /
projection / compatibility / deleted), remaining readers, and the exact date or
condition for removing every compatibility output.
```

## Rollout and release decision

Do not treat a green unit suite as proof of a safe product migration. Before a
release after Prompt 2 or later, run these manual local checks on a disposable
profile and an existing non-sensitive profile copy:

1. First run without Canvas: the app opens, explains its state, and does not
   create false work.
2. Normal SSO sync: Today, Week, and brief links point at the same work item.
3. A changed due date: one change appears, accepted plan order is preserved,
   and no duplicate row appears.
4. Partial/failed sync: previous known work and student choices stay visible
   with an honest health indication.
5. A workspace acceptance/amendment/revert: layout changes but academic facts
   do not.
6. A fresh app launch and an older profile upgrade: no migration loop, no
   reset of onboarding, and no irreversible file conversion.
7. A non-CU school attempts a CampusGroups CLI: it refuses before browser or
   account interaction.

Promote only when all automated gates and these checks pass. If a rollback is
needed, switch readers back to legacy projections; do not delete the new
generation directory until the failure is understood. The projection is
additive by design so rollback is a routing decision, not a data-loss event.
