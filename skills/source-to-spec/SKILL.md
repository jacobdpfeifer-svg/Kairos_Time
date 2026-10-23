---
name: source-to-spec
description: >-
  Turn external source material (a video or talk transcript, an article, a thread,
  a competitor teardown) into a verified research doc and a decision-forcing spec
  in this repo. Verifies the source's own claims, researches past where it stops,
  audits what the repo already ships, and lands rules. Use for "research this and
  implement it", "go deeper than this video", "what should we take from this",
  or any handed-over material meant to change the product.
schema_version: 1
category: research
model_tier: default
requires_cloud: false
---

# Source material → verified research → spec

**Launcher:** read `CLAUDE.md`, `AGENTS.md`, and the design system (`design-system/kairos/MASTER.md`) before writing a single agent prompt. Product boundaries there override both this skill and the source material. The source is a stepping stone, never an authority.

**Chat rule:** 3–8 words between stages (`six agents running`, `all back, writing spec`). No narration of what you are researching, no running summaries. Everything goes in the files. One substantive message at the end.

**The deliverable is the decision, not the reading.** A research doc that does not end in rules someone can apply is waste. Every finding either lands in a rule, or moves to a numbered open question. Nothing floats.

---

## Run order

| # | Stage | Output | Runs |
|---|---|---|---|
| 0 | Repo recon | Stack facts for the agent prompts | before launch, serial |
| 1 | Claim extraction | Numbered table of checkable claims | before launch, serial |
| 2 | Scope with the owner | 3–4 questions, answered | before launch, blocking |
| 3 | Parallel research | 5–7 agent reports | parallel, background |
| 4 | Repo audit | Numbered findings with file:line | **during** stage 3 |
| 5 | Contradiction sweep | Reconciled values, quarantine list | after stage 3 |
| 6 | Thesis | One sentence that resolves the source's own contradiction | serial |
| 7 | Spec | Design-system section + research doc | serial |

Stages 0–2 are the whole game. A generic agent prompt returns a reading list; a prompt that names this repo's actual stack returns binding constraints.

---

## 0 — Repo recon (before you write any prompt)

Ten minutes, Bash only. Find:

- What the repo **already ships** in this area: the tokens, the components, the rules, the file that owns it.
- The **real runtime**: framework and version, the renderer (in this repo: Tauri v2 → WKWebView on macOS, a Chrome extension, a static site — three different engines running the same tokens), build step, dependencies you are not allowed to add.
- Which docs claim authority, and where they contradict each other.
- The dated decisions that are **closed** (`CLAUDE.md` "Out of scope") so no agent researches a direction that is already refused.

Write these into the agent prompts verbatim. In the motion run of 2026-10-23 the single most valuable finding in the whole exercise — that a Tauri WKWebView on macOS is capped at 60fps, so the design must not depend on frame rate — existed only because one prompt named the stack instead of asking about "web animation performance".

## 1 — Claim extraction

Read the source once and reduce it to a **numbered table of falsifiable claims**: what it asserts, who it attributes it to, what number it gives. Ten to fifteen is typical for a 20-minute talk.

Drop the rhetoric and keep the checkables. "Animations make tech approachable" is not a claim; "Apple asks developers to draw their first frame within 400ms" is.

This table becomes agent 1's entire assignment, and it is what makes the run honest rather than flattering.

## 2 — Scope with the owner

Ask **before** spawning, in one `AskUserQuestion` call, never more than four questions. The four that matter:

1. **Deliverable** — research doc only, doc plus a design-system section, or doc plus working implementation? Offer the middle one as the default and say which you recommend.
2. **Depth** — the source's own territory, or past it into platform internals and adjacent fields? Say what "past it" would actually cover so the choice is informed.
3. **The position** — the dial the spec will have to land (how restrained, how warm, how opinionated). Always include a "you tell me, with evidence" option, and if they pick it, the thesis stage owes them a recommendation with reasoning.
4. **Surfaces or scope** — which parts of the product this pass governs.

Do not ask what you can read. Do not ask permission to proceed.

## 3 — Parallel research

Five to seven agents, `sonnet`, background, launched in consecutive calls. The orchestrator stays on the strong model: it owns the thesis and the spec, which is the part that cannot be delegated.

**Standard agent set.** Adapt the names, keep the roles:

| Agent | Role |
|---|---|
| 1 | **Claim checker.** The stage-1 table, one by one, primary sources only. Required to say which claims are wrong or overstated. |
| 2 | **Craft and theory.** The real numbers: published tokens, formulas, the maths, the parameter tables. |
| 3 | **Accessibility and standards.** Spec text, conformance levels, the research literature, the population affected. |
| 4 | **Competitive teardown.** What shipped products actually do, measured where anyone published it. |
| 5 | **Stack owner.** "What does all of this mean on *our* runtime?" Named versions, named engines, named files. **Never omit this agent** — it is where generic research turns into a constraint. |
| 6 | **Adjacent field.** The thing the source never mentions but the product needs (for the motion run: motion in agentic/LLM interfaces, and honest latency). |
| 7 | Optional second teardown or second stack pass when either came back thin. |

**Every prompt carries the four clauses in [`agent-prompt.md`](agent-prompt.md) verbatim** — tag vocabulary, corrections-as-deliverable, exclusive scope, format. That file also records why each one is mandated: in the 2026-10-23 run, agents left free to choose invented three tag schemes and two of them researched the same sources.

## 4 — Repo audit, during the wait

Agents run for one to three minutes. That serial time is free — use it on the audit, which only the orchestrator can do well because it feeds the spec directly.

Produce numbered findings with `file:line`, written to the scratchpad as you go. Look for, in this order:

1. **Tokens** — how many, where defined, and whether one token is doing several jobs.
2. **Drift** — the same token redefined on other surfaces. Check every surface; they fork quietly.
3. **The accessibility or safety path** — hand-written per rule, or driven from one switch?
4. **Live violations of the system's own stated rules.** These are the most useful findings and they are always there.
5. **Dead or superseded files still imported.**
6. **Near-duplicates** — four keyframes that do the same thing, three helpers with one behaviour.
7. **What is missing entirely** — the product's real state changes that nothing handles. Usually the headline.

Then ask the question that gives the audit its point: **is the budget pointed at the right things?** The motion run's finding was that effort went to decoration while the product's own state changes went unhandled. That inversion, not any individual defect, was the result.

## 5 — Contradiction sweep

**The stage that was missing from the 2026-10-23 run.** Do not skip it. Agents contradict each other and sometimes flag their own numbers as suspect, and whoever writes the spec will otherwise pick one at random.

1. Collect every number two agents both reported. Where they disagree, either resolve it with one fetch or mark it `[?]` and keep it out of the spec.
2. Collect every number an agent flagged as doubtful about its own answer. Treat a self-flagged value as `[?]`.
3. Collect every claim attributed to a named person that only appeared in a third-party summary. Attribute it to nobody, or drop it. Two rules widely credited to a named engineer in the motion run were in no post of theirs.
4. **Quarantine, never delete.** Unverified items go to a numbered "open questions" section with what it would take to settle each. That section is the spec's honesty record, and it is what makes the verified parts trustworthy.

A one-agent pass is enough, given the reports. Do it yourself if the reports are in context.

## 6 — Thesis

Research does not become a spec by summarizing. It becomes a spec when something **resolves the source's own internal contradiction**, and good source material always has one.

The method:

1. Find where the source argues against itself. (Motion run: rule 2 is "copy nature", rule 3 is "nature is too slow, don't".)
2. Find the vague term doing the damage. (`nature`.)
3. Replace it with the specific thing **this product** is made of. (This product is a notebook, so: paper. A pen mark is the fastest event there is; only the ink drying is slow.)
4. State it in one sentence. (*Paper is a fast medium with a slow settle.*)
5. Check what falls out for free. A real thesis settles open questions you did not aim it at — that one decided the personality dial, ruled out springs, and justified speed as faithfulness instead of compromise.

If the one sentence does not make at least two downstream decisions obvious, it is a summary, not a thesis. Keep looking.

## 7 — Spec

Two files, always both:

**The research doc** — `docs/research/<topic>-<YYYY-MM-DD>.md`. Thesis first. Then the source's claims with verdicts. Then the findings by area, tagged, every row sourced. Then the repo audit. Then **why each spec decision was made, one line each**. Then open questions. Someone must be able to reopen a decision in a year without redoing the research.

**The system section** — in the design system, not in the research doc. Rules only, written as instructions:

- A **decision rule** first, so "does this apply here?" has an answer that is not taste. Make it mechanical and write the threshold down.
- A **token block**, copy-pasteable, with the comment that says what each token is for.
- A **per-surface table** of what applies and what does not. Any item not in the table comes out — say that.
- An **engineering-rules** subsection with the budgets and the allow/deny list.
- A **prohibition** list for the things research shows *work* but the product must not do. Write these down precisely because the evidence is on their side and someone will propose one later.
- A **debts** subsection: what is in the tree today that the new rules contradict, with `file:line`. This is the work queue, and it is why the spec ships without an implementation.

Then wire it up: a pointer line in `CLAUDE.md`, a pointer from the section the spec supersedes, and an amendment note in any dated handoff doc the spec now governs. Add the acceptance criteria to the existing acceptance test rather than inventing a second one.

---

## Failure modes seen in practice

| Failure | Fix |
|---|---|
| Agents each invent a confidence scheme | Mandate the four tags verbatim in every prompt |
| Two agents research the same blog | Exclusive scopes, named, with the expected overlap called out |
| Generic research, no binding constraints | Stage 0, and the stack-owner agent, with real versions named |
| Contradictions reach the spec | Stage 5, and it is not optional |
| A number traced to a person who never said it | Attribute only to a source read this session |
| Research doc with no rules in it | Every finding lands in a rule or an open question |
| Flattering the source | Corrections are a required deliverable; expect half the claims to be overstated |
| Thesis is a restatement | It must decide two things you did not aim it at |
| Spec arrives with the implementation half-done | Debts list with `file:line`; ship the spec, queue the work |
| Chat full of research narration | 3–8 words between stages |

## Boundaries

Do not research a direction `CLAUDE.md` has closed, and do not reopen one because the source material is enthusiastic about it. Note it as a confirmed boundary and move on.

Do not let a source's commercial interest pass as evidence: a vendor blog, an agency case study and a marketing page are `[2°]` at best, and the figure in a sponsor segment is not a finding.

Never commit unless the owner asks in that session.
