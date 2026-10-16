/**
 * Brief projection I/O: read the local inputs, assemble, write
 * `{user_root}/inbox/briefs/v1/{course_id}--{assignment_id}.json` plus
 * `index.json`. Briefs are written first and the index last, so the index
 * (what the app reads) never points at a brief that isn't on disk. Everything
 * here is derived and can be deleted and rebuilt.
 *
 * A brief whose source fingerprint did not change keeps its prepared_at: it
 * never claims to be newer than its sources. A brief whose fingerprint did
 * change is rewritten, and the app — which holds the version the student is
 * reading — shows "Updated since this brief was prepared" instead of swapping
 * text under them.
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../canvas-store.mjs";
import { freshnessPaths, readEvents, readJson } from "../freshness-store.mjs";
import { buildBriefProjection } from "./assemble.mjs";
import { ID_RE } from "./schema.mjs";

const DAY = 86_400_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;
const BRIEF_FILE_RE = /^([A-Za-z0-9_-]{1,64})--([A-Za-z0-9_-]{1,64})\.json$/;
const BRIEF_ERROR_MESSAGE = "Briefs couldn't be rebuilt. They'll try again on the next sync.";

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function briefsDir(userRoot) {
  return path.join(userRoot, "inbox", "briefs", "v1");
}

export function briefPath(userRoot, courseId, assignmentId) {
  if (!ID_RE.test(String(courseId)) || !ID_RE.test(String(assignmentId))) throw new Error("unsafe brief id");
  return path.join(briefsDir(userRoot), `${courseId}--${assignmentId}.json`);
}

export function prefsPath(userRoot) {
  return path.join(userRoot, "calibration", "brief-preferences.json");
}

function readRecords(userRoot) {
  const dir = path.join(userRoot, "inbox", "study-sources");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !["status.json", "progress.json"].includes(n));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    const rec = readJson(path.join(dir, name));
    if (rec?.course?.id != null && Array.isArray(rec.items)) out.push(rec);
  }
  return out;
}

export function readBriefInputs(userRoot, { now = Date.now() } = {}) {
  return {
    records: readRecords(userRoot),
    events: readEvents(userRoot, { sinceMs: 14 * DAY, now }),
    skipCosts: readJson(freshnessPaths(userRoot).skipCosts, {}) || {},
    plan: readJson(path.join(userRoot, "inbox", "plan", "week.json"), null),
    prefs: readJson(prefsPath(userRoot), null),
  };
}

export function localTimeZone() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function errorPath(userRoot) {
  return path.join(briefsDir(userRoot), "error.json");
}

function lockPath(userRoot) {
  return path.join(briefsDir(userRoot), ".write.lock");
}

/** Exclusive lock for every brief writer (sync, freshness, `npm run briefs`). Waits out a live owner; a dead pid is stolen. */
function acquireBriefLock(userRoot) {
  const dir = briefsDir(userRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = lockPath(userRoot);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(file); } catch { /* already released */ }
      };
    } catch {
      let live = true;
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        if (raw.pid) {
          try {
            process.kill(Number(raw.pid), 0);
          } catch {
            live = false;
            try { fs.unlinkSync(file); } catch { /* another waiter took it */ }
          }
        }
      } catch { /* unreadable lock still blocks */ }
      if (!live) continue;
      if (Date.now() >= deadline) {
        const error = new Error("brief projection is already being written");
        error.code = "briefs_in_progress";
        throw error;
      }
      sleepMs(LOCK_POLL_MS);
    }
  }
}

/** Island order, state, reason, fingerprint, focus, and rest count. Ignores clocks that move on every rebuild. */
export function projectionSignature(index) {
  return JSON.stringify({
    rest: index?.rest_count ?? 0,
    rows: (index?.assignments || []).map((a) => [
      a.course_id,
      a.assignment_id,
      a.state,
      a.priority_reason,
      a.source_fingerprint,
      Boolean(a.focus),
    ]),
  });
}

function bodiesMatch(userRoot, briefs) {
  for (const brief of briefs) {
    const file = readJson(briefPath(userRoot, brief.course_id, brief.assignment_id), null);
    if (!file) return false;
    if (file.source_fingerprint !== brief.source_fingerprint) return false;
    if (file.state !== brief.state) return false;
    if (file.priority_reason !== brief.priority_reason) return false;
  }
  return true;
}

function pruneOrphans(dir, keep) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "index.json") continue;
    const base = name.replace(/--enriched\.json$/, ".json");
    if (!BRIEF_FILE_RE.test(base)) continue;
    if (!keep.has(base)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

function clearBriefError(userRoot) {
  const had = fs.existsSync(errorPath(userRoot));
  fs.rmSync(errorPath(userRoot), { force: true });
  return had;
}

function writeBriefError(userRoot) {
  try {
    fs.mkdirSync(briefsDir(userRoot), { recursive: true, mode: 0o700 });
    writeJsonAtomic(errorPath(userRoot), { message: BRIEF_ERROR_MESSAGE });
  } catch { /* the original failure is what the caller sees */ }
}

/**
 * @param {string} userRoot
 * @param {{ now?: number, timeZone?: string, pauseMs?: number }} [opts]
 * `pauseMs` is a test hook: it sleeps between brief files so a second process has to wait on the lock.
 * @returns {{ ok: true, islands: number, briefs: number, rest: number, changed: boolean } | { ok: true, skipped: string, changed: false }}
 */
export function writeBriefProjection(userRoot, { now = Date.now(), timeZone = localTimeZone(), pauseMs = 0 } = {}) {
  if (!readBriefInputs(userRoot, { now }).records.length) return { ok: true, skipped: "no study-sources yet", changed: false };
  const release = acquireBriefLock(userRoot);
  try {
    const inputs = readBriefInputs(userRoot, { now });
    if (!inputs.records.length) return { ok: true, skipped: "no study-sources yet", changed: false };
    const { index, briefs } = buildBriefProjection({ ...inputs, now, timeZone });
    const dir = briefsDir(userRoot);
    const keep = new Set(["index.json"]);
    for (const brief of briefs) keep.add(path.basename(briefPath(userRoot, brief.course_id, brief.assignment_id)));
    const existing = readJson(path.join(dir, "index.json"), null);
    const same = existing && projectionSignature(existing) === projectionSignature(index) && bodiesMatch(userRoot, briefs);
    if (same) {
      pruneOrphans(dir, keep);
      const changed = clearBriefError(userRoot);
      return { ok: true, islands: index.assignments.length, briefs: briefs.length, rest: index.rest_count, changed };
    }
    for (const brief of briefs) {
      const file = briefPath(userRoot, brief.course_id, brief.assignment_id);
      const prior = readJson(file, null);
      if (prior && prior.source_fingerprint === brief.source_fingerprint) brief.prepared_at = prior.prepared_at;
      writeJsonAtomic(file, brief);
      if (pauseMs > 0) sleepMs(pauseMs);
    }
    writeJsonAtomic(path.join(dir, "index.json"), index);
    pruneOrphans(dir, keep);
    clearBriefError(userRoot);
    return { ok: true, islands: index.assignments.length, briefs: briefs.length, rest: index.rest_count, changed: true };
  } catch (e) {
    if (e?.code !== "briefs_in_progress") writeBriefError(userRoot);
    throw e;
  } finally {
    release();
  }
}
