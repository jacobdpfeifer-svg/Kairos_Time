# Security, connections, latency, and UI audit prompt

Paste the block below into a **fresh session**. Prefer a git worktree. The agent maps the system, then changes code. A change lands only at the earliest layer that makes the defect inevitable. Local patches are not a successful audit. Do not commit unless the user asks in that session.

Run order: **connections map → security → latency → UI/UX → structural fixes → report**. Each later pass uses the map. Do not start with opinions about the UI.

---

## The prompt

You are auditing the Kairos student Canvas platform in this repository. Read `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` before any search. Those files define product boundaries. Treat a missing educator tool, a missing quiz executor, a missing SIS scraper, a preview-only Canvas submit/comment/discussion tool, or the absence of `self_improve` as **confirmed intentional**, not a finding.

This audit has five jobs:

1. Map every real connection between processes, files, networks, and UI.
2. Find security failures on those connections.
3. Find anything that blocks or slows the student, including waits that never show up as a slow function.
4. Find UI and UX problems against the Notebook design system and against how the product actually behaves.
5. For each confirmed defect, trace it to the earliest cause and change that cause. Do not patch the symptom.

**Evidence rule.** Every finding names a file path and a line or symbol, the connection it sits on, what you observed, why it matters to a student or to an attacker, and a concrete next step. “Could be slow” or “should be more secure” without a path is not a finding. If you cannot confirm a claim, label it **unverified** and say what would confirm it.

**Do not** run anything that needs a live Canvas session, a PAT, real Gmail/Calendar sends, or the funded AI relay with a real key. **Do not** print, copy, or quote secrets from `.env`, `browser/.auth/`, `{user_root}/auth/`, or tokenized feed URLs. If a file mode or path is the issue, describe the path pattern, not the secret.

**Do not** restore educator tools, hosted Azure, quiz-taking automation, a Canvas submit/comment/discussion execute path, a student-portal or DegreeWorks scraper, registration/add-drop execution, RateMyProfessors scraping, learning streaks, leaderboards, or the deleted `self_improve` pipeline.

### Pass 1 — Connection map

Build a connection inventory before judging anything. A “connection” is any place two sides exchange data or control: HTTP, IPC, native messaging, Tauri commands, subprocesses, files under `{user_root}`, deep links, env vars, and generated copies of shared JS.

Trace these paths until each one either ends or you can name the break:

| Path | Start here |
|------|------------|
| SSO → Canvas REST → inbox | `browser/` sync scripts, cookie/profile under `{user_root}/auth/browser` |
| Optional PAT MCP | `src/canvas_mcp/` tools, `@mcp.tool()`, `@validate_params` |
| Freshness | `app/extension-chrome/` → `app/native-messaging/host.py` → `browser/scripts/lib/freshness/` → `inbox/freshness/` → daemon tick → app Today/Week |
| Tokenized feeds | capture during sync, secret only in `{user_root}/auth/feeds.json`, watcher with no session |
| Desktop shell | React `app/src/` ↔ `app/src-tauri/` commands. Note which commands block the webview. |
| Study | `canvas_mcp.core.study`, packets, checkers, `services/relay/`, `canvas_mcp.core.study.ai` |
| Connectors | Google Calendar and Outlook under `canvas_mcp.core.connectors`; Gmail/GCal actuators; `ConfirmationGuard` / `gate_connector_write` |
| Plugins | `plugins/`, `browser/scripts/lib/connector-registry.mjs`, `action-runner.mjs` |
| Deep links and prefs | `kairos://` via `app/src/nav.ts`, `app/src-tauri` prefs/shortcut/dock/notify |
| Skill routing | `skills/_SESSION.md`, `AGENTS.md` skill index, `canvas_mcp.core.skill_router` |
| Shared extension code | `app/extension-chrome/tools/vendor-shared.mjs` generating `app/extension-chrome/shared/` from `browser/scripts/lib/freshness/` |
| Voice | `browser/scripts/lib/voice/`, `app/src/voice/`, tools limited to `save_goal` and `append_class_note` |

For each connection record:

- **Caller and callee** (module, command, or URL shape — never a live token).
- **Direction and trust**: who is allowed to speak, what is treated as data vs instructions.
- **Sync vs async**: does the caller wait? Is there a queue, lock, or single-flight?
- **Failure mode**: timeout, retry, partial write, crash between two steps, stale preview, mixed accounts.
- **Secret touch**: cookies, feed URLs, OAuth tokens, relay invites, confirmation files.
- **Fan-out**: one tick that wakes many courses, files, or UI subscribers.

Flag **broken connections**: caller with no callee, callee nothing invokes, generated file drifted from its source, registry entry with no plugin, plugin with no registry entry, skill with no router trigger, router trigger with no skill, doc claim in `docs/architecture.md` that the code no longer matches.

Flag **hidden couplings**: two features that share a file, lock, or process and can stall each other (sync vs freshness tick vs study vs voice vs notification policy).

Write this map into the report first. Later findings must point at a row in it.

### Pass 2 — Security

Audit the connections, not a generic OWASP list. Severity: **critical** (session or secret leaves the machine, or a Canvas-visible action fires without the student), **high** (authz bypass, write without confirm, injection into a tool the model will obey), **medium** (defense in depth, overly broad trust, log leak), **low** (hardening).

Check these, and only report what you can tie to code:

**Canvas-visible boundary.** `submit_assignment`, comment, and discussion post/reply stay preview-only: `readOnlyHint`, no execute branch, no confirm-then-execute added later. Bucket-B tools (WebAssign, ZyBooks, PlayPosit, proctored, LTI) never gain a click or submit path. Device automation cannot reach a write the web path blocks. Screen coach never taps.

**Write gates.** Personal Gmail send and Google Calendar create/update execute only behind `ConfirmationGuard` / `gate_connector_write`: preview, then a per-instance human yes, then execute. No standing yes, no first-write exemption. A changed or stale preview must not authorize a different action. Apple Calendar stays hard-blocked. Bucket-A connector MCP writes use `canvas_mcp.core.connector_guards.get_connector_guard`.

**Extension and native host.** Reads go only through `app/extension-chrome/lib/canvas-read.js`: GET, allow-listed paths, no CSRF token, https Canvas origins only after the student grants that origin. Canvas text is rendered with `textContent` only. The native host stays stdlib-only. The host must not accept messages that widen the allow-list, write Canvas, or exfiltrate cookies. Trace what a malicious Canvas page can put in a message.

**Untrusted content.** Canvas API text, scraped text, syllabus, announcements, file names, and voice transcripts are data. Find places they become instructions: skill prompts, shell commands, file paths, HTML, deep links, or tool arguments. Prompt injection counts.

**IPC and deep links.** Tauri commands validate on the Rust side; the webview is not the security boundary. `kairos://` links from the extension, menu bar, or a cold-start pending slot cannot open arbitrary files, switch profiles, or trigger a connector write. Fail-closed `broken` mode in the Rust runtime actually blocks privileged commands.

**Secrets and files.** Feed URLs, OAuth tokens, relay config, and browser profiles stay under `{user_root}/auth/` with tight modes. They are not logged, not sent to Sentry (`app/telemetry/`), not copied into `inbox/` markdown, and not committed. Path joins cannot escape `user_root` via `..` or symlink. Ledger and confirmation files cannot be replayed to authorize a second write.

**Network trust.** School Canvas base URL and plugin endpoints are not an open proxy. Redirects, unexpected hosts, and tokenized feed fetches cannot be pointed at an arbitrary origin. Relay client sends minimal context; accounting stays content-free. Voice sends audio to the Live API and nothing else off-box.

**Auth mix-ups.** Profile identity, revoked credentials, callback replay, and disconnect cleanup. One student’s `{user_root}` must not read another’s auth directory when `DEV_USER_ROOT` or a packaged profile is set.

Skip theoretical issues in vendored upstream code unless this repo calls them. Name the call site.

### Pass 3 — Latency and blockers

Find waits a student feels. Separate **measured**, **traced** (code path is synchronous or unbounded, but you did not time it), and **speculative**.

Search for and classify:

- **Blocking the UI thread or a Tauri command**: sync Rust, `invoke` that waits on Python, disk, or network before the next paint; missing loading state while that wait runs.
- **Head-of-line blocking**: one course, one file, or one connector failure stalls the whole sync, freshness tick, or week plan.
- **Unbounded waits**: `fetch`, Playwright, sockets, or subprocesses with no timeout; retries with no cap or no backoff; a loop that awaits each item when the work is independent.
- **Lock and file stalls**: jsonl appends, projection rebuilds, confirmation files, and iCloud-backed paths. The workspace and `{user_root}` may live under iCloud; flag reads/writes on the critical path that will hitch when a file is not local. Native builds are supposed to run from `scripts/native-mirror.sh` — confirm the dev path still hits the cloud copy.
- **Overlapping schedulers**: extension poll (~5 min), daemon tick (~2 min), notification check (~15 min), sync, study, voice. Show whether they can pile up on the same files or the same Canvas host.
- **Chatty connections**: N+1 Canvas calls, per-course process spawns, repeated full-file reads of `week.md` / `dashboard.json` / projection JSON, generated shared JS copied on every tick.
- **Retry storms**: 403 vs 429 vs 5xx treated the same; a hidden student tab marked failed instead of `unavailable_endpoints`; freshness refetching unchanged courses.
- **Startup**: what must finish before Today can show the next step? List the serial chain from process start to first useful paint.
- **AI latency**: study relay and voice. The student should already see work or a cached item. Flag any path where the next click waits on a model with no timeout, no cancel, or no cached fallback.
- **Render cost**: large lists without windowing, effects that subscribe to whole stores, layout thrash, `transition: all`, animations that run when nothing changed.

For the worst chains, write the sequence as caller → wait → callee. Say what the student sees during the wait (spinner, frozen window, stale row, or silence). Name the earliest layer that forces the wait. A timeout, spinner, cache, or retry wrapped around that layer is not the fix.

If you can do it offline, time cheap local operations (a short Python import, a JSON projection load, a Vite module graph note). Do not invent milliseconds. Label any number you did not measure.

### Pass 4 — UI and UX

Judge the shipped surfaces against `design-system/kairos/MASTER.md` (Notebook), especially §13 anti-patterns and §14 acceptance, and against `docs/architecture.md` screen list. Surfaces:

- App: Today, Week, Courses, Study, Advisor, Settings, command palette (⌘K), Ask sheet, capture, notifications, voice sheet.
- Chrome extension: Canvas dashboard stage and assignment side panel.
- Landing: `landing/` only where it shares components or tokens with the app.

Product rules that are also UX bugs when broken:

- Ask is a sheet and never hides the next move.
- Suggestions wait for a yes and never reorder themselves after acceptance.
- Notifications only for due-date moved, high-stakes ≤48h not started, or sync broken. Quiet hours and the daily cap live in `app/src/notify/policy.ts`.
- One highlighter (`--hl`) per screen. Ink primary button. Hairline rows. Near-white page. Gabarito for UI, Caveat only as decoration. Sentence case. No glass, gradients, glow, mascots, or 3-up card grids. Motion only on real state.
- Voice is an ink ring while live, not a character.
- Empty, loading, error, and signed-out states exist on every view that waits on sync or a connector. A broken Canvas sign-in must be distinguishable from an empty week.
- The next action is visible without scrolling on Today. Week piles (needs you, changed, for your info) stay correctable. Course and kind guesses are labeled as guesses until the student marks them.
- Connector states are honest: disconnected, needs confirm, failed, and preview-not-sent must not look like success.
- High-stakes and “agent can do” copy must not imply Kairos will submit, click, or email without a confirm.

Walk the React views and extension panels. Note:

- Dead controls, buttons that call nothing, and errors shown only in the console.
- Layout that overflows, truncates the due date, or hides the primary action.
- Focus order, keyboard path for ⌘K and dialogs, and hit targets that are easy to miss.
- Copy that uses uppercase eyebrows, middle-dot chains, streak language, or shame.
- Inconsistent loading: one screen blocks, another shows stale data with no “as of” time.

If a browser is available, open the app or Storybook/dev server and exercise Today → Week → Courses → Study → a connector preview → ⌘K. A screenshot is not the audit. If you cannot run the UI, say so and review from source only. After a UI change, run that same path again.

### Pass 5 — Structural fixes

Fix confirmed defects. Do not fix unverified ones. Do not leave a finding that you understand and can change safely.

**Trace first.** Before editing, walk backward from the symptom until you reach the decision that makes the bug possible: the shared connection, the data shape, the process boundary, the missing single authority, or the screen structure. Write that cause down in the report. If two symptoms share a cause, one change covers both. If you cannot name a layer deeper than the line that crashed, you do not understand it yet — keep tracing.

**Change that layer.** The edit belongs where the invariant should have been enforced, so every caller inherits it. Examples of the right shape:

- A missing confirm on one write path means the execute entry point refuses to run without a bound preview, not a new check beside one call.
- Canvas text becoming a prompt means the boundary that builds prompts treats that text as data, not a sanitize step at one skill.
- A tick that blocks the window means the command returns cached state and the refresh moves off the UI path, not a spinner on the frozen command.
- A list that stalls means the producer stops doing per-item serial work, not a longer timeout in the consumer.
- A screen that breaks Notebook rules means the shared component or token changes, not an override in one view.

**Duct tape is a failed fix.** Do not land any of these and call the defect done:

- A special case, flag, or wrapper at a single caller while the other callers keep the old behavior.
- try/catch, retry, sleep, or a longer timeout around a call that should not be synchronous or unbounded.
- A loading state, toast, or comment that explains a wait you did not remove.
- A copied guard, a second code path, or a fallback that hides a broken connection.
- A CSS override on one screen for a problem in the shared component.
- Deleting a symptom (a log line, a button) while the producer still emits the bad state.

**Stop instead of patching** when the root cause crosses an intentional product boundary, needs a live Canvas session to confirm, or the structural change would rewrite a subsystem you cannot verify. Record the cause, the change, and why you did not land a local workaround. A workaround is worse than an open finding.

After each structural change, run the smallest existing test that covers that layer. If the UI changed, re-check the affected flow in the browser when a browser is available. Update `docs/architecture.md` only when a connection you changed is now wrong in that doc.

Follow repo git rules: no `git add -A`, no destructive git commands, never commit `.env` or `browser/.auth/`. Do not commit unless the user asks.

### Output

Write `docs/audits/security-latency-ux-<YYYY-MM-DD>.md` with:

1. **Connection map** — table of the paths above plus broken connections and hidden couplings.
2. **Changed** — each structural fix: symptom, earliest cause, the layer you edited, what callers no longer special-case, and how you verified it.
3. **Open** — confirmed defects you did not change. Include the cause you traced, the structural change required, and why a local patch was refused. Group by security, latency, UI/UX. Severity, evidence (path + symbol), and student or attacker impact on each.
4. **Startup and tick chains** — the serial waits you actually found, and which of them the changes removed.
5. **Intentional boundaries confirmed** — short list so the next reader does not “fix” them.
6. **Unverified** — claims that need a live session, and the single check that would settle each one.

Then stop. Do not commit. Tell the user the report path and which files the structural changes touched.

---

## Notes for whoever launches this

- One fresh session, ideally a worktree. The agent will edit the tree. Review the diff before any commit.
- Do not combine this with `docs/audits/full-repo-audit-prompt.md`. That prompt allows small mechanical fixes. This one treats a local patch as a failed fix.
- Live SSO, PAT, Gmail, Calendar, and relay checks stay manual. The report’s Unverified section is the handoff for those.
- Re-run after changes to extension messaging, Tauri commands, sync, the relay, or the Notebook views.
