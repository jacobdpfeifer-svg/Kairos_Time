# Academic Advisor product plan — 2026-10-13

## Decision

Build an **Academic Advisor** workspace that helps a student understand their
current academic position, model plausible paths to graduation, prepare for
registration and advisor meetings, and identify the next decision they need to
make.

The first release is an **evidence-backed planning companion**, not a live
degree-audit or registration system. It composes the existing GPA, course-plan,
degree-audit-import, registration-prep, and semester-progress capabilities into
one student-facing experience.

This is a natural extension of the bounded decision in
[`degree-planning-scope-2026-09-13.md`](./degree-planning-scope-2026-09-13.md):
Canvas and local student data can support planning, while authoritative
requirement claims must come from a dated student-provided SIS/audit import.

## What academic advisors actually do

The professional model is broader than scheduling. NACADA describes effective
advising through three connected competency areas:

1. **Conceptual:** understand advising as a teaching and learning process;
   support student development, agency, inclusion, and decision-making.
2. **Informational:** know the institution's curriculum, requirements,
   policies, academic standing rules, resources, and technology.
3. **Relational:** listen, ask useful questions, explain options, surface
   uncertainty, and help the student make a decision they understand.

See the [NACADA Core Competencies model](https://advising.gmu.edu/wp-content/uploads/NACADA-Core-Competencies-Model.pdf),
the [NACADA pillars summary](https://advising-portal.uni.edu/training-development/pillars-academic-advising),
and the [University of Michigan advising framework](https://advising.umich.edu/advising-coaching-framework/),
which explicitly asks advisors to anticipate needs and answer questions a
student may not yet know to ask.

In operational terms, an advisor repeatedly performs this loop:

```text
understand student goals and constraints
        ↓
establish the authoritative academic facts
        ↓
map completed / in-progress / remaining requirements
        ↓
sequence prerequisites and gateway courses
        ↓
compare possible paths against time, load, GPA, and availability
        ↓
explain tradeoffs and unknowns
        ↓
student chooses → verify in the official system → revisit next term
```

The important implication for Kairos: every recommendation needs both a
**reason** and a **confidence/source boundary**. A useful answer is not just
“take CSCI 2270”; it is “this appears next because it unlocks two later
requirements, matches your stated major, and is prerequisite-eligible based on
these sources; confirm the live section and degree applicability in Buff Portal.”

## What students commonly ask

The recurring question set clusters into six jobs. Georgia Tech's official FAQ
contains a representative set—major changes, minors, registration, time
tickets, transfer credit, academic standing, grade substitution, tutoring,
financial aid, study abroad, research, and graduate/professional-school
advising. The [HEDS pre-advising survey](https://www.hedsconsortium.org/heds-pre-advising-survey/)
also asks students to articulate goals, worries, barriers, and confidence before
the appointment. A national Student Voice survey found that nearly half of
students had not been advised on the courses and sequences required for
graduation, which is a strong signal that “show me the path” is a real product
need. See the [Inside Higher Ed summary](https://www.insidehighered.com/news/student-success/academic-life/2023/02/28/student-survey-reveals-gaps-core-academic-advising).

### 1. Requirements and progress

- What requirements have I completed, and what is still missing?
- Do my transfer, AP, community-college, or prior credits count?
- Does this course satisfy a general-education, major, minor, or elective block?
- Am I on track to graduate in [term/year]?
- How many credits do I need per term to finish on time?
- Which requirement is the biggest risk to my timeline?

### 2. Course selection and sequencing

- What should I take next semester?
- Which courses are prerequisites or co-requisites for later courses?
- What is the best order for these gateway classes?
- Which course should I take now because it is offered only once a year?
- What are good backups if a class is full?
- Is this load realistic with my work, health, athletics, or other commitments?

### 3. Academic standing and what-if decisions

- What happens if I get a B/C or fail this class?
- Am I close to a GPA, scholarship, SAP, probation, or major-admission floor?
- Should I withdraw, repeat, substitute, or change the grading basis?
- How would dropping a course affect credits, aid, prerequisites, or graduation?

### 4. Direction and major decisions

- Is this major/minor/concentration a good fit for my interests and goals?
- What would change if I switched majors?
- Which courses help me test a possible major before committing?
- What careers, research, internships, or graduate programs connect to this path?

### 5. Registration and institutional process

- When is my registration time ticket?
- What hold or to-do is blocking registration?
- What should I bring to an advisor appointment?
- Which official office answers this question: registrar, department, financial
  aid, international student services, accessibility, or advising?
- Where do I verify the final answer?

### 6. Recovery and exception handling

- I failed or withdrew from a required course; what is the recovery path?
- I am behind, changing schools, returning from leave, or considering a lighter
  load; what are my options?
- A transfer or substitution is missing from the audit; who can resolve it?
- I cannot get into the required course; what should I do today?

The feature should support these intents through structured entry points, while
still allowing natural-language questions. It should not force every question
into “next semester courses.”

## Product shape

### The Advisor workspace

Add an `Advisor` destination as a first-class workspace surface. It should open
to a compact decision dashboard, not a conversation transcript:

```text
Advisor
Your path, as of 2026-10-13

┌ Progress signal ───────────────────────────────────────────────┐
│  Audit imported 2026-09-28 · Catalog 2024-25 · 42 credits left │
│  3 requirements in progress · 2 items need verification         │
│  [Refresh audit]  [Open official audit]                         │
└─────────────────────────────────────────────────────────────────┘

Next decision
  Choose a next-term direction
  Gateway course CSCI ___ is the current bottleneck.
  [Explore options]

Path map                         This term
  Foundation  ████████░░ complete  CSCI 1300  in progress
  Major       █████░░░░░ remaining   MATH ___   at risk
  Gen ed      █████████░ complete    ...
  Electives   ██░░░░░░░░ optional
  [See evidence]                   [See current term]

Questions to resolve before registering
  • Does transfer credit X satisfy the science block?
  • Is course Y offered in spring?
  • What happens to my GPA floor if I repeat Z?
  [Prepare advisor meeting]
```

The visual hierarchy should make three things immediately legible:

- **what is known**;
- **what is inferred or suggested**; and
- **what the student must verify or decide**.

Use the existing Kairos “living instrument” language: a calm stage, indexed
rows, evidence rails, and stateful cards. Avoid a generic AI chat panel and
avoid a faux progress ring that implies official certainty.

### Four modes, one underlying model

1. **Snapshot** — “Where am I?” Current term, transfer notes, GPA estimate,
   imported audit age, requirements in progress, and unresolved data gaps.
2. **Path** — “How could I get there?” A term-by-term plan with alternatives,
   prerequisites, load/GPA notes, and explicit assumptions.
3. **Decision** — “What should I choose now?” Compare 2–3 next-term options,
   including a conservative path, a target path, and a recovery/backup path.
4. **Meeting** — “What do I bring to a human?” A concise advisor brief with
   the proposed plan, source dates, open questions, and actions for the student
   to complete in official systems.

### Interaction model

Natural language remains available through the existing voice/command surface,
but results should resolve into objects:

- requirement row;
- course candidate;
- term plan row;
- risk/unknown;
- question for advisor;
- official verification link.

Every object should support “Why am I seeing this?” and show its sources. The
student can edit assumptions locally—target graduation term, credits per term,
work hours, course preference, GPA floor—without changing Canvas or SIS data.

## Trust and source model

The advisor must never collapse these source types into one undifferentiated
answer:

| Source | Can support | Cannot support |
| --- | --- | --- |
| Canvas enrollments, courses, grades, syllabi | Current courses, course context, observed grades, prerequisite language, workload signals | Official degree completion, catalog-year applicability, transfer equivalency |
| `USER.md` and calibration | Goals, major/interests, constraints, credit hours, academic floors, transfer notes | Official institutional policy |
| Dated `inbox/degree-audit.md` | Requirement blocks and remaining credits **as of the import** | Live status; a guarantee that registration will count |
| School policy links | Where to verify holds, audit, registration, aid, and advising | A substitute for the student's official record |
| Student-entered assumptions | What-if modeling | Facts about the institution |

Add a source badge to every claim:

- `Verified in imported audit · 2026-09-28`
- `Observed in Canvas · synced 2026-10-12`
- `Student assumption`
- `Suggested from prerequisites/interests`
- `Needs official verification`

If the audit is missing or older than 90 days, the UI should lower the feature
into **planning mode**, not show an empty error state. Planning mode can still
answer “what courses might fit my interests and prerequisite path?” but must
disable language such as “you have satisfied requirement X.”

## Proposed data model

Keep the existing files as the truth path and add a rebuildable advisor
projection rather than creating another source of truth.

```text
{user_root}/inbox/degree-audit.md          student-provided authority
{user_root}/inbox/grades.yaml              Canvas-derived grades
{user_root}/inbox/courses/*.md             course / syllabus context
{user_root}/calibration/credit-hours.yaml student-maintained hours
{user_root}/calibration/completed-terms.yaml
{user_root}/calibration/advisor-goals.yaml target term / constraints
{user_root}/inbox/advisor/plan.json       rebuildable local projection
{user_root}/inbox/advisor/questions.yaml  student-owned open questions
```

Suggested plan record:

```json
{
  "plan_id": "local-2026-10-13",
  "created_at": "2026-10-13T00:00:00-06:00",
  "target_term": "Spring 2029",
  "mode": "tier2_dated_audit",
  "source_snapshot": {
    "degree_audit_imported_on": "2026-09-28",
    "catalog_year": "2024-2025",
    "canvas_synced_at": "2026-10-12"
  },
  "terms": [],
  "assumptions": [],
  "open_questions": [],
  "verification_tasks": []
}
```

The first implementation should avoid a full automatic course graph. Store
course relationships as typed evidence (`prerequisite`, `co-requisite`,
`offered-term`, `gateway`, `student-suggested`, `audit-unmet`) with provenance.
That makes partial coverage honest and lets the graph improve as the student
adds catalog/course information.

## Implementation plan

### Phase 0 — advisor contract and fixtures

- Add `docs/design/academic-advisor.md` or promote this handoff into the
  product design source of truth after review.
- Extend synthetic student fixtures with: declared program, catalog year,
  transfer credits, target graduation term, constraints, and a dated audit.
- Define response contracts for snapshot, path, decision, and meeting modes.
- Add evaluation cases for missing audit, stale audit, conflicting transfer
  notes, missing credit hours, and an impossible graduation target.

### Phase 1 — Advisor snapshot

- Add a read-only advisor projection in `src/canvas_mcp/core/` that composes
  `degree_audit.py`, `gpa.py`, current enrollments, `USER.md`, and course files.
- Emit explicit data-health rows: audit age, missing credit hours, unknown
  transfer mappings, Canvas freshness, and unsourced requirement claims.
- Add the `advisor` skill/router intent for broad questions such as “am I on
  track?” and route narrower questions to the existing skills.
- Expose the snapshot in a new app view with source badges and a clear “confirm
  in official system” rail.

### Phase 2 — decision cards and meeting brief

- Reuse `student-course-plan` to produce ranked candidates with reasons and
  backups.
- Reuse `student-registration-prep` to populate blockers, official links, and
  advisor questions.
- Add local editable assumptions and a “compare paths” card.
- Add a meeting-brief export/copy action. It drafts only; it does not email or
  schedule without the existing confirmation gates.

### Phase 3 — multi-term path planner

- Add a deterministic term allocator for remaining audit credits, prerequisites,
  target term, course availability evidence, and load constraints.
- Show at least three plans when meaningful: on-time, lighter-load, and
  conservative/recovery.
- Mark any row that lacks a known offering term or prerequisite as provisional.
- Add what-if actions for dropping, repeating, changing major, or shifting the
  target term; keep these local-only.

### Phase 4 — refresh and verification loop

- Add “audit is stale” and “Canvas changed” refresh prompts.
- Keep previous plans as dated local snapshots so the student can see what
  changed and why.
- Add a student check-off flow for official verification: “I confirmed this in
  Buff Portal,” “I need an advisor,” or “This is wrong.”
- Use these outcomes for product evaluation, not autonomous self-rewriting.

## Boundaries

The advisor must not:

- infer major requirements from Canvas alone;
- scrape Buff Portal, DegreeWorks, or another SIS;
- register, add/drop, waitlist, or change grading basis;
- assert scholarship/SAP/academic-standing eligibility from a local estimate;
- tell a student that a transfer or substitution definitely counts without an
  authoritative record;
- replace a human advisor for exceptions, appeals, accommodations, immigration,
  financial aid, or high-stakes personal situations.

It should instead make the human interaction better: show the student what is
known, what they think they want, what tradeoffs exist, and the exact questions
that remain.

## Success criteria

The first useful release is successful if a student can, in under five minutes:

1. see their current academic position and the freshness of each input;
2. understand why a course or requirement appears in the plan;
3. compare two plausible next-term paths;
4. identify the highest-risk unknown or bottleneck;
5. leave with a clean advisor-meeting brief and official verification links.

Evaluate with synthetic and human walkthroughs, not only unit tests. High-risk
failure cases must be “confidently wrong requirement claim,” “stale audit shown
as current,” “transfer credit silently double-counted,” and “impossible plan
presented as achievable.”

## Recommended build order

1. Snapshot contract + fixtures
2. Advisor snapshot projection
3. Advisor workspace UI
4. Decision cards / meeting brief
5. Multi-term path planner
6. Refresh, verification, and outcome evaluation

This order delivers visible student value early while keeping the authoritative
degree boundary intact.
