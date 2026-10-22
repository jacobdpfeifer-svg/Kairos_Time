# Generative workspace architecture (2026-10-21)

Status: architecture accepted as the scaffold for build-out. Supersedes the
"desktop preview/accept surface pending" note in
[`docs/design/workspace-studio-onboarding.md`](../design/workspace-studio-onboarding.md),
which stays accurate about the trust boundary and becomes its student-facing summary.

## 1. What this is

A student finishes school → Canvas → sync, then may choose **Design my
workspace**. A voice (or typed) interviewer learns how their work actually
flows. A *deterministic compiler* — not the model — turns that into a
**workspace spec**, which is streamed into the screen block by block while the
student watches, then edited by them, then accepted by them. The accepted spec
drives the real app shell from then on.

The feeling is "it built my workspace in front of me". The mechanism is
"the model produced constrained intent; local code produced the layout".

## 2. The one hard rule

**The model never emits UI.** No JSX, no HTML, no CSS, no component tree, no
free-form field that reaches a renderer. It emits an `intent` object against a
frozen vocabulary (frictions, orientation, constraints, requested tools). Every
layout decision is made by `compileWorkspace()`, which is pure, local,
deterministic, snapshot-tested, and has no network access.

Why this and not model-authored UI: a model-authored layout cannot be
regression-tested, cannot be guaranteed to stay inside MASTER, cannot be
diffed for the student's accept step, and makes every future app change a
prompt-engineering problem. Determinism is what makes personalization safe to
ship and cheap to maintain.

```text
interview (model, 3 tools, draft-only)
  → workspace/onboarding-draft.json      status: draft
  → compileWorkspace(draft, catalog)     local, pure, no model
  → workspace/proposed.json              status: proposed  + patch stream
  → Workspace Studio: watch, edit, name it
  → student accepts
  → workspace/workspace.json             status: accepted
  → workspace/history/<ts>.json          revert target, keep last 10
```

A model-written file can never be loaded by the renderer: the loader refuses
any spec whose `status` is not `accepted` and whose `accepted_by` is not
`"student"`.

## 3. Spec v1

Source of truth: `browser/scripts/lib/workspace/spec.mjs`.
Mirrors (must stay byte-equivalent in meaning, same pattern as briefs):
`app/src/workspace/contracts.ts` (reader types + predicate resolution),
`app/src-tauri/src/workspace.rs` (bounds + atomic write + history).

Flat format — a `surfaces` map whose slots hold block ids, plus a `blocks` map.
Flat (rather than nested) because it streams, patches, and diffs cleanly; this
is the shape `vercel-labs/json-render` and Google's A2UI both converged on.

```jsonc
{
  "schema_version": 1,
  "status": "accepted",              // draft | proposed | accepted
  "spec_id": "ws_<ulid>",
  "name": "Morning desk",            // student-authored, optional
  "created_at": "2026-10-21T…",
  "accepted_at": "2026-10-21T…",
  "accepted_by": "student",          // the only accepted value
  "origin": {
    "kind": "interview",             // interview | template | edit | amendment
    "template_id": "calm-daily",
    "draft_session_id": "…"
  },
  "authorship": { "student_edits": 3, "renamed": true, "last_edited_at": "…" },
  "density": "comfortable",          // comfortable | compact
  "surfaces": {
    "today": { "slots": ["b1", "b2", "b3"] },
    "week":  { "slots": ["b4"] },
    "courses": { "slots": [] },
    "study": { "slots": ["b5"] },
    "advisor": { "slots": [] }
  },
  "blocks": {
    "b1": { "capability": "today.next_action", "size": "full", "props": {}, "visible_when": "always" },
    "b2": { "capability": "today.changes", "size": "full", "props": {}, "visible_when": "has_changes" }
  },
  "quiet": { "interrupt_for": ["due_moved", "high_stakes_48h", "sync_broken"] },
  "requested_integrations": [
    { "name": "Notion", "state": "requested", "heard_at": "2026-10-21T…" }
  ],
  "entitlement": "local"             // seam only; see §9
}
```

Bounds (enforced on read *and* write, in all three mirrors): ≤6 blocks per
surface, ≤24 blocks total, every slot id exists in `blocks`, no block id in two
slots, `capability` is in the catalog, `size` is in that capability's `sizes`,
`props` validate against that capability's prop schema with unknown keys
dropped, `visible_when` is one of the predicate enum, surfaces are exactly the
five known tabs, no surface may be empty of its capability's `required`
companions, `name` is text of at most 80 characters. A spec that fails any bound
is not repaired — it is rejected and the previous accepted spec (or the default)
loads, with one plain sentence in Settings → Appearance.

Read means every read, not only the accepted file. `proposed.json` is validated
when it is read as well as when it is written: a proposal that no longer fits the
catalog is dropped and the studio opens a fresh one from the accepted workspace,
rather than handing an unchecked spec to the renderer. (A `baseline` that no
longer fits costs the student only Start over, so that key alone is dropped and
the edits are kept.)

### Predicates

`visible_when` is an **enum, never an expression**. v1 set: `always`,
`has_changes`, `due_within_48h`, `has_exam_within_7d`, `has_unread_announcements`,
`missing_course_sources`, `weekend`, `weekday`. Each resolves in
`app/src/workspace/predicates.ts` from data the app has already loaded — a
predicate may never trigger a fetch, and an unknown predicate resolves to
`true` (show the block) rather than hiding the student's work.

### Capability registry

Extends the reviewed catalog already in
`browser/scripts/lib/workspace/onboarding.mjs`. Each entry:

```jsonc
{
  "id": "today.next_action",
  "label": "One clear next action",
  "blurb": "The single thing to start, with why.",     // shown in the preview
  "surfaces": ["today"],            // where it may be placed
  "component": "NextAction",        // key in the renderer registry
  "sizes": ["full"],
  "props": { "show_reason": { "type": "boolean", "default": true } },
  "supports": ["finding_next_action", "starting_work", "staying_calm"],
  "requires": [],                   // capability ids that must co-exist
  "max_instances": 1,
  "availability": "available",       // available | optional_connector
  "tier": "local"
}
```

The registry is **hand-reviewed code, not data the model can extend**. Adding a
capability is a PR that also adds its component, its props schema, its
snapshot, and its entry in all three mirrors.

## 4. The compiler

`compileWorkspace(draft, { catalog, now })` → `{ spec, patches, rationale }`.
Pure. No I/O. No model. Fully snapshot-tested.

1. Score templates with the existing `suggestTemplates(draft)`.
2. Take the winning template's blocks as the spine.
3. Add at most **two** friction-driven blocks whose `supports` intersect the
   draft's frictions and that are not already present.
4. Drop blocks the draft's constraints exclude (quiet preference removes
   `today.changes`; an `optional_connector` capability is only ever placed in
   its `requested`/`not_available` visual state, never as working).
5. Apply `quiet.interrupt_for` from the stated interruption answers, intersected
   with the three notification kinds policy already allows.
6. Order each surface by the student's stated orientation, then by
   `capability.weight`. Never random, never model-chosen.
7. Emit `patches` — the ordered op list that produces the spec from empty.
   The order is the one the live build can land them in: a block never lands
   before a companion its capability `requires`, and each `index` is its position
   among the siblings already on screen, so *every prefix of the stream is itself
   a valid spec*. `workspace-compile.test.mjs` replays each frame through the
   validator; without that the studio silently falls back to the finished spec
   the first time a `requires` edge is added to the catalog.
8. Emit `rationale` — one sentence per block, in the student's own words where
   the draft quoted them (`"you said you lose track after Sunday"`).

`rationale` is the single highest-value output: it is what makes the result
feel authored rather than assigned, and it costs nothing at runtime.

### Patch ops

Closed set: `place`, `remove`, `reorder`, `set_props`, `set_density`,
`rename`, `set_home`, `set_quiet`, `done`. Each carries `{ op, surface?, block_id?, index?, block?,
narration? }`. `set_home` and `set_quiet` exist so an amendment can change the
opening tab or narrow interruptions without a second patch language. The same
op type serves the live build, the student's edits, and amendments, so undo/redo
and revert are one code path. `set_quiet` may only shrink `interrupt_for`.

## 5. The live build (the part that earns the emotion)

`WorkspaceStudio` consumes the patch stream and lands one block at a time,
~180–260ms apart, with the voice agent narrating each `narration` string. Only
`place` ops are frames: the leading `set_density` / `set_home` / `set_quiet` ops
are already true of the shell the build starts from, so pacing them would open
the studio with three ticks of an empty screen. Then
it stops and waits.

This is motion on *real state change* (MASTER §09), not decoration: each frame
is a block actually entering the spec. Required: `prefers-reduced-motion`
renders the finished spec at once with the rationale list; the whole animation
is skippable with one visible control; nothing is irreversible until accept.

**No fake generation.** No typing-cursor over a code pane, no shimmering
"thinking" skeleton pretending the layout is being written. The student is
watching a real assembly of real blocks.

## 6. Ownership mechanics (and the trap to avoid)

The IKEA-effect literature (Norton/Mochon/Ariely) is explicit on two points
this design must respect:

- The valuation gain comes from **the student's own completed labor**, not from
  watching something be made for them. So the studio requires at least one real
  student act before accept: reorder, remove, or add a block, *or* name the
  workspace. "Looks good" alone is allowed but logged as `student_edits: 0`,
  and the studio nudges once ("move one thing so it's yours").
- Mass-customization research finds the gain **disappears when the result stops
  looking like a normal example of its category**, and that extra choice can
  cause paralysis. So: five reviewed starting points, ≤3 shown, ≤6 blocks per
  surface, every result still unmistakably Notebook-era Kairos. There is no
  blank canvas, no theme editor, no font picker, no free color.

Reinforcement after onboarding: a provenance line in Settings → Appearance —
`Your workspace · built 21 Oct · 3 edits · Revert`. Visible authorship,
reversible, no streak, nothing losable (CLAUDE.md gamification rule).

## 7. The amendment loop — the retention mechanism

A one-time generative moment is a nice demo; it does not retain. What retains
is the workspace continuing to fit. So the same compiler runs again on real
signals, and proposes:

> You've opened Week first 9 of the last 10 days. Make Week your home screen?
> [Yes] [No] [Stop suggesting this]

Rules, all inherited from CLAUDE.md: a suggestion waits for a yes; it never
moves after acceptance; at most one pending amendment at a time; at most one
amendment proposal per week; a dismissed amendment never returns. Signals are
local counters in `{user_root}/workspace/usage.json` (tab opens, first tab of
the day, dwell in two-minute chunks, block expansions) — never keystrokes, never
content, never uploaded.

This is the part to build **second** and ship **first-class**. It is cheaper
than the interview, needs no API key, and is what makes the workspace feel alive
in week six.

### Appendix: what is counted, and why the loop is shy

`{user_root}/workspace/usage.json` is the only usage file. A student can open
it. It holds counters and calendar dates, and nothing else:

- `schema_version` (1)
- `surfaces.<tab>.opens` — times that tab was shown
- `surfaces.<tab>.first_of_day` — days that tab was the first one opened
- `surfaces.<tab>.dwell_seconds` — seconds the tab was visible, added in chunks of at most two minutes
- `days[]` — at most 21 entries of `{ date, first_surface }`, the local calendar day and which tab opened first
- `blocks.<id>.expansions` — times a block was explicitly expanded (0 while screens do not collapse)
- `blocks.<id>.last_seen` — the local date that block's tab was last shown

`last_seen` is a *tab* stamp: every block on a surface is written the same date
when that surface is shown. It can say the student stopped visiting a tab; it can
never single out one block there as untouched. Only `expansions` can do that, so
that is what a removal is keyed on (below).

There is no clock time, no keystroke, no sentence from Canvas, and no block text.
Unknown keys are dropped on write. The file stays on this Mac, mode 0600, and is
never sent to a model.

Suggestions are remembered separately, in `{user_root}/workspace/amendments.json`:
`pending`, `last_proposed_on`, `dismissed` (fingerprints that got No), and
`stopped_kinds` (Stop suggesting this, permanent, per kind). That file is how a
No survives a restart. It is not a log of what the student typed.

Read, and what it changed: Mitchell and Shneiderman 1989 found frequency-sorted
menus slower than menus that stay put. Findlater and McGrenere 2004 found that
moving items breaks spatial memory, while copying a favorite into a stable extra
region does not. Gajos, Czerwinski, Tan, and Weld (AI Magazine 2009) put the
cost of a wrong adaptation above the benefit of a missed one, and named control
and predictability as the requirements. Cockburn, Gutwin, and Greenberg 2007
showed that stable positions are what let visual search get faster with practice.
Findlater and McGrenere 2010 showed that hiding a feature reduces awareness of
it. Horvitz, CHI 1999: under uncertainty, ask or do nothing; make dismissal
cheap; do less, correctly. Findlater and McGrenere 2008: low-accuracy adaptivity
is worse than none.

So the sidebar never moves. The preferred suggestion is which tab opens, because
that does not relocate a control. Reorder is last, one step, and only at a
three-times gap. A removal never empties a tab, and needs a fortnight of history,
a block with no expansions at all, and a neighbour with at least three on a tab
the student still opens — so while the screens do not collapse and nothing records
an expansion, it does not fire at all. That is deliberate: the signal that would
be left is the tab stamp, which says nothing about the individual block, and a
removal made on it would be exactly the low-accuracy adaptation Findlater and
McGrenere 2008 measured as worse than none. Night quiet stays 23:00–08:00 in the notification
policy. An amendment may drop `due_moved` only, and only after opens on 18 of 21
days. It may not drop a high-stakes item or a broken Canvas sign-in, and it may
not add a kind. A fresh file, a missing field, or a garbage field produces no
suggestion. Nine days out of ten is still a question.

## 8. Prior art, and why nothing is vendored

Surveyed: `vercel-labs/json-render` (Apache-2.0; Zod catalog, flat
`{root, elements}` spec, `SpecStream`), Google **A2UI** (A2A extension;
client-held allow-list, `beginRendering`/`surfaceUpdate` streaming, explicitly
designed so agents never ship HTML/JS), Thesys **OpenUI** (MIT; streaming DSL),
**CopilotKit/AG-UI** (agent↔UI event protocol).

Decision: **adopt the pattern, vendor none of them, for now.**
- json-render's value is the catalog + Zod validation + stream compiler. Its
  component story is shadcn/Radix/Tailwind; this app is hand-built React 19 on
  `notebook.css` with zero UI deps and no Zod. Vendoring it imports a styling
  stack the design system forbids, to render ten Kairos-specific blocks.
- A2UI's value is the threat model (agent requests allow-listed components; the
  client owns rendering). That threat model is adopted verbatim in §2–§3. The
  protocol itself is for remote agents rendering into a foreign client, which is
  the opposite of this local-first app.
- The whole in-repo spec layer is ~300 lines and is testable in `node --test`
  and `vitest`, which the repo already runs.

Reconsider triggers, to be written into the doc rather than rediscovered: (a)
third-party agents need to render into Kairos; (b) the catalog passes ~40
capabilities; (c) a second renderer target appears (web, extension side panel).
At any of those, re-evaluate json-render's `core` + a custom registry.

## 9. Premium, honestly

Keep a `entitlement` seam (`"local" | "premium"`), default everything on
locally, and gate nothing in v1. The ownership effect is the retention
mechanism; paywalling the only act of ownership at first run destroys the thing
being sold. When there is a business reason to gate, gate the *recurring*
value, not the first build: the voice interview re-run, the amendment loop, and
reviewed connectors. Never gate revert, and never gate the accepted spec a
student already built.

## 10. Connectors — placeholders only

`requested_integrations` stays the only mechanism. A student naming Notion,
Obsidian, a campus system, or anything else produces a `requested` record and a
`not_available` visual state. No OAuth, no fetch, no install, no "we can connect
that". `CONNECTOR_REGISTRY` remains static and hand-reviewed.

Research pointer for the later connector phase, not for build-out now: the
self-hosted MCP gateway/registry pattern (IBM ContextForge, Obot, Docker MCP
Gateway's catalog, agentic-community's MCP Gateway & Registry) is the shape
worth evaluating if Kairos ever brokers per-student OAuth to third-party tools —
because it keeps credentials out of the client and keeps a reviewed catalog
between the model and the world. It is incompatible with "the brain stays
local" until the hosting-decision criteria doc says otherwise, so it stays a
pointer. Composio-style hosted brokers are out of scope for the same reason.
The evaluation, checked against each project's own repo on 21 Oct 2026, is
[`docs/research/connector-brokering-options-2026-10-21.md`](../research/connector-brokering-options-2026-10-21.md):
wait, and only reopen it under the conditions that note names.

## 11. Alternative considered (and the recommendation)

**Alternative: no interview at all — observed-behavior adaptation only.**
Ship the five templates, pick one from three onboarding taps, then let the
amendment loop (§7) shape it over weeks. Cheaper, no API key, no model risk,
and the retention mechanism is the strong one.

Note on the template pick: with one screen per tab there is no block
arrangement left to tell the five starting points apart, so the choice is
carried by `home`, the tab the app opens on, from the same preference mapping
the compiler uses (`homeForPreference`). Without that the pick only renames the
workspace, and the tap the student spends on it buys nothing.

**Recommendation: build both, in this order** — (1) spec + registry + renderer
+ template pick + studio editing + revert; (2) amendment loop; (3) the voice
interview and the live build as the *premium, delightful* front door. That
order means the product is complete and shippable after (1), retains after (2),
and the generative moment in (3) is a sellable surface rather than a load-bearing
dependency. It also means an API key is needed last, not first.

## 12. Evaluation before any model key

Scripted transcript fixtures → `normalizeWorkflowDraft` → `compileWorkspace` →
golden spec snapshots. Required fixtures: overloaded deadline tracker,
course-by-course organizer, study-first learner, notification-sensitive student,
calendar-dependent planner, student requesting an unsupported tool, student who
contradicts themselves mid-interview, hostile/prompt-injected transcript,
empty/one-word answers, student who asks for a Canvas submit. Assertions: valid
spec, intended template, zero hallucinated capabilities, zero
`status: accepted`, requested tools never `available`, bounds respected,
compiler output identical across runs.
