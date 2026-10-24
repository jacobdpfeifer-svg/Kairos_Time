# Foundation hardening status

Resume pointer for [`docs/handoff/foundation-hardening-program-2026-10-23.md`](../../handoff/foundation-hardening-program-2026-10-23.md).

## Prompt 0 — contract

Accepted 2026-10-23.

- Contract: [`docs/architecture/student-work-state-contract.md`](../../architecture/student-work-state-contract.md).
- Fixture plan: [`tests/fixtures/work-state/README.md`](../../../tests/fixtures/work-state/README.md).
- Open decisions stay in the contract. Migration is additive.

## Prompt 1 — shadow projection

Accepted 2026-10-23.

- Writer: `browser/scripts/lib/work-state.mjs`. CLI: `browser/scripts/rebuild-work-state.mjs`.
- Hooks: freshness `rebuildDashboard` (sync and ticks) and `week_plan.handle` after a mutation. A failed rebuild leaves the previous pointer.
- Measurements: one `wellStructured` course, 4 items, `state.json` 3,491 bytes, rebuild 22 ms. Scale reducer: 200 courses, 10,000 items, 388 ms, in-memory JSON 4,802,032 bytes. No latency budget was invented from these numbers.
- Gates that passed then: browser `npm test` (450), ruff, mypy, pytest (1013 passed, 37 skipped, 1 xfailed).

## Prompt 2 — Today and Week

Accepted 2026-10-23.

- Native command `read_work_state` validates schema version and pointer confinement. It returns no filesystem path.
- Fallback: `reason: missing` is a first run and shows the legacy semester and plan with no extra sentence. `malformed`, `unconfined`, and `schema` keep that legacy view and say the work list could not be read. `fell_back` serves the previous generation. `coverage.canvas: partial` keeps rows and says the sync is partial.
- Today and Week overlay title, due instant, submission completion, and a single moved-date row. Week-plan order and brief ranking stay where they were.
- Tests: `app/src/workState/snapshot.test.tsx`, Today and Week rendering tests, `work_state` unit tests. `cargo check --locked` and `cargo test --locked work_state` via `scripts/native-mirror.sh`. App `npm test` (243) and `npm run build`.
- Remaining direct legacy readers: semester ticks, freshness dashboard, grade truth, skills on `week.md`, Study, Advisor course stems, workspace.

## Prompt 3 — consumers

Accepted 2026-10-23.

- Briefs gain optional `work_item_id` when a work-state row matches the study-source item. `rankIslands` is unchanged. Briefs do not write work state.
- Study `attempt_started` may carry `work_item_id`. Historical events do not grow the field.
- Advisor exposes `work_course_ids`. A missing degree audit still has `audit.present: false` and `complete_count: 0`.
- No duplicate derivation was deleted. Study-sources, the freshness dashboard, and semester ticks still have production readers.

## Prompt 4 — registry and IPC

Accepted 2026-10-23.

- Registry: [`docs/architecture/durable-state-registry.md`](../../architecture/durable-state-registry.md).
- `read_work_state` is the typed read. `study` and `week_plan` remain `{ cmd, params }` because removing them would break the packaged command path. Unknown week-plan commands already fail in `PlanError`. Follow-up is one typed command at a time, starting with `week_plan` `show`, then `study` `start`.
- Atomic writes for work state reuse `writeJsonAtomic` from `canvas-store.mjs`. No new shared crate.

## Prompt 5 — workspace, gate, retirement

Accepted 2026-10-23.

- Workspace spec is still layout, density, home surface, and notification preference. `workspace.rs` was not split: spec storage, usage, and tool-gap reconciliation are already separate functions, and a file split would only move them.
- CampusGroups root CLIs call `campusGroupsAllowed` and exit 2 before spawn unless `SCHOOL_SLUG=cu-boulder`. RSVP preview and `--confirm` stay inside the plugin.
- `app/src/dev/frameRate.ts` has no production import. It stays, because MASTER §15.7 names it as the frame-rate measurement tool.

### Migration table

| Path | Status | Remaining readers | Remove when |
|---|---|---|---|
| `inbox/canvas/raw`, `projections/current.json` | authoritative | sync, freshness, semester | not a compatibility output |
| `inbox/freshness/events.jsonl` | authoritative | dashboard, work state, briefs | not a compatibility output |
| `inbox/plan/week.json`, `items.jsonl` | authoritative | Week, briefs, work state | not a compatibility output |
| `study/events.jsonl`, `projection.json` | authoritative | Study, work-state summary | not a compatibility output |
| `inbox/work-state/v1` | projection | Today, Week, briefs, Advisor | keep while those readers exist |
| `inbox/week.md`, course Markdown, `grades.yaml`, study-sources | compatibility | skills, semester, briefs | after those readers use work state and a parity test replaces each file |
| `inbox/briefs/v1` | projection | Mission Control | keep; it is not a second academic store |
| `workspace/workspace.json` | preference | Workspace | keep |
| `inbox/degree-audit.md` | authoritative import | Advisor | keep; requirement claims need it |
| `app/src/dev/frameRate.ts` | retained dev tool | none in the bundle; MASTER §15.7 | after a measurement replaces it |

## Later verification, same day

- `uv run mypy src/` clean (73 files). App `npm run build` clean.
- Static preview of the production bundle, with no Tauri profile: Today says Canvas has not been read and that this is not an empty week. Week selects and stays on "Loading your week…" because the plan command has no desktop host. Neither screen invents work items. Partial and malformed overlays stay covered by the Today and Week rendering tests.
- `app/src/dev/frameRate.ts` is still on disk.

## Implementation audit — 2026-10-23

Audit fixes after the six prompts were implemented:

- `rebuildDashboard` now promotes work state before rebuilding briefs. Briefs
  therefore receive their optional `work_item_id` on the same sync/freshness
  cycle rather than one cycle later.
- Week-plan's best-effort projection rebuild now accepts the resource-owned
  `KAIROS_NODE` and `KAIROS_BROWSER_SCRIPTS` passed by the desktop runtime.
  The old checkout-relative path failed silently in packaged builds after a
  plan mutation. A unit test verifies the packaged command shape.
- Planner `due_changed`/`assignment_added` events now join by their stable
  `course:type:object` key. The reducer deliberately still refuses ambiguous
  activity-stream title matching. Change joins are indexed by Canvas identity
  and URL instead of scanning every work item for every event.
- CampusGroups command shims now resolve the saved onboarding school profile
  with the same resolver as Canvas sync. An explicit `SCHOOL_SLUG` still wins;
  missing/non-CU profiles refuse before a browser/account call.
- The student-work contract status now reflects the implemented additive
  migration rather than incorrectly saying "planned".
- Study's `work_item_id` persistence is a safe seam, but no current Study or
  Mission Control action supplies that id yet. Work-state therefore remains
  `unlinked` in normal use; a later explicit UI/context mapping must wire it
  before readiness is presented as integrated.

Audit verification: targeted week-plan Python suite (10), work-state/briefs/
freshness browser suites (56), targeted Today/Week/work-state app suites (23),
app build, `cargo check --locked`, and `cargo test --locked work_state` passed.
The full Python/browser/app release gate and manual live/disposable-profile
checks remain required before release promotion.

## Unrun live checks

SSO sync, relay, Gmail, Google Calendar, and the disposable-profile walk in the program. A green unit suite is not a release.

## Second implementation audit — 2026-10-23

A fresh adversarial audit of the working tree found three release blockers, five
serious defects, and eleven smaller ones. All are fixed below. Each fix was
mutation-tested: the defect was reintroduced and the named test had to fail.

### Release blockers

- **The Tauri permission manifest was inconsistent and would break a clean
  checkout.** `capabilities/default.json` claimed `allow-read-work-state` with
  no generated permission file, while `complete_onboarding` and
  `read_onboarding_state` had untracked permission files and no `build.rs`
  entry. `cargo check` passed only because the native build runs from a mirror
  outside this checkout, where generation happened out of band. `build.rs` now
  declares all three, the files are committed, and
  `browser/tests/tauri-manifest.test.mjs` holds the manifest, the capability
  allow-list, the generated files, and `generate_handler!` to one list with no
  Rust toolchain needed.
- **One plan decision during a partial sync took every Mission Control island
  down.** Work state keeps an unmatched decision as a `plan:` orphan;
  `workItemIdFor` returned that id, `WORK_ITEM_RE` rejected it, `validateBrief`
  threw, and `project.mjs` turned the throw into `error.json` for the whole
  projection. Brief links are now indexed once per rebuild and only ever name a
  canonical `canvas:` item, and the optional field is schema-checked at the
  producer so it can never be the thing that fails a brief.
- **The overlay rewrote completion and due dates with a different rule than the
  screen it was overlaying.** Three completion predicates disagreed. The
  canonical reconciler is now the single authority:
  `browser/scripts/lib/work-completion.mjs` follows `bucketWorkItem`'s own order,
  so `late` stays overdue even with a grade and a bare score counts as done,
  which is the unposted teacher-entered grade that used to reappear as
  outstanding work. Work state carries the answer as `canvas.completed`; no
  reader re-derives it from the lossy `submission_state`.

### Serious

- A plan mutation blocked on a Node rebuild: measured 245 ms on an empty root,
  388 ms on the scale fixture, against MASTER section 15's 300 ms ceiling. The
  rebuild is now detached, stderr is inherited so a repeated failure is visible,
  and the same mutations measure 1.8-2.5 ms. The data was already committed
  first; the freshness tick rebuilds again, so a dropped rebuild self-heals.
- Moved-date rows deduplicated on URL against changes of any kind, so a change
  with no URL produced two rows and an unrelated `points_changed` on the same
  URL hid the move. Work state now carries the freshness `source_key` that
  identifies the move, and URL matching is restricted to due-date kinds.
- `read_semester` windows and sorts on the semester surface's own `due_at`,
  which was the raw date while work state used the override-aware one, so an
  extension could not bring a row into the week and rows rendered out of order.
  The semester surface now carries the same student-effective date, and the
  overlay re-windows and re-sorts after applying it.
- The parity test had no legacy path: it compared `parityRow` against a
  hardcoded literal and asserted the overlay *won* against a disagreeing
  fixture, codifying the divergence. Replaced by
  `browser/tests/work-completion.test.mjs`, which computes five derivation paths
  from one corpus of six real Canvas shapes, and
  `app/src/workState/completion.parity.test.ts`, which holds the app's fallback
  list to the authored module across runtimes.
- The fixture corpus did not exist; `tests/fixtures/work-state/` held only a
  README. Ten named cases now build from
  `browser/tests/fixtures/work-state/cases.mjs` and are frozen as golden
  projections compared by `browser/tests/work-state-corpus.test.mjs`.

### Smaller

- Onboarding phase was not monotonic: `mark_canvas` dragged a profile that
  reached the workspace step back to the Canvas step on any re-sync or school
  re-pick. Phases now only advance.
- `completeOnboarding()` had no rejection path, so a failed write trapped the
  student in first run forever.
- `sync_study_sources` reported a successful Canvas sync as failed when the
  first-run checkpoint write failed. Bookkeeping no longer fails the real action.
- `_rebuild_work_state` discarded exit code and output; `rebuildDashboard` could
  not see `rebuildWorkState`'s `ok:false` return. Both now surface a refusal.
- Nothing stopped an older overlapping rebuild from promoting over a newer
  generation, and the lock holder's `finally` could delete a lock another process
  had taken over as stale. Promotion now refuses an older `finished_at` and the
  lock is released only against its own token.
- A later `points_changed` buried a `due_moved`, the only change a surface
  renders. A due move now outranks other kinds regardless of age.
- An ambiguous plan join wrote one student decision onto every candidate. It now
  lands on the lowest id and the key is reported in `health.ambiguous_plan_ids`.
- The Python core suite spawned Node and wrote into test roots. An autouse
  fixture keeps it runtime-free; one test still asserts the spawn shape.
- `completed_at` was Unix seconds as a string. It is RFC 3339 like every other
  durable timestamp, with its own date-math tests.
- `freshness_event_cursor` is documented as the line count it is, valid only
  while the event log stays append-only.
- `workItemIdFor` did two linear scans per brief candidate; it is indexed once.
- `planKey` collisions silently took the first row; a contested key is now left
  un-overlaid rather than matched to the wrong course.
- A pointer whose generations directory is absent reported `unconfined`; a
  half-built profile now reports `malformed`.
- `profile/setup.json` was durable state missing from the registry. Added.

### Verification

Browser `npm test` (475), app `npm test` (255) and `npm run build`, Python
`pytest` (1016 passed, 37 skipped, 1 xfailed), `ruff`, `mypy` (73 files), and
`cargo test --locked` (68) through `scripts/native-mirror.sh`. The committed
permission files are byte-identical to what `tauri-build` generates in the
mirror. Seven mutation tests confirmed each fix is actually guarded, and an
eight-check stress run covered scale (10,000 items, 421 ms), monotonic
promotion, eight concurrent rebuild processes, a torn generation, truncated
JSONL inputs, four escaping pointers, an old-profile upgrade, and briefs
surviving a partial sync with an orphaned plan decision.

One behaviour change needs an owner decision, recorded rather than buried: a
*submitted but late* item is now uniformly "not done" everywhere, following the
canonical overdue bucket. Today and Week previously showed it as done while
`week.md` showed it as open. Live checks in the program remain unrun.
