# Student work state v1

Status: **implemented migration boundary** (2026-10-23). The projection is
additive: Today and Week read it with their legacy views as a tested fallback.
The Canvas raw generation, freshness event log, week-plan files, and study log
remain the authoritative owners named below.

Program: [`../handoff/foundation-hardening-program-2026-10-23.md`](../handoff/foundation-hardening-program-2026-10-23.md).

## Current producers

| Producer | Durable artifact | Readers today |
|---|---|---|
| Canonical sync (`browser/scripts/sync-canvas-canonical.mjs`, `canvas-store.mjs`, `canvas-project.mjs`) | `{user_root}/inbox/canvas/raw/generations/<sync_id>/`, `raw/current.json`, `projections/<sync_id>/` (`work-surface.json`, `sync-health.json`), `projections/current.json` | Freshness, briefs, Rust `canvas.rs`, adapters |
| Adapters (`canvas-adapters.mjs`) | `inbox/week.md`, `inbox/grades.yaml`, `inbox/study-sources/` | Skills, brief assembler, app semester/course views |
| Freshness (`freshness-store.mjs`, `freshness-run.mjs`) | `inbox/freshness/events.jsonl` (append-only), `state.json`, `dashboard.json`, `skip-costs.json` | Extension, Today, Week, notifications, briefs |
| Week plan (`src/canvas_mcp/core/week_plan.py`) | `inbox/plan/week.json` (estimates, deferrals, accepted days, hours), `inbox/plan/items.jsonl` (captures), `calibration/piles.json` | `week_plan` IPC, Today, Week, briefs (read) |
| Study (`canvas_mcp.core.study`) | `study/events.jsonl`, `study/projection.json`, `study/packets/` | Study IPC, Study views |
| Brief assembler (`browser/scripts/lib/briefs/`) | `inbox/briefs/v1/*.json`, `index.json` | Mission Control. Does not write Canvas or plan |
| Workspace (`app/src-tauri/src/workspace.rs`) | `workspace/workspace.json`, `history/`, `usage.json` | Workspace UI |
| Advisor (`advisor.rs`, `degree_audit.py`) | Reads `inbox/degree-audit.md` (student paste). Does not author it | Advisor views |

`calibration/piles.json` is the file on disk. Older docs that say `piles.yaml` are stale.

## Target ownership

| Artifact | Kind | Owner | Recovery |
|---|---|---|---|
| `inbox/canvas/raw/**`, `projections/current.json` | source | canonical sync | Last confined pointer. A failed projection writes `FAILED.json` and leaves the pointer |
| `inbox/freshness/events.jsonl` | source | freshness tick | Append-only. Rebuild `dashboard.json` from the log |
| `inbox/plan/week.json`, `items.jsonl` | source | `week_plan.py` | Student decisions. A Canvas sync must not rewrite them |
| `study/events.jsonl`, `projection.json` | source | study core | Replay the log to rebuild the projection |
| `inbox/work-state/v1/` | projection | work-state reducer (shadow until cutover) | Last confined generation. See promotion below |
| `inbox/week.md`, course Markdown, `grades.yaml`, study-source JSON | compatibility | canvas adapters | Regenerated from the current Canvas projection. Not peer authorities |
| `inbox/briefs/v1/` | projection | brief assembler | Rebuild from inputs. Never a work-state writer |
| `workspace/workspace.json` | preference | workspace | History directory. Layout only |
| `inbox/degree-audit.md` | source (imported) | the student | Requirement claims exist only when this dated paste exists |
| `calibration/app-prefs.json`, `piles.json` | preference | prefs / week plan | Missing file means defaults, not an empty academic record |

During migration, compatibility files stay derived outputs. Work-state `student` fields are a copy of week-plan decisions, not a second plan store. Work-state `change` fields annotate freshness events. Work-state `study` is a summary, not the study log.

## Record contract

Layout (same staged-generation and confined-pointer rules as `canvas-store.mjs`; not nested inside Canvas generations):

```text
{user_root}/inbox/work-state/v1/
  current.json
  generations/<generation-id>/{state.json,health.json}
```

`current.json` holds `schema_version`, `generation_id`, `content_hash`, a user-root-relative `path`, `previous_generation_id`, and `finished_at`. The path must resolve inside `inbox/work-state/v1/generations`. A promoted generation is never edited in place.

### Identity

- Canvas work item: `canvas:{tenant_id}:{course_id}:{object_type}:{canvas_id}`, derived from `identityKey` in `canvas-model.mjs` (`tenant|course|type|canvas_id`). Never from a title, list index, or UI sort.
- Course: `canvas:course:{tenant_id}:{course_id}`.
- Capture: `capture:{cap-id}` from `items.jsonl`.
- Plan row that matches no Canvas item and is not a capture: `plan:{week-plan id}`, retained as an orphan. Not dropped.

Week-plan keys join onto those ids. `item-a{canvas_id}` joins an assignment. `item-q{canvas_id}` joins a quiz. A key that is already a work-state id or a pipe-form identity key joins directly. Joining by title is forbidden. When one plan key joins several work items, the decision lands on the lowest id only and the key is listed in `health.ambiguous_plan_ids`: copying one student decision onto several rows would invent work the student never planned. `week.json` is saved with sorted keys, so it does not store a separate intra-day sequence. Within one `planned_day`, `student.order` is ascending id. That is a compatibility observation, not a new ordering feature.

### state.json

Required: `schema_version` (1), `generated_at`, `source` (`canvas_sync_id`, `freshness_event_cursor`, `plan_revision`), `coverage` (`canvas`, `freshness`, `plan`, `study`), `courses`, `work_items`.

Each work item: `id`, `course_id`, `kind`, `title`, `due_at`, `canvas`, `provenance`, `change`, `student`, `study`.

- `canvas`: `{ url, submission_state, completed }` or null for captures and orphans. `submission_state` is copied verbatim and never reinterpreted by a reader. `completed` is the one authored answer to "is the student done with this", from `browser/scripts/lib/work-completion.mjs`, which follows `bucketWorkItem`'s own order: `late` is overdue even when a grade exists, `submitted` / `pending_review` / `graded` are finished, and a bare score counts as finished so an unposted teacher-entered grade is not shown as outstanding work. It is carried as a field because `submission_state` is a single lossy string: no reader can re-derive this correctly, and three readers that tried each got a different answer. `browser/tests/work-completion.test.mjs` is the parity gate across the semester surface, `week.md`, the canonical item, and work state.
- `provenance`: `{ sync_id, source_ids }`. `source_ids` point at the canonical item id or plan id. Bodies are not copied.
- `change`: null, or `{ kind, seen_at, source_key }` plus `from` and `to` when the event is a due-date move. Freshness `due_changed` is stored as `due_moved`. At most one change object per item. A `due_moved` outranks every other kind regardless of age, because a surface renders only the moved-date row and a later `points_changed` would otherwise bury the move; within one kind the latest `detected_at`, then `key`, wins. `source_key` is the freshness key that produced the change, so a reader can recognise the same move it already holds instead of guessing from a URL.
- `student`: `{ status, estimate_minutes, planned_day, order, plan_id }`. `status` is `planned`, `deferred`, `done`, or null. Null means no student decision. `done` is only a capture row with `done_at`.
- `study`: `{ readiness, exam_id }`. `readiness` is `unavailable` (no readable projection), `unlinked` (projection exists but the item has no study reference), or a value copied from a study item that already names this work-item id. Missing sources are not upgraded to ready.

`coverage` values: `missing` (no file or no pointer), `unreadable` (present but invalid), `partial` (Canvas health `fresh_partial` / `stale_partial`, or failed endpoints), `ok`. An empty `work_items` array together with `coverage.canvas` of `missing` or `unreadable` means the input was absent. It does not mean the student has no work.

Optional and omitted when null: `canvas.submitted_at` is not stored. Points, HTML, descriptions, and instruction previews are not stored.

### Ordering

Total order, no locale sort:

1. `student.planned_day` ascending. Items with no planned day sort last.
2. School-local due day from `schoolDay(due_at, timezone)` ascending (`timezone` is the Canvas health timezone, or `UTC` when Canvas has not supplied one). Missing or unparseable due dates sort last. The stored `due_at` stays the Canvas instant.
3. The `due_at` instant, then `course_id`, then `id`.

Same inputs in a different source order produce the same bytes, aside from `generated_at` on the first write of a content hash. A second rebuild with the same hash does not mint a generation.

### Precedence

| Fact | Winner | Loser |
|---|---|---|
| Title, course label, due instant, URL, submission state | Current Canvas work surface | Freshness title, plan title, study title |
| What changed since last look | Newest matching freshness event | A second synthesized row |
| Estimate, planned day, deferral, capture, done on a capture | `week.json` / `items.jsonl` | Canvas sync, including a partial one |
| Practice evidence | Study projection, and only for an item the study record names | Work-state guesses |
| Requirement satisfied | Dated `inbox/degree-audit.md` | Course list, grades, work state |
| Layout | Accepted workspace spec | Academic fields |

When a deferral and an accepted day both exist for one plan id, the deferral wins and `planned_day` is the deferral day. `accept` in week plan already clears deferrals; both present means a hand-edited file.

### Prohibited fields

No HTML, description, instruction preview, packet body, answer, model prompt, model output, ranking score, executable string, or free-form renderer HTML. No field whose purpose is to be `eval`'d or rendered with `innerHTML`.

## Promotion, retention, corruption, migration

1. Build the records in memory. On any input error, still write health that names the bad input. Do not replace a good pointer with an empty success.
2. Take `v1/rebuild.lock` (exclusive create). If the lock is live, leave the pointer and return. A lock older than 30 seconds is stale and may be removed once. The lock holds a unique token and is released only when the file still contains that token, so a process whose lock was taken over as stale cannot delete the lock of the process that replaced it.
3. If `content_hash` matches the current pointer and that generation is still on disk, stop.
3b. If the current pointer's `finished_at` is newer than this build's, stop and leave it. Two overlapping rebuilds promote in completion order, not input order, so without this an older build could replace a newer projection.
4. Write `state.json` and `health.json` under a staging directory, then rename into `generations/<id>/`.
5. Write `current.json` last, with `previous_generation_id` set to the prior id. A throw before that write leaves the old pointer in place.
6. Keep the current generation, the previous generation, and at most one older directory (three total, same budget as `MAX_GENERATIONS`).

A reader that finds a confined pointer whose `state.json` fails schema checks loads `previous_generation_id` when that generation validates, and reports the fallback. If neither validates, the reader reports failure and leaves legacy readers to their existing files. It does not delete those files.

Migration is additive. Existing user-root artifacts keep their names. Rollback of a later UI cutover is a reader switch. Generation directories stay until the failure is understood. There is no in-place conversion of `week.json` or study events.

## Non-goals

- A database, cloud sync, new dependency, or a generic event framework.
- Replacing the Canvas raw log, the study log, or student-owned files.
- Moving brief ranking, degree-audit judgment, or workspace layout into this reducer.
- Deleting `week.md`, briefs, course Markdown, grades YAML, or study sources in this phase.
- Inferring completion, source coverage, a due date, or a degree requirement.
- Any Canvas submit, comment, discussion post, or credential handling change.

## Open decisions

These are recorded so later prompts do not invent a destructive policy.

1. Intra-day plan order is id-ascending because `week.json` does not store a sequence. An explicit sequence would be a week-plan schema change, not a silent sort.
2. Study items do not name a work item yet. Readiness stays `unavailable` or `unlinked` until a study record carries a work-item id. Historical events are not rewritten.
3. Retention of three generations matches Canvas. It is not a decision to delete raw Canvas history or plan files.
4. Manual release checks in the program (disposable profile, live SSO) stay owner-run. A green unit suite does not promote a release.

## Migrated readers

| Reader | What it takes from work state | What it still owns |
|---|---|---|
| Today and Week (`read_work_state`, `app/src/workState/snapshot.tsx`) | Title, due instant, `canvas.completed`, one moved-date row, coverage note | Week-plan order and brief ranking. A missing or malformed snapshot keeps the legacy semester and plan readers |
| Brief assembler | `work_item_id` on a brief when a work item matches the study-source row | Copy, ranking, and `inbox/briefs/v1/`. It does not write work state |
| Study | Optional `work_item_id` on a new `attempt_started`. Historical events omit it | Events, packets, evidence, checkers |
| Advisor | `work_course_ids` for shared identity | Requirement claims, only from a dated `inbox/degree-audit.md` |

The overlay never blanks a fact it does not have: a null `due_at` in work state leaves the row's existing date, because clearing it would drop the row out of the week. Because `read_semester` windows and sorts on the semester surface's own `due_at`, that file now carries the same student-effective date work state uses (`effectiveDateFromAssignment`), and the overlay re-windows and re-sorts after applying it. A plan key claimed by two work items is left un-overlaid rather than matched to the wrong course.

Exceptions still reading legacy artifacts directly: skills via `week.md` and course Markdown, semester ticks, freshness dashboard, grade truth, and workspace layout. Those compatibility outputs stay until each consumer is listed here.
