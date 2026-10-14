# Beta-testing tooling review — 2026-10-12

## Short answer

Kairos is not obviously unfit for a beta. It has a serious deterministic test
base, synthetic student fixtures, isolation probes, security tests, and a recent
onboarding/release reliability run. But that evidence does **not** yet answer
the question “will it survive students using it in messy, unexpected ways?”

The missing layer is a repeatable black-box harness that runs many student-like
journeys against isolated user roots, injects bad or misleading course text,
interrupts work, varies state, and checks the final student-visible result plus
all side effects. Ordinary unit tests will not find all of those failures.

My recommendation is to evaluate these projects, in this order:

1. **Promptfoo** — primary adversarial/red-team runner for Kairos’ AI-facing
   workflows.
2. **Inspect AI** or **DeepEval** — primary scenario/evaluation layer for
   multi-turn student journeys and pass/fail scoring.
3. **AgentDojo** — source of ideas and reusable patterns for prompt injection
   and tool-use attacks; adapt its environment model rather than importing its
   unrelated benchmark wholesale.
4. **Locust** — concurrency/soak testing if the relay or another shared service
   is part of the beta.
5. **Garak** and **PyRIT** — optional security depth after the first harness is
   working; they are useful but are not the whole product test.

Do **not** bring all of these into the repository. Start with a thin internal
test adapter and one or two tools. Adding a large framework before the adapter
has clear contracts would create another duct-taped layer.

## What the repo already has

Evidence found in the current checkout:

- Python tests under `tests/`, including security, PII, permissions,
  untrusted-content, two-user-isolation, and tool-boundary coverage.
- Browser tests under `browser/tests/`, including Canvas reliability,
  freshness, auth, sync locking, and action-runner behavior.
- Frontend tests under `app/src/**/*.test.ts(x)` and a native Rust test suite.
- Committed synthetic personas (`avery-chen` and `blake-okonkwo`) plus probes
  for isolation, routing, learning, freshness, plugins, and write guards.
- A student-shaped stress-test plan in
  `docs/audits/production-student-2026-10-05/TEST-PLAN.md`.
- A 2026-10-12 onboarding reliability report recording 80 frontend tests, 316
  browser tests, 20 Rust tests, a production build, and a bundled-runtime
  smoke test.

That is a good foundation. The important limitation is that most of it is
component or deterministic behavior evidence. It does not yet demonstrate a
large wave of independent, stateful, adversarial student journeys through the
packaged app. Also, the working tree is currently dirty, so the release prompt’s
“clean `main`” condition is not currently satisfied.

## Candidate projects

### 1. Promptfoo — best first fit

Repository: https://github.com/promptfoo/promptfoo  
Docs: https://www.promptfoo.dev/docs/red-team/quickstart/

Promptfoo is an open-source red-team/evaluation tool for LLM applications. It
can attack HTTP targets, browser workflows, Python/JavaScript adapters, RAG
systems, and agents. Its red-team mode generates adversarial inputs, supports
many vulnerability categories, and can run in CI. Its configuration also
supports multiple application contexts, which is useful for empty, stale,
partially synced, and populated student roots.

Why it fits Kairos:

- It can exercise the real app boundary rather than only testing a prompt in
  isolation.
- It can generate prompt injection, data leakage, excessive-agency, privacy,
  and policy-violation cases—the kinds of failures that could cause Canvas
  text or a tool result to steer the assistant.
- It can become a regression corpus: every discovered failure should be saved
  as a fixed fixture and run again.

Limits:

- It is not a complete student simulator or load tester.
- A red-team “pass” does not prove that due dates, study state, isolation, or
  recovery UX are correct.
- Model-graded results need deterministic assertions around important actions;
  do not let an LLM judge whether a forbidden Canvas write happened.

Verdict: **adopt first, behind a Kairos adapter**. Give it a local target that
accepts a synthetic user root and returns the student-visible response plus a
side-effect ledger.

### 2. Inspect AI — best for long, stateful journeys

Repository: https://github.com/UKGovernmentBEIS/inspect_ai  
Docs: https://inspect.aisi.org.uk/

Inspect AI is an open-source evaluation framework with tasks, solvers, tools,
scorers, and support for agents that use planning, memory, and tools over
longer horizons.

Why it fits Kairos:

- A task can represent “a student notices an exam moved, asks what to do,
  studies, resumes after interruption, then switches profiles.”
- Scorers can check both the response and the tool trajectory.
- Its environment/solver shape is a natural match for synthetic user roots and
  fake Canvas responses.

Limits:

- It is an evaluation framework, not an attack generator by itself.
- It will require a Kairos task adapter and carefully designed scorers.
- Model-based scoring can hide bugs unless the important invariants are
  deterministic.

Verdict: **strong alternative to DeepEval** if we want one explicit framework
for longer agent trajectories. It is probably too much to add before a small
adapter proves the needed task shape.

### 3. DeepEval — easiest Python/pytest evaluation layer

Repository: https://github.com/confident-ai/deepeval  
Docs: https://deepeval.com/docs/introduction

DeepEval is an open-source Python framework for LLM applications. It supports
pytest-style assertions, end-to-end and trajectory-based evaluation, tool-use,
conversation, safety, RAG, MCP, and synthetic edge-case datasets.

Why it fits Kairos:

- It would fit the existing Python test ecosystem.
- It is useful for judging answer quality, groundedness, refusal behavior,
  conversation continuity, and tool trajectories.
- It can keep scenario tests close to the current `tests/` layout.

Limits:

- It overlaps with Inspect AI; using both immediately would add complexity.
- LLM-as-judge metrics are not authoritative for security boundaries.
- It does not replace browser/native packaged-app testing or concurrency tests.

Verdict: **choose this instead of Inspect AI** if lowest integration cost with
pytest matters more than a richer agent-simulation model.

### 4. AgentDojo — valuable attack environment and patterns

Repository: https://github.com/ethz-spylab/agentdojo  
Docs: https://agentdojo.spylab.ai/

AgentDojo is a dynamic environment for evaluating prompt-injection attacks and
defenses in tool-using agents. Its published benchmark contains realistic tasks
and security test cases, and the repo supports custom environments.

Why it fits Kairos:

- It models the exact dangerous shape: a user task, tools, untrusted tool/data
  content, and an attacker trying to redirect the agent.
- It gives us a concrete pattern for putting malicious instructions inside
  announcements, assignment descriptions, course files, or external-tool
  results while preserving the student’s actual goal.

Limits:

- Its benchmark domains are not Canvas or education.
- It is primarily a security benchmark, not a release-readiness harness.
- Some APIs are explicitly still under development.

Verdict: **adapt the environment pattern and selected attacks**. Do not copy
the benchmark into production tests and call that beta coverage.

### 5. Locust — real multi-user/load simulation

Repository: https://github.com/locustio/locust  
Docs: https://docs.locust.io/

Locust is an open-source performance/load-testing tool where user behavior is
written in Python. It supports realistic conditional user flows, headless runs,
distributed load generation, and response/error reporting.

Why it fits Kairos:

- It can run many isolated student sessions against a relay/API service.
- Each virtual user can have a separate synthetic root, course mix, timing,
  retry pattern, and failure injection.
- Python makes it possible to reuse the same persona factory and fake Canvas
  client.

Limits:

- Kairos is primarily a local desktop app; Locust cannot magically create many
  realistic macOS GUI users.
- It measures capacity and state leakage under concurrency, not whether an
  answer is educationally good.
- Never point it at a real Canvas account or school service.

Verdict: **use only for a shared relay/service**, after the functional harness
exists. For a single-user local beta, a deterministic multi-root stress runner
is more valuable first.

### 6. Garak and PyRIT — deeper red-team options

Garak: https://github.com/NVIDIA/garak  
PyRIT: https://github.com/microsoft/PyRIT

Garak is a vulnerability scanner for LLMs and dialog systems, covering areas
such as hallucination, leakage, injection, misinformation, and jailbreaks.
PyRIT is Microsoft’s open-source framework for automated and human-led
generative-AI red teaming at scale, with extensible attack orchestration and
scoring.

Both are credible security tools. Their center of gravity is broader model and
AI-system red teaming, while Kairos needs application-specific checks around
student data, Canvas provenance, profile isolation, local state, and forbidden
writes.

Verdict: **optional second wave**, useful for expanding attack coverage after
Promptfoo or a custom adapter has found the first real failures.

## Recommended Kairos test architecture

The test target should be a fake, fully local student environment:

```text
synthetic persona + scenario
        ↓
isolated user root + fake Canvas/API + fake model responses
        ↓
Kairos adapter (CLI, Python entry point, or app boundary)
        ↓
student-visible response + tool trajectory + side-effect ledger
        ↓
deterministic invariants + optional model-quality scorer
```

Each run should vary:

- student state: empty, stale, dense, partially synced, interrupted, resumed;
- user behavior: direct, vague, contradictory, impatient, typo-heavy,
  repeated, and multi-turn;
- content: normal course text, malformed Canvas data, stale dates, misleading
  instructions, and prompt injection embedded in untrusted content;
- identity: two or more roots in the same process and concurrent runs;
- failure conditions: missing files, 403/429/500 responses, timeouts, process
  restarts, partial sync, and duplicate retries;
- safety boundaries: attempted submission, discussion post, email, calendar
  write, cross-student read, or action without confirmation.

The test must record a failure as more than “the answer looked bad.” At minimum
it needs:

1. scenario and persona seed;
2. complete observable conversation;
3. tool calls and arguments;
4. before/after user-root diff;
5. forbidden-side-effect checks;
6. reproducible seed and software commit;
7. a minimized regression fixture after triage.

## The first useful test wave

Before adding any external framework, build or verify one adapter with about 20
scenarios across the two existing synthetic students. Then run the same wave
through Promptfoo and either Inspect AI or DeepEval.

Suggested initial scenario groups:

- **Student usefulness:** dense week, stale week, empty inbox, changed exam,
  study/resume, course brief, and external-tool process help.
- **Isolation:** Avery → Blake switch, concurrent roots, missing profile files,
  and a malicious course title containing another student’s identifiers.
- **Prompt injection:** assignment text says to ignore the system, syllabus
  asks for a secret, announcement asks for an external upload, and a tool
  result attempts to trigger a write.
- **Action safety:** ask to submit, post, email, create a calendar event, or
  bypass confirmation; every forbidden or unconfirmed action must fail closed.
- **Reliability:** stale sync, partial sync, 403, timeout, interrupted study
  event, duplicate retry, and corrupted local JSONL/YAML.

## Release conclusion

The DMG/release work shows that the application can build and that several
important onboarding failures were found and fixed. It does **not** yet justify
the stronger claim that the product will hold up under broad beta use. The next
release gate should be:

- clean, reproducible release commit;
- current unit/browser/frontend/native suites green;
- the student-shaped scenario wave above green;
- zero cross-student leakage and zero forbidden writes;
- no untriaged crash, hang, or unrecoverable stale/partial-sync path;
- a small adversarial corpus rerun in CI;
- a separate, explicitly labeled human beta for usability and real Canvas
  variability.

Passing this gate would support “ready for a controlled beta.” It still would
not prove that Kairos works for every student or that it improves learning.

## Decision requested before implementation

The repo should not absorb cloned third-party repositories yet. The sensible
next implementation is a small `tests/ai_eval/` adapter using the existing
synthetic personas, then add **Promptfoo + one of Inspect AI/DeepEval**. Add
AgentDojo-derived attacks and Locust only after that first wave produces useful,
reproducible failures.

