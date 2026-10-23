# Decision: read-only + study-focus pivot — 2026-09-11

Signed by Jacob in conversation on 2026-09-11 (not an escalation — do not re-litigate
in a future audit pass). Supersedes any earlier framing of this repo as a general
student-agent-automation platform. Research backing this call is summarized below;
detail lives in chat history, not restated here.

## The decision

The product is a **read-only Canvas companion that helps a student plan and study**.
It is not an agent that acts on a student's behalf toward anyone else — an
instructor, a classmate, a recipient of an email, a calendar invite another person
can see. If an action would be visible to, or binding on, another person, this
product does not perform it. It only reads, summarizes, and drafts for the student
to send themselves.

Why (research, 2026-09-11 session): the two most-installed Canvas browser extensions
(BetterCampus/Better Canvas, Gesso — 1.5M+ users combined) are pure read-only UI
polish: themes, grade views, GPA calculators. None of them act on the student's
behalf. Separately, a controlled study of students using a general-purpose AI agent
(arXiv 2607.18257) found trust collapses specifically around actions that are
irreversible or visible to someone else — not around "high stakes" in the abstract —
and that acting without a preview produces delegation regret even when the action
succeeded. Both signals point the same way: read + draft is the trusted, wanted
shape; execute-on-behalf-of is not.

**Note (2026-09-13):** the item 1 bullets below describing calendar/email are
historical — see the 2026-09-13 addendum, which revises this specifically for
personal-account (not Canvas-visible) calendar/email writes. Left as originally
signed rather than rewritten in place, per this doc's own addendum convention
(see the 2026-09-12 self_improve addendum for why that convention exists).

## What changes

1. **Delete the execution path, not just the confirmation gate, for anything
   visible to another person.**
   - `submit_assignment` (`src/canvas_mcp/tools/student_write.py`): keep the
     preview (assignment info, points, due date, attempt count) — delete the
     POST-to-Canvas branch, the upload pipeline, and the `ConfirmationGuard`
     token machinery built to protect it. The tool always ends in "submit this
     yourself in Canvas."
   - `mcp-servers/gcal/server.py`, `mcp-servers/apple-cal/server.py`:
     `create_event` / `update_event` stop writing to the real calendar. Mirror
     the pattern `mcp-servers/gmail/server.py` already uses for `send_email`
     — a hard-blocked stub, no API call, no ledger write.
   - `mcp-servers/gmail/server.py`: already correct (`send_email` is a
     no-op stub, `create_draft` never sends). No change needed — noted here so
     a future pass doesn't "fix" it back toward sending.
   - Consequence: `ConfirmationGuard` / `connector_guards.get_connector_guard`
     lose their reason to exist on the send/submit side. Leave the
     `ConfirmationGuard` class itself (it's generic, cheap, and still used
     wherever a real local write remains, e.g. `apply_labels`/permission
     changes) but do not build new send/submit-shaped gates on top of it.

2. **Do not build a RateMyProfessors integration.** Their ToS explicitly
   prohibits scraping and they've sent cease-and-desist mail to developers who
   tried. Do not spend effort here even as a "read-only" scrape — it is not
   read-only from RMP's side. Redirect the underlying need (what does this
   professor actually want) to the syllabus/rubric/assignment-instructions the
   student already has legitimate access to via `/api/v1`.

3. **Syllabus/assignment/grading extraction — already built, correction from
   2026-09-11.** This item was originally written up as "not built" and a
   spec for future work. That was wrong: `skills/student-instructor-profile`
   already does this — it synthesizes grading weights, rubric requirements,
   late-policy language, and behavior preferences from the syllabus,
   assignment rubrics, policy pages, and announcements into `## Instructor
   profile` in `{user_root}/inbox/courses/CODE.md`, with a documented source
   priority and staleness/refresh rules. It's already wired into
   `student-assignment-triage`, `canvas-discussion-facilitator`, and
   `student-course-arc`. One inconsistency found and fixed 2026-09-12: its
   "external research" step named RateMyProfessors as a weak-hint source,
   which contradicts item 2 above — removed, redirected to syllabus/rubric.

   **The real remaining gap:** this profile is pulled when an agent is
   already doing course-specific work (triage, drafting), not surfaced
   proactively in the daily check-in/brief. `student-task-brief` only reads
   it for discussion-type tone/citation prefs — a student doing, say, an
   essay due Friday does not automatically see "worth 20% of your grade,
   rubric wants X" in the daily snapshot unless something asks for it. That
   surfacing is the actual next build here, not extraction from scratch.

4. **Restyle `learn_loop`/`habit` gamification, don't rebuild it.** Keep
   spaced retrieval and the daily due-check as-is — they're already correctly
   un-gamified per their own docstrings ("not a streak," "never shames"). Any
   UI gamification layer (progress bars, mastery indicators, session
   completion) must have **no possible broken/failed state** — no streaks, no
   leaderboards, nothing that can go backward. `docs/design/class-standings.md`
   ("optional hideable class leaderboard") stays **framed, not built** — this
   decision reads as a lean toward never building it, not just deferring it.

5. **Delete `src/canvas_mcp/core/self_improve/*`** (`distill.py`, `shadow.py`,
   `promoter.py`, `cluster.py`, `drafter.py`, `logger.py`, `run.py`,
   `__init__.py`). No external demand signal for a system that rewrites its own
   prompts from its own shadow runs — it serves the system, not the student,
   and it's real complexity (skill_router request-logging dependency, four
   test files). Remove the `skill_router.py` import and the request-logging
   call site it feeds; request logging itself is not required to survive this
   cut unless something else already depends on the log file's contents (check
   before assuming it's dead).

## Addendum — 2026-09-12: comment_on_my_submission closed

The 2026-09-11 pass left `comment_on_my_submission` executing for real
(explicit scope note above). Jacob decided in conversation on 2026-09-12 to
close that inconsistency: a submission comment is visible to the instructor,
same category as `submit_assignment`, so it is now preview-only too — same
treatment, no execution path, no confirmation flow. `mark_module_item_done`
remains untouched (private, self-only, no external visibility).

## Addendum — 2026-09-12: discussion post/reply closed

`post_discussion_entry` and `reply_to_discussion_entry` are the same
category: visible to classmates and the instructor. Both are now
preview-only (GET topic for context, never POST). Browser
`CONFIRM=1` photo submit is hard-blocked the same day. Student posts
themselves in Canvas.

## Addendum — 2026-09-12: self_improve deletion finished

Item 5 above said delete `src/canvas_mcp/core/self_improve/*` in full,
including `distill.py` and `logger.py`. A later session kept those two alive
(`skill_router.route_intent` still wrote a `RequestLog` to `episodic.db`,
`distill.py` still fed `MEMORY.md`) and left a docstring re-justifying the
call, but no addendum here actually recorded that as a decision — it read as
an agent quietly overriding a signed instruction. A comprehensive audit on
2026-09-12 surfaced the gap; Jacob confirmed in conversation to finish the
original deletion rather than ratify the reversal. `self_improve/` is now
gone in full, `skill_router.route_intent` no longer writes a request log, and
`tests/core/test_distill_memory.py` (plus the two tests in
`test_skill_router.py` that asserted `episodic.db` rows) are removed.

## Addendum — 2026-09-13: personal-account send/create-event reopened, human-confirmed only

Jacob revisited the calendar/email cut in conversation on 2026-09-13. Item 1
above named `send`/`create-event` alongside `submit`/`comment`/
`discussion-post` as one category to never re-execute. That conflation is
corrected here — the two are not the same risk:

- `canvas_submit` / `canvas_discussion_post` / `comment_on_my_submission`:
  visible to an instructor, carry institutional/academic-integrity weight,
  and stay preview-only. **Unchanged, still banned, do not re-add.**
- Personal Gmail `send_email` and Google Calendar `create_event`/
  `update_event`: the student's own accounts, no instructor or institution on
  the other end. These are reopened, on one condition — **execution only
  ever follows an explicit, per-instance human "yes, do that" in the current
  conversation, referencing the exact previewed content.** There is no
  standing "trust this and auto-send" mode: `email_send` was previously
  eligible to escalate to `automatic` posture after 5 clean approvals
  (`DEFAULT_K` in `permissions.py`); that escalation entry is removed so the
  preview step never goes away. `calendar` (event writes) moves from
  `automatic` to `gated` posture for the same reason — every write shows a
  preview and waits for a token tied to that exact content.

Mechanism: both tools route through the `ConfirmationGuard` /
`gate_connector_write` flow `apply_labels` already used (preview →
fingerprint-bound token → student says go → execute). This is the same
machinery item 1 above warned not to reuse "since the guard already
exists" — the distinction that makes it authorized here is that the guard
now gates a *personal-account, human-triggered-per-instance* action, not an
autonomous or standing one, and it is recorded here rather than wired back
up silently.

Implementation: `mcp-servers/gmail/server.py` `send_email` and
`mcp-servers/gcal/server.py` `create_event`/`update_event` now call the real
Gmail/Calendar APIs (`mcp-servers/common/google_oauth.py`
`gmail_send_message` / `gcal_create_event` / `gcal_update_event`) behind
`gate_connector_write`. `gcal/server.py` gained a `rewind` tool (delete a
created event, restore an updated one's prior summary/time) mirroring
`gmail/server.py`'s existing undo pattern — `send_email` has no undo_ptr,
since a sent email cannot be unsent.

Apple Calendar (`mcp-servers/apple-cal/server.py`) stays hard-blocked: no
working EventKit helper binary exists in this repo to wire up (the
`SWIFT_HELPER` path was always aspirational), not a policy choice — do not
fake a write path there.

Product framing going forward: the calendar/email MCP surfaces exist to
**read and correlate** (what's inbound, how it maps to coursework/schedule,
what the student should know or decide) and to **suggest** actions — the
student either does the suggested thing themselves or tells the agent to do
it, per-instance, and only then does the agent act.

## What agents must not do

- Do not re-add a `submit`/`comment`/discussion-post execution path "for
  convenience" or "since the guard already exists" — the guard existing is
  not authorization. This includes `comment_on_my_submission` and
  discussion post/reply (closed 2026-09-12, see addenda above). This ban
  does **not** extend to personal-account `send_email`/`create_event`/
  `update_event` — see the 2026-09-13 addendum above for why those are a
  different risk category and are now human-confirmed-execute.
- Do not build RateMyProfessors scraping in any form, including a "just reads
  the page the student is already looking at" framing — the ToS violation is
  on the automated-access side, not the content side.
- Do not add streaks, leaderboards, or any mechanic with a losable state to the
  learn_loop/habit surfaces.
  **Amended 2026-10-23** (MASTER §16.6, [`../research/game-design-as-product-design-2026-10-23.md`](../research/game-design-as-product-design-2026-10-23.md)):
  this rule is unchanged but now carries its reason, so it survives the next
  person who arrives with a number. Every published streak figure — Duolingo's
  3.6x course completion, +1.7% day-7 from a milestone animation, +14% from a
  streak wager — is a retention or engagement metric, and no measured effect of
  streaks on *learning outcomes* exists in either direction. The evidence offered
  for streaks is evidence for the wrong outcome. The same section also prohibits
  by name the free-to-play monetization ladder and any offer timed to a moment of
  failure: Kairos may use that moment to reduce the cost of the next action, never
  to raise the price of staying.
- Do not treat item 3 (syllabus/grading extraction) as done because this doc
  exists — it is a spec, not an implementation.
- Do not let `email_send` or `calendar` (event writes) escalate to
  `automatic` posture or otherwise skip the per-instance preview/confirm —
  the 2026-09-13 addendum's whole basis is that a human confirms every time.
- Do not rewrite "## The decision" or numbered items above in place to
  reflect a later revision — add a dated addendum instead, even when the
  revision is fully authorized. This file's own history (the 2026-09-12
  self_improve addendum, and a 2026-09-13 in-place edit caught mid-session
  and reverted back to the original signed text) is the evidence for why.
