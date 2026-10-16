/**
 * The freshness brain, one tick at a time:
 *   1. classify extension deltas the native host queued,
 *   2. poll the tokenized feeds that are due (no session needed),
 *   3. append new events, rebuild the dashboard view model.
 * Plus the hook the canonical sync calls after it commits a generation.
 */
import fs from "node:fs";
import { classifyDelta } from "./freshness/classify.mjs";
import { captureFeeds, captureIsStale, pollFeeds } from "./canvas-feeds.mjs";
import { diffGenerations } from "./canvas-changes.mjs";
import { computeSkipCosts } from "./skip-cost.mjs";
import { buildDashboard } from "./freshness-dashboard.mjs";
import { loadCurrentProjections } from "./canvas-project.mjs";
import { writeBriefProjection } from "./briefs/project.mjs";
import {
  appendEvents,
  freshnessPaths,
  listDeltaFiles,
  markFunnel,
  readEvents,
  readFeedsSecret,
  readJson,
  readState,
  writeFeedsSecret,
  writeJsonAtomic,
  writeState,
} from "./freshness-store.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MAX_DELTA_ITEMS = 200;

/** Deltas come from the extension via the native host: re-check the shape here too. */
export function validDelta(delta) {
  if (!delta || typeof delta !== "object" || delta.v !== 1) return false;
  if (typeof delta.ts !== "string" || !Number.isFinite(Date.parse(delta.ts))) return false;
  for (const key of ["stream", "planner", "summary"]) {
    if (delta[key] != null && (!Array.isArray(delta[key]) || delta[key].length > MAX_DELTA_ITEMS)) return false;
  }
  return true;
}

export function rebuildDashboard(userRoot, { now = Date.now(), state = readState(userRoot) } = {}) {
  const p = freshnessPaths(userRoot);
  const projections = loadCurrentProjections(userRoot);
  const dashboard = buildDashboard({
    events: readEvents(userRoot, { sinceMs: 14 * DAY, now }),
    workSurface: projections?.work_surface || null,
    health: projections?.health || null,
    skipCosts: readJson(p.skipCosts, {}) || {},
    status: {
      signed_in: state.status?.signed_in ?? null,
      last_delta_at: state.status?.last_delta_at || null,
      last_feed_poll_at: state.status?.last_feed_poll_at || null,
      feeds_configured: Boolean(readFeedsSecret(userRoot)),
      feed_errors: state.status?.feed_errors || 0,
    },
    now,
  });
  writeJsonAtomic(p.dashboard, dashboard);
  // Mission Control briefs re-rank on every sync and tick. Derived and
  // rebuildable, so a failure here must never break freshness. A failure
  // still counts as a change: error.json is what Today needs to re-read.
  let briefsChanged = false;
  try {
    briefsChanged = Boolean(writeBriefProjection(userRoot, { now }).changed);
  } catch (e) {
    briefsChanged = true;
    console.warn(`briefs: ${String(e?.message || e).slice(0, 200)}`);
  }
  return { dashboard, briefsChanged };
}

/**
 * @param {{ userRoot: string, now?: number, fetchImpl?: Function, feeds?: boolean, forceFeeds?: boolean }} opts
 */
export async function runFreshnessTick({ userRoot, now = Date.now(), fetchImpl = fetch, feeds = true, forceFeeds = false }) {
  const state = readState(userRoot);
  const events = [];
  let deltasProcessed = 0;
  let deltasRejected = 0;
  for (const file of listDeltaFiles(userRoot)) {
    const delta = readJson(file);
    if (validDelta(delta)) {
      if (delta.signed_in === false) {
        state.status.signed_in = false;
        state.status.signed_out_at = delta.ts;
      } else {
        const result = classifyDelta(delta, state.classifier, { now: Date.parse(delta.ts) });
        state.classifier = result.state;
        events.push(...result.events);
        state.status.signed_in = true;
        state.status.last_delta_at = delta.ts;
        markFunnel(userRoot, "first_delta_processed", { now });
      }
      deltasProcessed += 1;
    } else {
      deltasRejected += 1;
    }
    fs.rmSync(file, { force: true });
  }

  let polled = [];
  const secret = feeds ? readFeedsSecret(userRoot) : null;
  if (secret) {
    const result = await pollFeeds({ feeds: secret, state: state.feeds, now, fetchImpl, force: forceFeeds });
    state.feeds = result.state;
    events.push(...result.events);
    polled = result.polled;
    if (polled.length) {
      state.status.last_feed_poll_at = new Date(now).toISOString();
      state.status.feed_errors = polled.filter((row) => !row.ok).length;
    }
  }

  const added = appendEvents(userRoot, state, events, { now });
  writeState(userRoot, state);
  const { briefsChanged } = rebuildDashboard(userRoot, { now, state });
  return {
    ok: true,
    new_events: added.length,
    briefs_changed: briefsChanged,
    deltas_processed: deltasProcessed,
    deltas_rejected: deltasRejected,
    feeds_polled: polled.length,
    feed_errors: polled.filter((row) => !row.ok).length,
  };
}

/**
 * After a canonical sync commits: snapshot-diff events, skip costs, feed
 * capture (only while the session page is open and the capture is stale),
 * then a dashboard rebuild. Never throws — freshness must not fail a sync.
 */
export async function afterCanonicalSync({ userRoot, previous, generation, page = null, api = null, base = null, now = Date.now() }) {
  const report = { events: 0, skip_costs: 0, feeds_captured: false, errors: [] };
  const state = readState(userRoot);
  try {
    report.events = appendEvents(userRoot, state, diffGenerations(previous, generation, { now }), { now }).length;
  } catch (e) {
    report.errors.push(`diff: ${e.message || e}`);
  }
  try {
    const costs = computeSkipCosts(generation, { now });
    writeJsonAtomic(freshnessPaths(userRoot).skipCosts, costs);
    report.skip_costs = Object.keys(costs).length;
  } catch (e) {
    report.errors.push(`skip-costs: ${e.message || e}`);
  }
  if (page && api && base) {
    try {
      const courses = (generation.courses || []).map((pack) => pack.course).filter((c) => c?.id);
      const existing = readFeedsSecret(userRoot);
      if (captureIsStale(existing, courses.map((c) => String(c.id)), { now })) {
        writeFeedsSecret(userRoot, await captureFeeds({ page, api, base, courses, now }));
        report.feeds_captured = true;
      }
    } catch (e) {
      report.errors.push(`feed-capture: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  writeState(userRoot, state);
  try {
    rebuildDashboard(userRoot, { now, state });
  } catch (e) {
    report.errors.push(`dashboard: ${e.message || e}`);
  }
  return report;
}
