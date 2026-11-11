# Run protocol: can feeds carry freshness alone? — 2026-10-26

**Status: open — the measurement has not been run.** Blocks launch.

The Chrome extension is parked (`app/extension-chrome/README.md` § Status).
That leaves tokenized feeds plus the 2 h canonical sync carrying continuous
freshness alone. This is the run that proves they can, and it **blocks launch**
until it passes.

## The question

Does any **announcement** or **due-date move** reach the student only through
the canonical sync's snapshot diff, and never through a feed?

A sync-only announcement or due-date move means feeds have a coverage hole —
not a latency gap — and the extension or a shorter sync cadence is back on the
table. Grades and instructor comments are **out of scope**: feeds never carried
them, the 2 h sync does, and the 5-minute version was the extension's only
unique contribution.

## Why it needs measuring rather than reasoning

From [`freshness-extension-spike-2026-09-29.md`](freshness-extension-spike-2026-09-29.md):
feed ETags are present but `If-None-Match` always returns 200, so **every poll
is a full download**. Announcement feeds run every 10 min and course/ICS feeds
hourly. That is a real daily byte cost nobody has measured over a week, and the
feeds are bearer links whose failure modes (token reset, enrollment change) only
show up over time.

## How to run it

1. **Uninstall the extension** from Chrome, so no delta path can mask a feed
   hole. Confirm with `deltas_processed: 0` in the watch log.
2. Leave the Mac app running for **7 consecutive days** mid-term, when
   professors are actually posting. The daemon calls the tick every 2 min; the
   tick writes one row per poll to `{user_root}/inbox/freshness/feeds-watch.jsonl`
   (self-trimming to 30 days). Without the app:
   `cd browser && npm run freshness -- --loop 120`.
3. Read it any time:

   ```bash
   cd browser && npm run feeds-report          # human summary
   cd browser && npm run feeds-report -- --json
   ```

## Pass criteria

| Measure | Pass | Where |
|---|---|---|
| Announcements caught by feed | every one the sync also found | `coverage.announcement.sync === 0` |
| Due-date moves caught by feed | every one the sync also found | `coverage.due_changed.sync === 0` |
| Feed error rate | < 5% of polls | `error_rate` |
| Daily download | recorded, and sane on a phone hotspot | `mb_per_day` |
| Window | ≥ 7 days | `window.days` |

`launch_blockers` is non-empty and `verdict` says so when a coverage hole shows
up. An error rate above 5% is not a blocker by itself — look at what failed
(a reset token needs a re-sync to re-capture; a 404 means an enrollment ended).

## What the result decides

- **Clean week.** Feeds carry freshness. The extension stays parked and the
  Web Store decision can be taken on distribution grounds alone.
- **Coverage hole.** Name the kind and the feed class that missed it. The
  cheapest fix is likely a shorter sync cadence for that slice, not thawing the
  extension — decide with the numbers in hand.
- **Byte cost too high for a student on a hotspot.** Lengthen the announcement
  cadence (`FEED_CADENCE_MS` in `browser/scripts/lib/canvas-feeds.mjs`) and
  re-run. A longer cadence trades latency, not coverage.

## Instrumentation added for this run

| Piece | Where |
|---|---|
| `bytes` + `ms` per poll | `browser/scripts/lib/canvas-feeds.mjs` (`fetchFeed`, `polled` rows) |
| `feed_bytes` + `feed_ms` on the tick result | `browser/scripts/lib/freshness-run.mjs` |
| Watch log append + 30-day trim | `browser/scripts/lib/freshness-store.mjs` (`appendFeedsWatch`, `readFeedsWatch`) |
| Report + pass criteria | `browser/scripts/feeds-report.mjs` (`npm run feeds-report`) |
| Tests | `browser/tests/freshness.test.mjs` → "feeds-only measurement" |

The log is measurement, not product state: nothing reads it at runtime, a
failure to write it never fails a tick, and it holds no feed URLs or tokens —
only counts, bytes, and feed classes.

## Write-up

When the week is done, record the numbers and the verdict as
`docs/handoff/feeds-only-freshness-<date>.md` and update this file's status.
