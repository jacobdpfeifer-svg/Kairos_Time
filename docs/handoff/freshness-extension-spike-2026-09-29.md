# Decision: always-fresh Canvas via extension + feeds — 2026-09-29

**Signed by Jacob in conversation on 2026-09-29** (all three decisions below;
built 2026-09-29/30). Written from live tests against CU Boulder Canvas
(read-only GETs) and a local mock. Amends the extension README's
"sensors only" rule and adds a Canvas-page surface beside the 2026-09-18
desktop-only direction; the desktop app stays the brain and home.

Does not reopen the canvas-focus pivot
([`canvas-focus-pivot-2026-09-11.md`](canvas-focus-pivot-2026-09-11.md)):
everything Canvas-visible stays preview-only; "agent can do" means the
student's own logistics, never the graded item.

## Question

Can the product notice Canvas changes continuously — not only when the app
opens — and should the product move into a Chrome extension that lives on
the Canvas page (the Better Canvas pattern)?

## What was tested and what happened

### CU Canvas (live, read-only)

| Test | Result |
|---|---|
| Saved Playwright session after 7 idle days | Still valid (`check-session` → `loggedIn: true`) |
| Cookie lifetimes | `canvas_session` (SameSite=None), `log_session_id`, `_csrf_token`, and the fedauth IdP cookies are all **session cookies** (no expiry) |
| `GET /api/v1/users/self/activity_stream/summary` | 153 ms, `X-Request-Cost` 0.036 of a 700 bucket. Counts per type: Announcement 75 (72 unread), Submission 82 (33 unread), Message "Due Date" 34 |
| Weak ETag on the summary | Present, but `If-None-Match` still returns 200 — no cheap 304; the body is tiny anyway |
| Full activity stream (100 items) | 5.8 s, cost 5.2 — too expensive to poll; fetch only after the summary changes |
| "Due Date" messages | Split between "Assignment Created" and "Assignment Due Date Changed" (8 / 8 in the last 100 items) — Canvas itself reports due-date moves |
| Planner items (4-week window) | 1.1 s, 99 items, `new_activity` flag on 31, `plannable.updated_at` present |
| Assignment `updated_at` as an edit signal | Useless: 73 of 75 assignments in one course were touched more than 1 h after creation. Edits must be detected by diffing `due_at` / points / description hash against the stored snapshot |
| Announcement volume | 23 announcements in the last 7 days across 7 courses (6, 6, 5, 2, 2, 1, 1); average 699 characters |
| Notification email channel | Canvas mail goes to the colorado.edu address (announcements and grading "immediately", due dates "weekly"). None reaches the connected personal Gmail — no email layer without CU mail access |
| Dashboard page CSP | Only `frame-ancestors` — nothing blocks content-script UI or extension iframes |
| Injecting into the real dashboard | Nodes prepended into `#dashboard` and `#content` survived 12 s of Canvas's own render; `#DashboardCard_Container` and the right-side to-do are stable anchors |
| Full canonical sync (Playwright) | 83 s end to end, 8.1 MB raw, 10 courses |

### Tokenized feeds (fetched with no cookies, as a background or server worker would)

| Feed (source) | Result |
|---|---|
| Calendar ICS (`/api/v1/users/self/profile` → `calendar.ics`) | 200, 469 KB, 6.5 s, 238 events (198 assignments, 28 calendar events, 12 overrides) |
| Per-enrollment announcements Atom (course announcements page) | 200, 2–44 KB, 0.2–1.2 s, full announcement body in each entry |
| Per-enrollment course Atom | 200, 90–550 KB — assignments, pages, discussions, calendar events with `<updated>` timestamps |
| Per-course forum Atom | 200; discussion entries where the course uses discussions |
| User Atom | 200, 810 KB, 6.8 s — assignments and pages across all courses |
| Conditional GET on any feed | ETag present, but `If-None-Match` always returns 200 — every poll is a full download |

Feed URLs are bearer links: anyone holding one can read that stream until
the token is reset. They are **not** session keys (no write path, no grades,
no submission access).

### Chrome extension mechanics (local mock that sets Canvas's exact cookie attributes)

Copying the real saved login for this test was blocked by the session's
permission check, so the extension ran against a localhost mock that sets
`canvas_session` (SameSite=None; Secure; HttpOnly) plus the two Lax cookies.

| Test | Result |
|---|---|
| MV3 service-worker `fetch(..., {credentials: "include"})` with host permission, **no Canvas tab open** | All three cookies sent, including the SameSite=Lax ones (`Sec-Fetch-Site: none`) |
| Signed out | Clean 401 `{"status":"unauthenticated"}` — a reliable "needs sign-in" signal |
| `chrome.alarms` over 100 s, no pages open | Fired every 30 s, all signed in; a new mock announcement was detected as a change |
| Native messaging → existing `app/native-messaging/host.py` | Round trip OK; delta rows written to `{user_root}/sensors/chrome.jsonl` (Chromium reads the host manifest from `<user-data-dir>/NativeMessagingHosts`) |
| `host.py` under system `python3` | **Fails**: `canvas_mcp/__init__` imports `fastmcp`. Works only through the project venv; the installed shebang (`/usr/bin/env python3`) will break on student machines |
| Shadow-DOM dashboard card | Rendered and live-updated from `chrome.storage.onChanged` |
| `chrome.sidePanel` | Available |

Not tested (needs the student's real Chrome): whether the Canvas session
survives a full Chrome quit. Every Canvas and IdP cookie is a session
cookie, so a real Chrome without "Continue where you left off" likely drops
them on quit. The extension then shows "signed out" until the next Canvas
visit, while feeds keep working.

### Reliability bug found and fixed

Every real sync since 2026-09-22 ended `complete: false` because
`/courses/128820/discussion_topics` (CU Student Government hides
Discussions from students) answers 403 `{"status":"unauthorized"}`.
`last_complete_sync_id` was never set. Fixed in
`browser/scripts/lib/canvas-snapshot.mjs`: a permission 403 on a per-course
sub-resource is recorded under `manifest.unavailable_endpoints` (surfaced by
`summarize_sync_health`) instead of failing the sync. Throttle 403s
("Rate Limit Exceeded", plain text) still fail. Tests:
`browser/tests/canvas-reliability.test.mjs` ("records a tab hidden from
students…", "still fails a throttled 403"). Verified live against CU into a
scratch user root: `complete: true`, `state: fresh_complete`,
`unavailable_endpoints: [discussions:128820 (403)]`.

### Hosted AI cost at the measured volume

About 40–50 change events per student per week (23 announcements, plus
due-date changes, new assignments and grades). Triage at roughly 3k input
and 300 output tokens each:

- Claude Sonnet 5.5 ($2 / $10 per MTok, cache reads $0.20): about $0.009
  per event uncached, about $0.0045 with the stable USER.md and rubric
  prefix cached. That is **about $1–2 per student per month** for always-on
  triage.
- A daily brief (about 20k in, 2k out) adds about $1.80 per month.
- Interactive study sessions are extra and depend on use.

AI cost does not decide whether to host. Holding student data does.

## Recommendation

Three layers, each covering the others' blind spots:

1. **Extension = sensor + surface.** Every 5 min, `chrome.alarms` polls the
   activity-stream summary with the student's own session (GET-only
   wrapper, path allowlist). On change it sends the delta to the daemon
   over native messaging. On 401 it shows a "sign in to Canvas" state. The
   student's own Canvas use keeps the session renewed, so the extension
   becomes the primary fresh path. Playwright becomes bootstrap and
   deep-sync only.
2. **Feed watcher in the daemon (no session).** Capture feed URLs once
   during a sync into `{user_root}/auth/feeds.json` (0600, never exported).
   Poll announcement feeds every 10 min (about 150 KB) and course and ICS
   feeds hourly. This keeps working when Chrome is closed or the session
   has died, and it is what makes "never stops looking" true for
   announcements and due dates.
3. **Targeted delta sync.** On a change signal, fetch only the affected
   slice (announcements, planner window, submissions for the changed
   course) instead of the 83 s full sync. The full sync stays on the
   daemon's 2 h / 6 h cadence. Edits are detected by diffing against the
   canonical snapshot, never by `updated_at`.

Surface, in Canvas:
- A **dashboard card** over Canvas's own dashboard (shadow DOM, Living
  Instrument tokens) with three columns: **What changed**, **Next step**,
  **Agent can do** (logistics only).
- An **announcement digest** that extracts action items. 72 of 75
  announcements are unread, so the "professor keeps posting" problem is
  measurable.
- A **side panel** on assignment pages: rubric as a checklist, the
  announcements that mention it, the plan, and the cost of skipping it.

Hosted brain: defer. Build the event → triage → card pipeline so it can run
locally now and move to a server later without a rewrite. Revisit after the
beta shows whether the desktop install is the drop-off point.

## Amended 2026-10-26 — the extension is parked

Signed decision 1 below stands as a decision; the extension is **not in the
v1 install path**. It cannot ship without a Chrome Web Store listing, and
layer 2 (tokenized feeds) plus the canonical sync cover every change kind it
detects except grades and instructor comments, where they trade 5-minute
latency for up to 2 hours. Decisions 2 and 3 are untouched. Status, thaw gate,
and what was deleted: `app/extension-chrome/README.md` § Status.

## Signed decisions

1. **The extension is a product surface** that makes read-only Canvas API
   GETs with the student's own session — four allow-listed endpoints, no
   method parameter, no CSRF token, enforced by
   `browser/tests/extension.test.mjs`. It shows a stage on the Canvas
   dashboard and a side panel on assignment pages.
2. **Tokenized feed URLs are stored locally as secrets** in
   `{user_root}/auth/feeds.json` (0600, outside `inbox/`, so never exported).
   Watcher state keys are URL hashes, so no token is repeated elsewhere.
3. **Hosting stays deferred.** The decision gate and what the beta must
   measure are in
   [`hosting-decision-criteria-2026-09-30.md`](hosting-decision-criteria-2026-09-30.md).

## As built (2026-09-30)

| Piece | Where |
|---|---|
| Shared pure modules (action extraction, change classifier, feed parsers, change rows + digest) — same code in the brain and, vendored, in the extension | `browser/scripts/lib/freshness/*.mjs` → `app/extension-chrome/shared/*.js` via `app/extension-chrome/tools/vendor-shared.mjs` (drift test in `browser/tests/extension.test.mjs`) |
| Feed capture (weekly, during the canonical sync) + watcher (10 min announcements, 60 min course/ICS; first look is a baseline) | `browser/scripts/lib/canvas-feeds.mjs` |
| Snapshot diff: due moved, points changed, instructions edited, assignment added | `browser/scripts/lib/canvas-changes.mjs` |
| Cost of skipping, via the grade-truth engine's what-if, renormalized over graded groups like Canvas's current grade; `share_of_final` only for weighted courses it can calculate | `browser/scripts/lib/skip-cost.mjs` |
| Dashboard view model (next step, changes, digest, agent-can-do = calendar suggestions only) | `browser/scripts/lib/freshness-dashboard.mjs` → `{user_root}/inbox/freshness/dashboard.json` |
| Tick (deltas + feeds → events → dashboard) and post-sync hook | `browser/scripts/lib/freshness-run.mjs`, `browser/scripts/freshness-tick.mjs` (`npm run freshness`), called from `sync-canvas-canonical.mjs` |
| Daemon loop every 2 min, `freshness-updated` event, `read_freshness` command | `app/src-tauri/src/{daemon,canvas,commands,main}.rs` |
| Native host, stdlib-only (system `python3` 3.9), message types `canvas_delta`, `canvas_signed_out`, `get_dashboard`, `get_assignment_context`, `queue_calendar_suggestion`, `ping` | `app/native-messaging/host.py`; installer copies it to `~/Library/Application Support/Kairos/native-host/` because Chrome-launched processes cannot read iCloud Drive ("Operation not permitted", found in the e2e run) |
| Extension v1: 5-min summary poll, delta fetch on change, 401 badge, extension-only fallback (changes + digest without the app), Canvas dashboard stage, assignment side panel, beta funnel | `app/extension-chrome/` |
| Desktop Home "Changed" ledger | `app/src/components/ChangesLedger.tsx` in `HomeView` |
| End-to-end harness: mock `https://canvas.colorado.edu` (self-signed, host-resolver mapped) → extension → real native host → real tick → back; fixture dates shifted to today | `node app/extension-chrome/tools/e2e-mock-canvas.mjs` (24 checks, all passing 2026-09-30) |

Differences from the recommendation above: the brain classifies extension deltas
directly (the extension ships the changed slice), so no separate targeted
Playwright sync was needed; the extension also classifies locally so it is
useful before the desktop app is installed.

Not yet verified: whether the Canvas session survives a full quit of a
student's real Chrome (every Canvas and IdP cookie is a session cookie).
The extension shows "signed out" and the feeds keep working either way.
