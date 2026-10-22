# Workspace Studio onboarding

Status: built. The preview/accept surface, the patch engine, the amendment loop,
and the three-way bounds mirror are in the tree; this note stays as the
student-facing summary of the trust boundary. The mechanics are in
[`docs/handoff/generative-workspace-architecture-2026-10-21.md`](../handoff/generative-workspace-architecture-2026-10-21.md),
which is the source of truth where the two disagree. "Desktop integration
contract" below is written as a brief and reads in the future tense; it
describes what `FirstRun` now does.

## Student promise

After Canvas has connected and courses are available, a student may choose
**Design my workspace**. A voice interview learns how their work actually
flows, proposes a workspace built from capabilities that Kairos already owns,
and saves a local draft. It never implies that an unconnected tool is usable.

The student must see a visual preview and explicitly accept it before their
workspace changes. “Skip for now” must always lead to a useful default.

## Durable boundary

```text
voice/text interview → workspace/onboarding-draft.json (status: draft)
                       → Workspace Studio preview
                       → student accepts
                       → accepted workspace configuration + reversible snapshot
```

The interview model has no tool for applying a layout, navigating the app,
installing a connector, opening OAuth, or acting in Canvas. It can only invoke
`save_workflow_draft`; the server validates its output against the reviewed
catalog in `browser/scripts/lib/workspace/onboarding.mjs`.

## Current catalog

The catalog maps real Kairos capabilities to common student frictions and
offers five reviewed starting templates: Calm daily focus, Weekly planner,
Course command center, Study-first, and Quiet minimal. Optional Calendar and
Outlook context are named only as optional connectors. A student naming Notion,
another campus system, or any other tool creates a **requested integration** in
the draft; it does not create an authorization or an installation path.

## Desktop integration contract

`FirstRun` should gain an optional `workspace` step only **after** the existing
school → Canvas → sync completion. It should offer:

1. Start with the recommended template.
2. Talk it through (launch the local voice interviewer in `onboarding` mode).
3. Do this later.

When the local draft appears, render the top three deterministic template
matches from `suggestTemplates(draft)`. Show the student’s stated friction,
constraints, proposed blocks, optional-connector state, and requested tools.
Actions are **Use this starting point**, **Edit choices**, and **Keep default**.
The implementation must store a versioned accepted config and retain the
previous config for undo. It must not store this state only in webview
`localStorage` because onboarding is profile-scoped.

## Future connector discovery

Requested integrations are useful product evidence. Aggregate only with an
explicit, privacy-preserving product-research opt-in. Until a connector is
reviewed and statically added to `CONNECTOR_REGISTRY`, its only permitted UI
states are `requested` and, where appropriate, `not_available`. It cannot be
shown as connected or offered OAuth.

## Evaluation before model keys

Run scripted interview fixtures through the prompt and assert that the saved
draft has the intended template, does not hallucinate an integration, and never
contains an applied state. Cover at least: overloaded deadline tracker,
course-by-course organizer, study-first learner, notification-sensitive
student, calendar-dependent planner, and a student requesting an unsupported
campus tool.
