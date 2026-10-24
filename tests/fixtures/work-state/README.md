# Work-state fixture plan

The cases below are built by [`browser/tests/fixtures/work-state/cases.mjs`](../../../browser/tests/fixtures/work-state/cases.mjs) and frozen as the `*.json` files beside this README: one normalized projection per case, with generation ids and timestamps replaced so only the facts remain. [`browser/tests/work-state-corpus.test.mjs`](../../../browser/tests/work-state-corpus.test.mjs) rebuilds every case and compares it, so a reducer change that moves a student-visible fact has to arrive as a reviewable diff.

Regenerate deliberately, and read the diff before keeping it:

```bash
cd browser && UPDATE_WORK_STATE_FIXTURES=1 node --test tests/work-state-corpus.test.mjs
```

Behavioural assertions that are not a whole-projection comparison stay in `browser/tests/work-state.test.mjs`. Completion and due-date agreement across the semester surface, `week.md`, the canonical item, and work state is a separate gate: [`browser/tests/work-completion.test.mjs`](../../../browser/tests/work-completion.test.mjs). No new committed Canvas dump.

| Case | Reuse | Gap filled by the projection test |
|---|---|---|
| Empty account | `fixtureGeneration` with no courses; synthetic `blake-okonkwo` is an inbox persona, not a Canvas generation | Assert `coverage.canvas` is `missing` when no projection pointer exists, and an empty generation is not described as "no work" |
| Normal account | `browser/scripts/lib/canvas-reliability-fixtures.mjs` `wellStructured` via `fixtureGeneration`; promoted with `promoteProjections` | One work item per reconciled Canvas id |
| Partial sync | `partialOutage` / `fragmented`; health states from `browser/tests/canvas-reliability.test.mjs` | `coverage.canvas` is `partial`; student fields from a pre-seeded `week.json` remain |
| Due date moved | Event shape in `browser/scripts/lib/canvas-changes.mjs` (`kind: due_changed`, key `snap-due:{course}:{assignment}:{due}`) | One `change.kind` of `due_moved` on the matching item. No second row |
| Completed work | `wellStructured` submission states; `browser/tests/fixtures/briefs/records.mjs` `mathRecord` is brief copy, not a Canvas source | `submission_state` copied. No inferred `done` on Canvas rows |
| Capture | `tests/core/test_week_plan.py` row shape (`cap-{id}`, title, day) | `capture:` id, kept when Canvas is missing |
| Deferred / accepted plan | `week_plan.py` `defer` / `accept` shapes, exercised in `tests/core/test_week_plan.py` and `app/src/week/plan.test.ts` | Orphan plan id retained; `item-a{id}` joins the assignment; order is id-ascending within the day |
| Historical profile | A temp root with `inbox/week.md` and no `inbox/work-state/` | Read reports `missing`. Rebuild creates v1 without renaming `week.md` |
| Scale | Generated in the test (200 courses, 50 assignments each) | Record wall time and `state.json` bytes. No committed 10,000-row file. Last measured: 10,000 items in 421 ms, 4.96 MB in memory |
| Study summary | `study/projection.json` when present | Readiness `unlinked` until an item names a work-item id |

Network, SSO, relay, and Gmail/GCal credentials are not inputs to these cases.
