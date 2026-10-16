# Mission Control assignment briefs — architecture and build handoff

**Status:** proposed architecture and contract scaffold, 2026-10-15
**Decision owner:** product
**Build target:** the existing `Today` route; do not add a second dashboard or change the Canvas truth path.

## The product decision

Mission Control is a calm, local-first **pre-flight list**, not a dashboard.
It shows the student's next 4–6 meaningful pieces of work as a priority-ordered
stack of rounded raised assignment launchers (called **brief islands** in this
document). Selecting one opens that assignment's full prepared brief in the
main reading area. One island is expanded at a time.

This gives the student what the request asks for — their agent's work is
ready at the point of action — without turning Today into a wall of cards or
making several priorities visually equal. It preserves the design-system rule
that a screen has one highlighter and one primary next action.

The existing route remains `today` for deep links, keyboard commands, and
stored preferences. “Mission Control” is a product name, not a new navigation
tab. The existing Week, Courses, Study, Advisor, and Settings routes remain
their jobs.

```text
Canvas / files / student captures / plan / connector metadata
                         │
                         ▼
                local brief assembler
                         │
        source labels + confidence + expiry + safe action proposals
                         │
                         ▼
        Today / Mission Control: 4–6 brief islands
                         │ select
                         ▼
              full assignment-specific brief
              ├─ Study / source-backed practice
              ├─ Open Canvas (student operates Canvas)
              ├─ Calendar preview → explicit confirmation → write
              └─ Email draft → explicit send preview → confirmation → send
```

## What appears above the work list

Calendar and email are not two more assignments. They are two small
**operations islands** above the assignment stack, and only appear when there
is something concrete for the student to review.

| Island | When visible | Closed copy | On open | Color and action |
|---|---|---|---|---|
| Calendar | At least one fresh, undismissed scheduling proposal or a conflict relevant to today's work | “1 study block ready to review” | Shows the proposed time, rationale, conflict evidence, and the exact change | Neutral chrome; the proposed event inherits its course pip. “Review block” opens a preview, never writes immediately. |
| Email | A connector has a new relevant thread, or the student has created a draft intent | “Draft ready to review” / “Message may need you” | Shows the evidence used, recipient, subject, body, and send state | Neutral chrome. “Review draft” does not send. The send control exists only for a connected, write-capable connector. |
| Assignment brief | Open, meaningful work selected for today | Course pip, kind, title, due phrase, one reason it is here, readiness state | Full brief described below | Course color is a small identity marker, not a page-wide theme. The first island alone may receive `--hl`. |

No empty operations island, badge count, “AI is thinking,” auto-expiring alert,
or fake readiness indicator. A stale or unavailable connector says so plainly.

## Island behavior and priority

### Quantity and ordering

- Default: show four islands. Show up to six when the current day has more
  meaningful work. A “See the rest in Week” link preserves the long tail.
- Exclude completed work, assignments with no usable due information unless
  the student explicitly planned/captured them, and low-signal Canvas rows.
- An accepted Week plan is the student's ordering override. New or moved work
  may enter as “Changed,” but does not silently reshuffle an accepted plan.
- Otherwise rank at each successful Canvas/freshness update. Rank uses only
  explainable local signals: overdue/due proximity, assessment kind, available
  grade impact, remaining planned work, a material due-date/instruction change,
  and student-pinned work. The UI exposes one plain-language reason, never a
  mysterious score.
- Do not use inferred difficulty, engagement scores, model confidence, or
  personal email content as a covert priority signal.

The first island is pre-expanded only on a new visit. A student selection is
remembered for the current day and survives small refreshes. If its source
changes, mark it “Updated since this brief was prepared”; do not silently
replace text while they are reading it.

### Interaction and accessibility

These are **not tabs**. They are a single-expand accordion/list because each
item has an independent, long, task-shaped detail panel and there can be up to
six. Use native `button` elements within heading elements, `aria-expanded`,
and `aria-controls`; Enter/Space opens it, Tab enters the brief, and optional
Up/Down/Home/End movement only moves between island headers. This follows the
[WAI-ARIA accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/).

The rich brief opens inline at desktop width and as the existing focus-managed
sheet at compact widths. The sheet must return focus to its invoking island on
close, consistent with [MDN's dialog guidance](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/dialog_role).

## The full brief: common frame plus kind modules

A “full brief” is not a generic agent essay. Every section must earn its place
from the assignment, course sources, plan, or a clearly labeled general
recommendation. The brief header always says what is known, what source it came
from, and when it was prepared.

### Common frame

1. **Do this next.** One concrete, time-bounded start action and its primary
   CTA. This is the only highlighted action.
2. **What the assignment requires.** Canvas title, due time in local time,
   points/weight where available, instructor-visible requirements, submission
   type, and source locators. Unknowns remain “not found in Canvas,” never
   guessed.
3. **Pre-flight checklist.** Three to seven verifiable steps. Each is either
   `source-backed`, `student-setting`, or `agent-proposal`. It is a checklist
   of preparation, not a claim that work has been submitted.
4. **Why it matters now.** Assignment-level grade/consequence when evidence
   exists; then the nearest course/exam connection. This must distinguish
   source-backed course evidence from a general academic recommendation.
5. **Materials ready here.** Relevant Canvas pages/files, student library
   files, study-source locators, and selected calendar/email references. Every
   item has provenance and opens its source or local file.
6. **A safe next path.** Start study, open Canvas, build/edit a draft, ask a
   question, or propose a study block. No Canvas submission, comment, or
   discussion post is ever offered as an automated action.

### Required kind modules

| Assignment shape | Add to the common frame | Never claim |
|---|---|---|
| Exam / quiz | Assessed coverage, source coverage confidence, prerequisite map, day-by-day practice path, retrieval prompts, and “what still needs a source.” Link to Study for execution. | Access to live quiz questions or that a study guide is complete when coverage is partial. |
| Math homework / problem set | Topic and notation inventory, prerequisite concepts, one source-backed worked-example link if allowed, error checks, and how this feeds the next quiz/exam. | A solution to a current graded problem or a fabricated topic inferred only from a vague title. |
| Paper / writing task | Prompt constraints, deliverable/rubric evidence, research/source requirements, proposed thesis/outline clearly marked as editable, argument/evidence gaps, and revision checklist. | That a proposed outline is the instructor's expected argument, or that citations have been verified without doing so. |
| Project / coding / lab | Deliverables, milestones, environmental/tool constraints, dependency/risk list, test or verification plan, and a first reversible step. | Ability to operate LTI, proctored, external, or submission tooling for the student. |
| Reading / discussion | Reading scope, purpose in the course arc, active-reading prompts, claim/retrieval prompts, and a student-authored discussion drafting path. | A summary of unprovided reading content or an automatic discussion post. |
| Unknown / sparse | Minimal, honest assignment card: the visible requirements, questions to resolve, linked Canvas page, and a “prepare after you add sources” action. | A detailed brief because the system feels pressure to fill the page. |

Agent-authored text has four states: `ready` (all required inputs present),
`partial` (useful but gaps named), `needs_source`, and `stale`. “Agent
prepared” is not a fifth, opaque state.

## Data contract and freshness

The build should introduce a versioned local brief projection, not make the
React view assemble a model prompt or scrape Canvas.

- Inputs remain authoritative: Canvas sync projections, course/source files,
  local library, Week-plan state, freshness dashboard, connector records, and
  the student's saved brief preferences.
- Projection: `{user_root}/inbox/briefs/v1/{course_id}--{assignment_id}.json`.
  A small index at `{user_root}/inbox/briefs/v1/index.json` contains only
  island summaries and order hints. Both are regenerated atomically after
  relevant sync/input updates. They can be deleted and rebuilt.
- Every source-derived field includes a source locator, retrieved time, and
  input fingerprint. The brief includes `prepared_at`, `expires_at`,
  `source_fingerprint`, and `state`. Any source fingerprint mismatch makes it
  stale. A full brief never silently claims newer information than its sources.
- Deterministic assembly produces the common frame and the `needs_source`
  fallback. Optional AI enrichment receives only the selected assignment's
  minimum source excerpts and student-selected connector context; it returns a
  typed proposal validated against the same schema. It never writes the source
  truth, priority order, or an actuator preview.
- Cache only derived brief text locally. Do not append raw email bodies,
  unbounded Canvas HTML, voice audio, or AI prompts to a brief file.

The TypeScript boundary is scaffolded in
[`app/src/missionControl/contracts.ts`](../../app/src/missionControl/contracts.ts).

## Preferences and lightweight onboarding experiment

Briefing taste is not a learning style and must not enter `learning-profile.yaml`.
It is a separate, student-editable presentation preference at
`{user_root}/calibration/brief-preferences.json` (schema v1).

After the first Canvas sync has demonstrated value, ask **one optional
two-screen calibration**, never before sign-in:

1. “When you open a paper brief, what should be first?”
   `outline`, `requirements`, or `next_step`.
2. “When you open a problem-set brief, what helps first?”
   `concept_map`, `worked_example_link`, or `next_step`.

All users still receive requirements, source labels, and safety boundaries.
The answers only choose ordering and default expansion; they never hide
important source/uncertainty information. Settings lets the student change or
reset this anytime.

For beta learning, randomly offer one of two **equally complete** orderings
only to consenting testers: `next_step_first` vs `requirements_first`. Keep
assignment content identical. Store the assigned arm, choice, and three local
one-tap outcomes (`helpful`, `not_specific_enough`, `wrong_context`), then ask
for exportable, anonymized feedback. There is no cloud behavioral tracking,
no adaptive dark pattern, and no A/B test of confirmation friction.

## Calendar and email: exact approval semantics

### Calendar

1. A local planner/freshness rule proposes a single block and explains why.
2. The Calendar island opens a read-only preview: title, start/end, relevant
   existing events, course color, and what will change.
3. “Add to calendar” requests a scoped, single-use confirmation token bound to
   the exact event fields. The user explicitly confirms.
4. The connected provider writes, the ledger records success/failure, and the
   island updates. Changed fields invalidate the token.

The current local `calendar.jsonl` path and Google Calendar confirmation seam
are useful inputs, but the builder must use the existing `gcal-preview-event`
and `gcal-confirm-event` contract for an external write. Do not turn
`add_calendar_event` into a provider write.

### Email

Voice or text is an **intent capture**, never authorization to send:

```text
student voice/text → structured intent → selected evidence → editable draft
→ review draft → send preview (recipient/subject/body) → explicit confirm
→ provider send → ledger outcome
```

The reviewer must see recipient, subject, full body, attachments/links,
connector identity, and the evidence the draft relied upon before send. The
confirmation token is single-use, short-lived, and hashes all send-relevant
fields. Editing any field returns to preview.

Important current gap: the desktop connector currently reads Outlook mail only;
the guarded Gmail `send_email` path exists outside that UI. The email island's
first release may show **read context + draft review** for Outlook, but must
show a disabled, honest “Sending is not connected on this device” state until
a provider-specific draft/send bridge exists. It must not present a Send
button that cannot honor the above contract.

This is aligned with the useful human-in-the-loop chain documented by
[Finimatic Email Ops](https://github.com/RossDmello2/finimatic-email-ops), but
Kairos keeps its stricter student data, local storage, and single-action
confirmation rules.

## Course and assignment color system

Course color is already canonical in the semester projection. Retain it as the
stable identity: a 3–4 px pip/marker, small icon tint, timeline tick, and
calendar event marker. Never recolor app chrome, the primary CTA, body copy,
or a whole island background.

An assignment does **not** receive a second arbitrary color. Its visual
identity is `course color + kind glyph + state icon`; this avoids collisions
and makes every assignment from one class instantly legible. A changed/stale
state uses text plus a standard status treatment, not red/green alone.

## Implementation sequence

### Slice 0 — contracts and fixtures (first)

1. Land the TypeScript contract, JSON fixture set for math, paper, exam,
   sparse/LTI, stale source, calendar proposal, connected Outlook draft, and
   unavailable-email states.
2. Add a native read-only `read_mission_control_surface` IPC that reads the
   brief index plus current semester/freshness/connector summaries. Validate
   IDs and bound every string at the Rust boundary.
3. Implement deterministic brief assembly and atomic local projection writes.
   No AI generation and no new connector write capability in this slice.

### Slice 1 — Mission Control UI

1. Refactor `TodayView` into a narrow container and add `MissionControlView`,
   `BriefIslandList`, `AssignmentBrief`, and `OperationsIsland` components.
2. Render four to six ranked islands, one expanded assignment brief, empty and
   stale states, course pips, and existing safe routes/CTAs.
3. Retain the current focus block/exam-week reduction behavior as the rule that
   decides the first island and keeps secondary work compact. Do not retain a
   duplicate focus block above the list.
4. Add keyboard, reduced-motion, screen-reader, narrow-window, and long-title
   tests before visual polish.

### Slice 2 — preference calibration and brief quality

1. Add the optional two-question post-sync calibration and Settings editor.
2. Implement typed modules for exam, math, writing, project/lab, reading, and
   sparse work. Add source provenance visibility and feedback capture.
3. Add optional, explicitly triggered AI enrichment behind the existing relay,
   with schema validation, provenance labels, and a `partial` fallback.

### Slice 3 — operations islands

1. Wire Calendar island to the existing preview/confirmation seam and ledger
   outcome display; test token replay, expiry, and changed fields.
2. Build email intent/draft persistence and editable review. Show connected
   read-only Outlook content honestly.
3. Only after a provider-specific send bridge is built, expose Send behind the
   exact preview/ConfirmationGuard flow. Canvas actions stay preview-only
   regardless of connector capability.

## Acceptance tests

- A synthetic math homework with a clear source produces a math module with
  source locators and no solution to a live graded problem.
- A sparse Canvas title produces `needs_source`, not invented themes.
- A writing brief marks a generated outline as a proposal and keeps prompt
  requirements visible.
- Changed Canvas source marks an open brief stale rather than replacing it.
- The student can open, navigate, and close every island with keyboard only;
  sheet focus returns to its launcher.
- Four priorities show by default; six is the hard maximum; extra work routes
  to Week.
- An accepted Week order survives refresh; a newly moved deadline is labeled
  changed rather than silently reordered.
- Calendar cannot write without a field-bound single-use confirmation token.
- Voice-to-email produces a draft only. A disconnected or read-only email
  connector has no enabled Send action.
- No Canvas submit/comment/discussion request is callable from a brief.
- Two synthetic profiles cannot read each other's brief caches, preferences,
  connector summaries, or drafts.

## Explicit non-goals for this feature

- A chatbot taking over the home page.
- Automatic email send, calendar write, Canvas submission, or discussion post.
- A generic task manager, stress score, productivity streak, or leaderboard.
- A second dashboard made of equal KPI cards.
- Background AI generation that silently spends relay budget or consumes
  unselected email content.
- Guessing content from an LTI/proctored tool. Those stay process-help only.

## Research notes

The project is already structurally closer to the needed architecture than a
generic planner: it has Canvas REST projections, a local Week-plan override,
course colors, freshness deltas, a source-backed Study path, and guarded
actuators. The relevant external patterns are deliberately narrow:

- [Local Study OS](https://github.com/hijasonxu1/local-study-os) is a useful
  local-first planner reference for explainable daily ordering, but its
  dashboard/stress-score treatment is intentionally not adopted here.
- [Canvas LMS API documentation](https://github.com/instructure/canvas-lms/blob/master/doc/api/README.md)
  confirms Canvas's REST API is the right data boundary; the brief builder must
  stay on the repo's existing sync projection rather than scrape UI pages.
- [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) supports
  the accordion semantics chosen for assignment islands; this is why they are
  not called tabs.
- [Finimatic Email Ops](https://github.com/RossDmello2/finimatic-email-ops)
  illustrates a review → approval → policy gate → audit chain. It is reference
  material only; do not import its code or broaden Kairos's send authority.

## Build status (2026-10-15)

Slices 0–3 are built. Send stays disabled by design.

| Layer | Where |
|---|---|
| Contract | `app/src/missionControl/contracts.ts` (mirrored by `browser/scripts/lib/briefs/schema.mjs`, re-bounded in `app/src-tauri/src/briefs.rs`) |
| Assembler (deterministic) | `browser/scripts/lib/briefs/` `classify`, `rank`, `modules`, `assemble`, `project`; runs from `rebuildDashboard` (every sync and freshness tick), from `npm run briefs`, and right after a Week-plan or brief-preference change |
| Native IPC | `read_mission_control_surface`, `read_assignment_brief`, `set_mission_control_selection`, `read_brief_prefs`/`write_brief_prefs`, `record_brief_feedback`/`export_brief_feedback` |
| UI | `app/src/missionControl/` `MissionControlView`, `BriefIslandList`, `AssignmentBrief`, `OperationsIsland`, `BriefCalibration`, `BriefSettings`; `TodayView` is now the container |
| Enrichment | `core/study/brief_enrich.py` (study bridge `brief-enrich`) → relay purpose `brief` (`validate_brief_proposal`) → the `--enriched.json` overlay, hidden on a fingerprint mismatch |
| Calendar | the existing `gcal-preview-event`/`gcal-confirm-event` contract; confirm now writes a `ledger.jsonl` row on success, veto, and error |
| Email | `core/study/email_drafts.py` (`email-draft-*`) stores local drafts; `email-send` refuses; there is no Send button |

Decisions made while building:
- **Stale handling.** The app holds the brief the student is reading and compares fingerprints. It offers "Show the updated brief" rather than keeping a `next/` copy on disk.
- **Exam-week focus.** This now lives in the assembler: an exam, or a quiz worth 10% or more, due within 3 days takes the first island with `focus: true`, and the other islands render quiet. `examWeekFocus` was removed from Today.
- **Pinned work.** There is no pin store yet, so pinning is not a ranking signal.
- **Voice.** Voice keeps exactly two tools. "Voice to email" means the student's words go into the draft's intent field. No `draft_email` voice tool was added; adding one needs a CLAUDE.md change.
- **Compact width.** The first island opens by itself only inline, never as a sheet on page load.

Acceptance → tests:
- Math sources, no solutions: `browser/tests/briefs.test.mjs`, "math homework"
- Sparse title gives `needs_source`: same file, "sparse Canvas title"
- Writing outline is a proposal: same file, "writing brief"
- Changed source shows stale, not replaced: `MissionControl.test.tsx`, "marks an open brief as updated"
- Keyboard and sheet focus return: `MissionControl.test.tsx`, "accordion", "narrow width"
- 4 islands by default, 6 at most, the rest go to Week: `briefs.test.mjs`, "four islands"; `MissionControl.test.tsx`, "routes the rest to Week"
- Accepted Week order survives; a moved deadline shows as changed: `briefs.test.mjs`, "accepted Week order", "moved due date"
- Calendar token is field-bound and single-use: `tests/core/test_connectors.py`, "confirmed calendar write", "changed field or expired"
- Draft only, no enabled Send: `tests/core/test_mission_control.py`; `MissionControl.test.tsx`, "email"
- No Canvas submit, comment or post: `briefs.test.mjs`, "no brief can offer"; Rust `brief_read_rejects_traversal_and_drops_unknown_actions`
- Profile isolation: Rust `two_profiles_never_see_each_other`; `briefs.test.mjs`, "per-profile roots"; `test_mission_control.py`, "two profiles"

End-to-end check on a synthetic student:
```bash
.venv/bin/python tests/fixtures/synthetic-students/make_root.py avery-chen --week dense
cd browser && DEV_USER_ROOT=../var/audit-user-roots/avery-chen npm run briefs
```

### Audit follow-up (2026-10-15)

- Brief source fingerprints now exclude routine fetch timestamps. An unchanged
  Canvas refresh no longer falsely labels the brief being read as updated.
- Brief rebuild requests from plan and preference changes are coalesced, so a
  burst of changes cannot run competing Node rebuilds or expose a partially
  superseded projection.
- A successful scheduled Canvas sync emits the same `inbox-updated` signal as
  an interactive sync. Today therefore refreshes even when its freshness pass
  has no individual delta to report.
- Local calibration feedback is owner-only on Unix (`0700` directory, `0600`
  file). Its export remains aggregate counts only.
- The compact-width media-query subscription is created once per mounted
  Mission Control view, rather than being removed and re-added after every
  render.

Verification after the audit: browser `370 passed`; app `150 passed` plus a
clean production build; Rust `43 passed` plus clean Clippy; Python `1013
passed, 37 skipped, 1 xfailed`; relay `22 passed`. `git diff --check` is clean.
