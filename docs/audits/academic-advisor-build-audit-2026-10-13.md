# Academic Advisor build audit — 2026-10-13

## Verdict

**Phase 1 Advisor slice: buildable and bounded; ready for the next planning
iteration.** The new surface compiles, its focused UI and parser tests pass,
and the implementation does not add a SIS scraper, registration path, or
Canvas-visible write.

The full React suite is not green because the working tree already contains
unrelated Home/Study changes whose existing tests expect a different tab and
accessibility contract. Those failures are recorded below and are not
silently attributed to Advisor.

## Scope audited

- First-class `Advisor` app destination.
- Read-only native `read_advisor_snapshot` command.
- Snapshot, Path, Decision, and Meeting modes.
- Dated/stale audit labeling and official-school-URL handling.
- Browser fixture data for visual/test development.
- Source labels for Canvas, student profile, and audit imports.
- No changes to Canvas, SIS, registration, add/drop, or messaging actuators.

## Implementation reviewed

| Area | Location | Result |
| --- | --- | --- |
| Native snapshot | `app/src-tauri/src/advisor.rs` | Reads only `USER.md`, school profile, course filenames, audit import, and Canvas sync health |
| Tauri bridge | `app/src-tauri/src/commands.rs`, `main.rs`, `build.rs`, `capabilities/default.json` | Command is registered and permissioned |
| App surface | `app/src/views/AdvisorView.tsx` | Four modes with explicit source/status labels |
| App navigation | `app/src/App.tsx` | Advisor tab added without changing actuator behavior |
| Fixture path | `app/src/dev/fixtures.ts` | Tier-2 dated-audit scenario available under `?fixture=1` |
| Focused tests | `app/src/views/AdvisorView.test.tsx` | Snapshot render and Decision → Meeting flow |
| Parser tests | `advisor::tests` | Dated audit and stale audit cases |

## Trust and safety findings

### Passes

- No live DegreeWorks/Buff Portal scraping was introduced.
- Requirement claims remain framed as imported/stale evidence, not live truth.
- Missing audit data enters `planning` mode rather than inventing requirements.
- Staleness uses the system clock and has a regression test.
- The official-system action uses the student's discovered `canvas_base_url`;
  it does not fall back to a generic or misleading Canvas URL.
- All new interactions are read-only or local UI state.
- The meeting view is labeled `Draft · not sent`.
- No student data is transmitted to a third party by the Advisor surface.

### Follow-up risks

1. **P1: two audit parsers.** The native projection now mirrors the
   `degree_audit.py` grammar (see second pass), but it is still a second
   copy. Before multi-term planning, the projection should consume a shared
   structured contract rather than re-parse audit text in Rust.
2. **P2 — official URL is the school Canvas base, not a deep audit URL.** The
   next iteration should add a reviewed per-school `degree_audit` policy link
   and make the button say exactly where it goes.
3. **P2 — no persisted plan/questions projection yet.** Path assumptions and
   meeting questions are currently presentation data; Phase 2 should add the
   local rebuildable `inbox/advisor/` projection described in the product plan.

## Validation

### Passing checks

```text
npm run build                                  PASS
npm test -- src/views/AdvisorView.test.tsx     PASS — 2 tests
cargo check                                    PASS — existing dead-code warnings only
cargo test advisor::tests -- --nocapture       PASS — 2 tests
git diff --check                               PASS
```

### Full-suite baseline issue

```text
npm test                                       FAIL — existing suite: 10 HomeView failures
```

The failures are in `HomeView.test.tsx` and `App.test.tsx`. They expect the
older Study/Home accessibility surface (`Study` tab, `Ask` button, option
roles), while the working tree already contains modified Home/App behavior.
The Advisor-focused suite passes independently. This is a release blocker for
the overall app, but not an Advisor-specific failure.

## Product audit

- The Advisor destination is discoverable and separated from the daily Home
  surface.
- The default Snapshot makes known data, imported audit age, current courses,
  and the next decision visible without presenting a chat transcript.
- Path and Decision modes correctly use provisional language; they do not
  claim a full automatic four-year schedule yet.
- Meeting mode produces useful questions and clearly distinguishes a draft from
  an action.
- Mobile layout collapses the two-column grid and preserves the source/status
  labels.
- A live visual browser walkthrough was not completed in this audit because
  the available computer-use browser surface was unavailable; automated DOM
  coverage and production build verification passed.

## Second pass — fixes applied (2026-10-13)

A second audit found the first slice could show false or misleading facts to a
real student. Each finding below was reproduced, then fixed and covered by a test.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| A1 | P0 | `USER.md` template placeholders were returned as answers. The live dev profile would show "(fill during onboarding)" as the program and "(e.g. Spring 2028)" as the target. | `advisor.rs` drops `(…)` / `YYYY-MM-DD` placeholders; test `untouched_templates_are_not_answers`. |
| A2 | P0 | An unfilled `degree-audit.md` template read as **42 remaining credits** (the `e.g. Remaining credits: 42` hint). The same bug was in `degree_audit.py`, which is the authority for the agent path. | Both parsers drop parenthesised `e.g.` hints; a template with no real blocks or total is `planning` mode, not an import. Its example `catalog_year` is ignored. Python test `test_template_example_is_not_a_remaining_total`. |
| A3 | P1 | The Rust section splitter only knew the exact `## Complete / ## In-progress / ## Unmet` headings. Real pastes ("Still needed:", "In progress", "Completed") counted as zero, and the "Remaining credits" line counted as an open requirement. | The heading and credit-phrase grammar now matches `degree_audit.py`. Only top-level bullets count, and credit-total lines are excluded. |
| A4 | P1 | A future-dated or malformed `imported_on` counted as a fresh audit (age clamped to 0). | Future or invalid dates mean undated, which is always shown as not current. `m/d/Y` and `Y/m/d` are accepted like the Python parser. |
| A5 | P1 | Planning mode (no audit) showed "Keep the path moving … no unmet blocks are visible", which reads as on-track. | The focus block is state-specific: add audit, add date, refresh stale copy, plan for the first open block, or confirm in the live audit. |
| A6 | P1 | "Open school Canvas" used `window.open`, which doesn't open an external browser in the Tauri webview, and Canvas isn't where the audit lives. | Button removed. The official audit deep link stays P2 (per-school policy link). The profile URL is now https-only. |
| A7 | P1 | The Path view's three equal cards, faux progress bars, and meeting questions were static copy. | Paths shows real pacing: remaining credits ÷ fall/spring terms to target, plus an extra-year option. Loads above 18 credits a term are flagged, not shown as achievable. Meeting questions come from the student's open blocks, audit age, missing program/catalog/target, and credits left. Added a "Copy questions" draft action that never sends. |
| A8 | P2 | MASTER §02/§13 violations: coloured left-border card, 3-up equal card grid, nested cards, decorative progress tracks, middle-dot chains, two highlighted surfaces, an eyebrow label. | Rebuilt on Notebook: one `--hl-soft` focus block, hairline rows with source text on the right, a segmented mode control, one primary button per view. |
| A9 | P2 | Tabs had no tabpanel, `aria-controls`, or arrow-key support. The inbox listener could leak if the view unmounted before `listen` resolved. | Proper tablist/tabpanel with roving tabindex and arrow keys. Listener cleanup awaits the unlisten promise. A load failure shows a plain error. |
| A10 | P3 | `inbox/courses/_raw` and dot-files could show as courses; codes rendered as "APPM1235". | Filtered; codes shown as "APPM 1235". |

Contract additions (`ipc.ts` `AdvisorSnapshot`): `audit.dated`,
`audit.stale_days`, `audit.unmet_items`, `audit.in_progress_items`. Also a
shared `EMPTY_ADVISOR`.

Validation after the fixes:

```text
cargo test (native mirror)                      PASS: 28 tests, 6 advisor
npx vitest run                                  PASS: 89 tests, 17 files (Advisor: 9)
npx tsc --noEmit                                PASS
pytest tests/ (excluding ai_eval)               PASS: 867 passed, 19 skipped
```

The full React suite is now green, so the HomeView/App baseline failure
recorded above no longer reproduces. A visual walkthrough in the packaged app
is still pending.

## Next build step

Implement the structured `inbox/advisor/` projection and replace the native
Markdown re-parser with a shared audit snapshot contract. Then add the real
course-decision cards and multi-term allocator only after prerequisite,
offering-term, and catalog-year provenance are available.
