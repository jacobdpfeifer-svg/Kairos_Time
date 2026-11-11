/**
 * Summarize the feeds-only watch log: what the tokenized-feed path costs and
 * what it caught. This is the evidence for the question the parked extension
 * left open — can feeds plus the canonical sync carry freshness alone?
 *
 *   node scripts/feeds-report.mjs            # human summary
 *   node scripts/feeds-report.mjs --json     # one JSON object
 *
 * Feeds support no conditional GET, so every poll is a full download. The
 * numbers that matter are bytes/day and whether any announcement or due-date
 * move showed up only in the 2 h canonical sync.
 */
import { resolveUserRoot } from "./lib/user-root.mjs";
import { readEvents, readFeedsWatch } from "./lib/freshness-store.mjs";

const asJson = process.argv.includes("--json");
const userRoot = resolveUserRoot({ create: false });
const rows = readFeedsWatch(userRoot);

if (!rows.length) {
  const msg = "no feed polls logged yet — run `npm run freshness` (or leave the app running) and come back";
  console.log(asJson ? JSON.stringify({ ok: false, reason: msg }) : msg);
  process.exit(0);
}

const first = Date.parse(rows[0].at);
const last = Date.parse(rows[rows.length - 1].at);
const days = Math.max((last - first) / 86400000, 1 / 24);

const total = rows.reduce(
  (a, r) => ({
    polls: a.polls + (r.feeds_polled || 0),
    errors: a.errors + (r.feed_errors || 0),
    bytes: a.bytes + (r.feed_bytes || 0),
    ms: a.ms + (r.feed_ms || 0),
    events: a.events + (r.feed_events || 0),
  }),
  { polls: 0, errors: 0, bytes: 0, ms: 0, events: 0 },
);

const byClass = {};
for (const r of rows) {
  for (const [cls, v] of Object.entries(r.by_class || {})) {
    const b = (byClass[cls] = byClass[cls] || { polled: 0, bytes: 0, ms: 0, errors: 0 });
    b.polled += v.polled || 0;
    b.bytes += v.bytes || 0;
    b.ms += v.ms || 0;
    b.errors += v.errors || 0;
  }
}

// Which change kinds arrived by feed, and which only by the canonical sync's
// snapshot diff. A sync-only announcement or due-date move is the blocker.
const SYNC_ONLY_SOURCES = new Set(["snapshot"]);
const events = readEvents(userRoot, { sinceMs: Math.ceil(days) * 86400000 + 86400000 });
const coverage = {};
for (const e of events) {
  const c = (coverage[e.kind] = coverage[e.kind] || { feed: 0, sync: 0, extension: 0 });
  if (e.source === "feed" || e.source === "ics") c.feed += 1;
  else if (SYNC_ONLY_SOURCES.has(e.source)) c.sync += 1;
  else c.extension += 1;
}
const blockers = Object.entries(coverage)
  .filter(([kind, c]) => (kind === "announcement" || kind === "due_changed") && c.sync > 0 && c.feed === 0)
  .map(([kind]) => kind);

const out = {
  ok: true,
  window: { from: rows[0].at, to: rows[rows.length - 1].at, days: Number(days.toFixed(2)) },
  ticks: rows.length,
  polls: total.polls,
  errors: total.errors,
  error_rate: total.polls ? Number((total.errors / total.polls).toFixed(4)) : 0,
  bytes_total: total.bytes,
  bytes_per_day: Math.round(total.bytes / days),
  mb_per_day: Number((total.bytes / days / 1048576).toFixed(2)),
  ms_per_poll: total.polls ? Math.round(total.ms / total.polls) : 0,
  feed_events: total.events,
  by_class: byClass,
  coverage,
  launch_blockers: blockers,
  verdict: blockers.length
    ? `feeds missed ${blockers.join(", ")} — the extension or a shorter sync cadence is still needed`
    : days >= 7
      ? "feeds carried every announcement and due-date move across a full week"
      : `inconclusive — ${days.toFixed(1)} of 7 days logged`,
};

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`feeds-only watch — ${out.window.days} day(s), ${out.ticks} ticks`);
  console.log(`  polls        ${out.polls} (${out.errors} errors, ${(out.error_rate * 100).toFixed(1)}%)`);
  console.log(`  downloaded   ${mb(out.bytes_total)} total, ${out.mb_per_day} MB/day`);
  console.log(`  latency      ${out.ms_per_poll} ms per poll`);
  console.log(`  feed events  ${out.feed_events}`);
  for (const [cls, b] of Object.entries(byClass)) {
    console.log(`    ${cls.padEnd(14)} ${b.polled} polls, ${mb(b.bytes)}, ${b.errors} errors`);
  }
  console.log("  coverage by change kind (feed / sync-only / extension)");
  for (const [kind, c] of Object.entries(coverage)) {
    console.log(`    ${kind.padEnd(16)} ${c.feed} / ${c.sync} / ${c.extension}`);
  }
  console.log(`\n  ${out.verdict}`);
}
