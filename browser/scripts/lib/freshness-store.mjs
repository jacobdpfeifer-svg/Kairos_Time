/**
 * On-disk layout for the always-fresh pipeline, under {user_root}:
 *
 *   inbox/freshness/events.jsonl    append-only change events (deduped by key)
 *   inbox/freshness/state.json      classifier + feed-watcher state, seen keys
 *   inbox/freshness/deltas/*.json   extension deltas waiting for the brain (native host writes)
 *   inbox/freshness/dashboard.json  view model read by the extension and the app
 *   inbox/freshness/skip-costs.json grade impact of skipping upcoming work
 *   inbox/freshness/funnel.json     beta funnel markers (timestamps/counts only)
 *   auth/feeds.json                 tokenized feed URLs — secret (0600), never exported
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./canvas-store.mjs";

const SEEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const EVENTS_ROTATE_BYTES = 2 * 1024 * 1024;
const EVENTS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export function freshnessPaths(userRoot) {
  const dir = path.join(userRoot, "inbox", "freshness");
  return {
    dir,
    events: path.join(dir, "events.jsonl"),
    state: path.join(dir, "state.json"),
    deltas: path.join(dir, "deltas"),
    dashboard: path.join(dir, "dashboard.json"),
    skipCosts: path.join(dir, "skip-costs.json"),
    funnel: path.join(dir, "funnel.json"),
    feedsWatch: path.join(dir, "feeds-watch.jsonl"),
    feedsSecret: path.join(userRoot, "auth", "feeds.json"),
  };
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export { writeJsonAtomic };

export function readState(userRoot) {
  const state = readJson(freshnessPaths(userRoot).state, {}) || {};
  return {
    seen: {},
    classifier: {},
    feeds: {},
    status: {},
    ...state,
  };
}

export function writeState(userRoot, state) {
  writeJsonAtomic(freshnessPaths(userRoot).state, state);
}

/**
 * Append events whose key has not been seen. Mutates `state.seen`.
 * @returns {object[]} the events actually written
 */
const FEEDS_WATCH_RETAIN_DAYS = 30;

/**
 * One measurement row per tick that actually polled feeds: what the feed path
 * costs and what it caught. This is the evidence the feeds-only decision needs
 * (`docs/handoff/feeds-only-freshness-protocol-2026-10-26.md`), not product state — nothing reads it
 * at runtime. Self-trimming to 30 days so it can be left on.
 */
export function appendFeedsWatch(userRoot, row, { now = Date.now() } = {}) {
  const p = freshnessPaths(userRoot);
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ at: new Date(now).toISOString(), ...row });
  let kept = [];
  try {
    const cutoff = now - FEEDS_WATCH_RETAIN_DAYS * 24 * 60 * 60 * 1000;
    kept = fs
      .readFileSync(p.feedsWatch, "utf8")
      .split("\n")
      .filter(Boolean)
      .filter((l) => {
        const at = Date.parse(JSON.parse(l)?.at || "");
        return Number.isFinite(at) && at >= cutoff;
      });
  } catch {
    kept = [];
  }
  fs.writeFileSync(p.feedsWatch, [...kept, line].join("\n") + "\n", { mode: 0o600 });
}

export function readFeedsWatch(userRoot) {
  try {
    return fs
      .readFileSync(freshnessPaths(userRoot).feedsWatch, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendEvents(userRoot, state, events, { now = Date.now() } = {}) {
  const p = freshnessPaths(userRoot);
  const added = [];
  for (const event of events || []) {
    if (!event?.key || state.seen[event.key]) continue;
    state.seen[event.key] = event.detected_at || new Date(now).toISOString();
    added.push(event);
  }
  for (const [key, at] of Object.entries(state.seen)) {
    if (now - Date.parse(at) > SEEN_TTL_MS) delete state.seen[key];
  }
  if (added.length) {
    fs.mkdirSync(p.dir, { recursive: true });
    fs.appendFileSync(p.events, added.map((e) => JSON.stringify(e)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
    rotateEvents(userRoot, { now });
  }
  return added;
}

export function readEvents(userRoot, { sinceMs = null, now = Date.now() } = {}) {
  let text = "";
  try {
    text = fs.readFileSync(freshnessPaths(userRoot).events, "utf8");
  } catch {
    return [];
  }
  const floor = sinceMs == null ? -Infinity : now - sinceMs;
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const t = Date.parse(event.detected_at || event.at || 0);
      if (t >= floor) out.push(event);
    } catch {
      /* skip torn line */
    }
  }
  return out;
}

function rotateEvents(userRoot, { now }) {
  const p = freshnessPaths(userRoot);
  let size = 0;
  try {
    size = fs.statSync(p.events).size;
  } catch {
    return;
  }
  if (size < EVENTS_ROTATE_BYTES) return;
  const keep = readEvents(userRoot, { sinceMs: EVENTS_KEEP_MS, now });
  const tmp = `${p.events}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 });
  fs.renameSync(tmp, p.events);
}

/** Pending extension deltas, oldest first. */
export function listDeltaFiles(userRoot) {
  const dir = freshnessPaths(userRoot).deltas;
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/** Tokenized feed URLs. Secret: owner-only file, never logged or exported. */
export function readFeedsSecret(userRoot) {
  return readJson(freshnessPaths(userRoot).feedsSecret, null);
}

export function writeFeedsSecret(userRoot, feeds) {
  const file = freshnessPaths(userRoot).feedsSecret;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeJsonAtomic(file, feeds, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Record the first time a funnel milestone happened (no content, just time). */
export function markFunnel(userRoot, milestone, { now = Date.now() } = {}) {
  const file = freshnessPaths(userRoot).funnel;
  const funnel = readJson(file, {}) || {};
  if (!funnel[milestone]) {
    funnel[milestone] = new Date(now).toISOString();
    writeJsonAtomic(file, funnel);
  }
  return funnel;
}
