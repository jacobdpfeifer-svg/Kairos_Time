/**
 * Shadow read model for student work. Local artifacts only.
 * Contract: docs/architecture/student-work-state-contract.md
 *
 * A failed commit never replaces current.json. Promoted generations are immutable.
 */
import fs from "node:fs";
import path from "node:path";
import { hashFields, isHttpUrl, stableStringify } from "./canvas-model.mjs";
import { writeJsonAtomic, writePointer, readPointer } from "./canvas-store.mjs";
import { loadCurrentProjections } from "./canvas-project.mjs";
import { WORK_ITEM_RE } from "./briefs/schema.mjs";
import { schoolDay } from "./school-config.mjs";
import { completeFromItem } from "./work-completion.mjs";

const SCHEMA_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const MAX_GENERATIONS = 3;
const READINESS = new Set(["unavailable", "unlinked", "source_partial", "ready"]);
const CHANGE_KIND = {
  due_changed: "due_moved",
  due_moved: "due_moved",
  assignment_added: "assignment_added",
  points_changed: "points_changed",
  instructions_edited: "instructions_edited",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function workPaths(userRoot) {
  const root = path.join(userRoot, "inbox", "work-state", "v1");
  return {
    root,
    staging: path.join(root, "staging"),
    generations: path.join(root, "generations"),
    pointer: path.join(root, "current.json"),
    lock: path.join(root, "rebuild.lock"),
  };
}

function confinedGeneration(userRoot, rel) {
  if (!rel || typeof rel !== "string") return null;
  if (rel.includes("\0")) return null;
  const base = path.resolve(workPaths(userRoot).generations);
  const resolved = path.resolve(userRoot, rel);
  if (resolved === base || !resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return { status: "missing", value: null };
  try {
    return { status: "ok", value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { status: "unreadable", value: null };
  }
}

function readEvents(userRoot) {
  const file = path.join(userRoot, "inbox", "freshness", "events.jsonl");
  if (!fs.existsSync(file)) return { status: "missing", events: [], skipped: 0 };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { status: "unreadable", events: [], skipped: 0 };
  }
  const events = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object" && typeof row.kind === "string") events.push(row);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { status: "ok", events, skipped };
}

function foldCaptures(file) {
  if (!fs.existsSync(file)) return { status: "missing", rows: [], skipped: 0 };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { status: "unreadable", rows: [], skipped: 0 };
  }
  const byId = new Map();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row.id === "string") byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  const rows = [...byId.values()].filter((row) => !row.removed_at);
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { status: "ok", rows, skipped };
}

/**
 * `week.json` and `items.jsonl` are one coverage value with two files.
 * A corrupt captures log must not hide week decisions that were still applied,
 * and a corrupt week file must not be reported as ok because a capture exists.
 */
function planCoverage(weekStatus, capturesStatus) {
  const weekOk = weekStatus === "ok";
  const capturesOk = capturesStatus === "ok";
  const weekBad = weekStatus === "unreadable";
  const capturesBad = capturesStatus === "unreadable";
  if ((weekOk && capturesBad) || (weekBad && capturesOk)) return "partial";
  if (weekBad || (capturesBad && !weekOk)) return "unreadable";
  if (weekOk || capturesOk) return "ok";
  return "missing";
}

function canvasCoverage(loaded) {
  if (!loaded) return "missing";
  const items = loaded.work_surface?.items;
  if (!Array.isArray(items)) return "unreadable";
  const state = loaded.health?.state;
  if (!loaded.health || state === "blocked" || state === "empty_unverified") return "partial";
  const failed = loaded.health.failed_endpoints || [];
  if (state === "fresh_partial" || state === "stale_partial" || loaded.health.usable_partial || failed.length) {
    return "partial";
  }
  return "ok";
}

export function loadWorkInputs(userRoot) {
  const canvas = loadCurrentProjections(userRoot);
  const weekFile = path.join(userRoot, "inbox", "plan", "week.json");
  const itemsFile = path.join(userRoot, "inbox", "plan", "items.jsonl");
  const week = readJsonFile(weekFile);
  const captures = foldCaptures(itemsFile);
  const freshness = readEvents(userRoot);
  const study = readJsonFile(path.join(userRoot, "study", "projection.json"));
  const planStatus = planCoverage(week.status, captures.status);
  const planBytes = [
    week.status === "ok" ? stableStringify(week.value) : week.status,
    captures.status === "ok" ? stableStringify(captures.rows) : captures.status,
  ].join("\n");
  return {
    canvas,
    canvasCoverage: canvasCoverage(canvas),
    week: week.status === "ok" && week.value && typeof week.value === "object" ? week.value : null,
    weekStatus: week.status,
    captures,
    planStatus,
    planRevision: hashFields(planBytes).slice(0, 16),
    freshness,
    study,
  };
}

function workItemId(item) {
  return `canvas:${item.tenant_id}:${item.course_id}:${item.object_type}:${item.canvas_id}`;
}

function courseId(item) {
  return `canvas:course:${item.tenant_id}:${item.course_id}`;
}

function acceptedDays(weeks) {
  const dayById = new Map();
  const entries = Object.entries(weeks || {}).filter(([, value]) => value && typeof value.accepted?.days === "object");
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [, entry] of entries) {
    for (const [id, day] of Object.entries(entry.accepted.days)) {
      if (typeof id === "string" && DAY.test(day)) dayById.set(id, day);
    }
  }
  return dayById;
}

function studentDecision(planId, estimates, deferrals, accepted) {
  const estimate = Number.isInteger(estimates[planId]) ? estimates[planId] : null;
  const deferred = deferrals[planId];
  const deferredTo = deferred && DAY.test(deferred.to) ? deferred.to : null;
  const planned = accepted.get(planId) || null;
  if (!deferredTo && !planned && estimate == null) return null;
  return {
    status: deferredTo ? "deferred" : planned ? "planned" : null,
    estimate_minutes: estimate,
    planned_day: deferredTo || planned,
    order: null,
    plan_id: planId,
  };
}

function blankStudent() {
  return { status: null, estimate_minutes: null, planned_day: null, order: null, plan_id: null };
}

function indexCanvas(items) {
  const byKind = new Map();
  for (const item of items) {
    const key = `${item.kind}:${item.canvas_id}`;
    const list = byKind.get(key) || [];
    list.push(item);
    byKind.set(key, list);
  }
  return byKind;
}

function joinPlanId(planId, byKind, byWorkId) {
  if (byWorkId.has(planId)) return { ids: [planId], ambiguous: false };
  const assignment = /^item-a(.+)$/.exec(planId);
  if (assignment) {
    const hits = byKind.get(`assignment:${assignment[1]}`) || [];
    return { ids: hits.map((item) => item.id), ambiguous: hits.length > 1 };
  }
  const quiz = /^item-q(.+)$/.exec(planId);
  if (quiz) {
    const hits = byKind.get(`quiz:${quiz[1]}`) || [];
    return { ids: hits.map((item) => item.id), ambiguous: hits.length > 1 };
  }
  if (planId.includes("|")) {
    const id = `canvas:${planId.split("|").join(":")}`;
    if (byWorkId.has(id)) return { ids: [id], ambiguous: false };
  }
  return { ids: [], ambiguous: false };
}

/**
 * Quizzes stay quizzes. The reconciler stores every other planner type,
 * including discussion_topic, as an assignment.
 */
function plannerKind(raw) {
  return raw === "quiz" ? "quiz" : "assignment";
}

function eventTarget(event) {
  const key = String(event.key || "");
  const snap = /^snap-[a-z_]+:([^:]+):([^:]+)/.exec(key);
  // Snapshot diffs walk assignments only, so the key has no type of its own.
  if (snap) return { course_id: snap[1], canvas_id: snap[2], kind: "assignment" };
  // Planner events carry a stable course/type/object id in their key. Activity
  // stream messages intentionally do not: matching those by title would join
  // the wrong assignment when a course repeats a name.
  const planner = /^planner-(?:added|due):([^:]+):([a-z_]+):([^:]+)(?::|$)/.exec(key);
  if (planner) return { course_id: planner[1], canvas_id: planner[3], kind: plannerKind(planner[2]) };
  return null;
}

function changeTargetIndex(items) {
  const byCanvas = new Map();
  const byUrl = new Map();
  for (const item of items) {
    if (item.canvas_id != null && item.course_id && item.kind) {
      const course = String(item.course_id).split(":")[3] || "";
      const key = `${course}\u0000${item.kind}\u0000${item.canvas_id}`;
      const rows = byCanvas.get(key) || [];
      rows.push(item);
      byCanvas.set(key, rows);
    }
    if (item.canvas?.url) {
      const rows = byUrl.get(item.canvas.url) || [];
      rows.push(item);
      byUrl.set(item.canvas.url, rows);
    }
  }
  return { byCanvas, byUrl };
}

function newerEvent(best, event) {
  if (!best) return event;
  const ta = Date.parse(best.detected_at || best.at || "") || 0;
  const tb = Date.parse(event.detected_at || event.at || "") || 0;
  if (tb > ta || (tb === ta && String(event.key || "") > String(best.key || ""))) return event;
  return best;
}

/**
 * One change per item. A due move outranks every other kind regardless of age:
 * Today and Week render only the moved-date row, so letting a later
 * points_changed win would drop the move the student needs to see.
 */
function latestChange(events) {
  let moved = null;
  let other = null;
  for (const event of events) {
    const kind = CHANGE_KIND[event.kind];
    if (!kind) continue;
    if (kind === "due_moved") moved = newerEvent(moved, event);
    else other = newerEvent(other, event);
  }
  const best = moved || other;
  if (!best) return null;
  const kind = CHANGE_KIND[best.kind];
  // The freshness key identifies the move itself, so a reader can recognise the
  // same change it already has instead of guessing from a URL.
  const change = {
    kind,
    seen_at: best.detected_at || best.at || null,
    source_key: typeof best.key === "string" ? best.key : null,
  };
  if (kind === "due_moved") {
    change.from = typeof best.detail?.from === "string" || best.detail?.from == null ? best.detail?.from ?? null : null;
    change.to = typeof best.detail?.to === "string" || best.detail?.to == null ? best.detail?.to ?? null : null;
  }
  return change;
}

function studyRecords(study) {
  const raw = study?.status === "ok" ? study.value?.items : null;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function studyIndex(study) {
  const map = new Map();
  const items = studyRecords(study);
  for (const item of items) {
    const id = item?.work_item_id;
    if (typeof id !== "string" || !WORK_ITEM_RE.test(id)) continue;
    map.set(id, {
      readiness: READINESS.has(item.readiness) ? item.readiness : "source_partial",
      exam_id: typeof item.exam_id === "string" ? item.exam_id : null,
    });
  }
  return map;
}

function studySummary(id, study, linked) {
  if (study.status === "missing" || study.status === "unreadable") {
    return { readiness: "unavailable", exam_id: null };
  }
  return linked.get(id) || { readiness: "unlinked", exam_id: null };
}

function dueDay(due, timezone) {
  const ms = Date.parse(due || "");
  if (!Number.isFinite(ms)) return null;
  try {
    return schoolDay(new Date(ms), timezone || "UTC");
  } catch {
    return null;
  }
}

function compareItems(a, b, timezone, dueDays = null) {
  const ap = a.student.planned_day || "";
  const bp = b.student.planned_day || "";
  if (ap !== bp) {
    if (!ap) return 1;
    if (!bp) return -1;
    return ap < bp ? -1 : 1;
  }
  const ad = dueDays ? dueDays.get(a) || "" : dueDay(a.due_at, timezone) || "";
  const bd = dueDays ? dueDays.get(b) || "" : dueDay(b.due_at, timezone) || "";
  if (ad !== bd) {
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : 1;
  }
  const at = Date.parse(a.due_at || "");
  const bt = Date.parse(b.due_at || "");
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (aOk && at !== bt) return at - bt;
  const ac = a.course_id || "";
  const bc = b.course_id || "";
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure reducer. `inputs` is the object from loadWorkInputs, or a test double
 * with the same shape. `now` is an ISO timestamp written onto state and excluded
 * from the content hash by the caller.
 */
export function reduceWorkState(inputs, { now, timezone } = {}) {
  const canvasItems = Array.isArray(inputs.canvas?.work_surface?.items) ? inputs.canvas.work_surface.items : [];
  const tz = timezone || inputs.canvas?.health?.timezone || inputs.canvas?.work_surface?.timezone || "UTC";
  const syncId = inputs.canvas?.work_surface?.sync_id || inputs.canvas?.pointer?.sync_id || null;
  const estimates = inputs.weekStatus === "ok" && inputs.week?.estimates && typeof inputs.week.estimates === "object" ? inputs.week.estimates : {};
  const deferrals = inputs.weekStatus === "ok" && inputs.week?.deferrals && typeof inputs.week.deferrals === "object" ? inputs.week.deferrals : {};
  const accepted = inputs.weekStatus === "ok" ? acceptedDays(inputs.week?.weeks) : new Map();
  const linkedStudy = studyIndex(inputs.study);
  const ambiguous = [];
  const orphans = [];

  const workItems = [];
  const courses = new Map();
  for (const raw of canvasItems) {
    if (!raw || raw.canvas_id == null || raw.course_id == null || !raw.object_type || !raw.tenant_id) continue;
    const id = workItemId(raw);
    const cid = courseId(raw);
    if (!courses.has(cid)) {
      courses.set(cid, {
        id: cid,
        label: typeof raw.course_code === "string" ? raw.course_code : "",
        name: typeof raw.course_name === "string" ? raw.course_name : "",
      });
    }
    workItems.push({
      id,
      course_id: cid,
      kind: String(raw.object_type),
      title: typeof raw.title === "string" ? raw.title : "",
      due_at: typeof raw.effective_due_at === "string" ? raw.effective_due_at : null,
      canvas_id: String(raw.canvas_id),
      canvas: {
        url: isHttpUrl(raw.html_url) ? raw.html_url : null,
        submission_state: typeof raw.submission_state === "string" ? raw.submission_state : "unknown",
        // Authored in work-completion.mjs. `submission_state` alone cannot tell
        // an unposted teacher-entered grade from work never started.
        completed: completeFromItem(raw),
      },
      provenance: { sync_id: syncId, source_ids: [typeof raw.id === "string" ? raw.id : id] },
      change: null,
      student: blankStudent(),
      study: studySummary(id, inputs.study, linkedStudy),
    });
  }

  const byId = new Map(workItems.map((item) => [item.id, item]));
  const byKind = indexCanvas(workItems);
  const planIds = new Set([
    ...Object.keys(estimates),
    ...Object.keys(deferrals),
    ...accepted.keys(),
  ]);
  const sortedPlanIds = [...planIds].filter((id) => typeof id === "string" && !id.startsWith("cap-")).sort();
  for (const planId of sortedPlanIds) {
    const decision = studentDecision(planId, estimates, deferrals, accepted);
    const join = joinPlanId(planId, byKind, byId);
    if (join.ambiguous) ambiguous.push(planId);
    if (join.ids.length) {
      if (!decision) continue;
      // Applying one decision to several items would duplicate a student
      // choice. Take the lowest id, deterministically, and say so in health.
      const target = [...join.ids].sort()[0];
      const item = byId.get(target);
      const previous = item.student.plan_id;
      item.student = { ...decision, order: null };
      if (previous && previous !== planId) ambiguous.push(planId);
      continue;
    }
    if (!decision) continue;
    const orphanId = `plan:${planId}`;
    orphans.push(orphanId);
    workItems.push({
      id: orphanId,
      course_id: null,
      kind: "plan_orphan",
      title: null,
      due_at: null,
      canvas_id: null,
      canvas: null,
      provenance: { sync_id: null, source_ids: [planId] },
      change: null,
      student: { ...decision, order: null },
      study: studySummary(orphanId, inputs.study, linkedStudy),
    });
  }

  for (const row of inputs.captures?.rows || []) {
    if (typeof row.id !== "string" || !row.id.startsWith("cap-")) continue;
    const id = `capture:${row.id}`;
    const decision = studentDecision(row.id, estimates, deferrals, accepted);
    const planned = decision?.planned_day || (DAY.test(row.day) ? row.day : null);
    workItems.push({
      id,
      course_id: null,
      kind: "capture",
      title: typeof row.title === "string" ? row.title : "",
      due_at: typeof row.due_at === "string" ? row.due_at : null,
      canvas_id: null,
      canvas: null,
      provenance: { sync_id: null, source_ids: [row.id] },
      change: null,
      student: {
        status: row.done_at ? "done" : decision?.status || (planned ? "planned" : null),
        estimate_minutes: decision?.estimate_minutes ?? null,
        planned_day: planned,
        order: null,
        plan_id: row.id,
      },
      study: studySummary(id, inputs.study, linkedStudy),
    });
  }

  const changesByItem = new Map();
  const changeTargets = changeTargetIndex(workItems);
  const unmatched = [];
  let ignoredChanges = 0;
  for (const event of inputs.freshness?.events || []) {
    if (!CHANGE_KIND[event.kind]) {
      ignoredChanges += 1;
      continue;
    }
    const target = eventTarget(event);
    let hits = [];
    if (target) {
      hits = changeTargets.byCanvas.get(`${target.course_id}\u0000${target.kind}\u0000${target.canvas_id}`) || [];
    }
    if (!hits.length && isHttpUrl(event.url)) {
      const urlHits = changeTargets.byUrl.get(event.url) || [];
      // One URL shared by two items is not an identity. Leave it unmatched
      // rather than copying one change onto every row.
      if (urlHits.length === 1) hits = urlHits;
      else if (urlHits.length > 1) {
        if (typeof event.key === "string") unmatched.push(event.key);
        continue;
      }
    }
    if (!hits.length) {
      if (typeof event.key === "string") unmatched.push(event.key);
      continue;
    }
    for (const item of hits) {
      const list = changesByItem.get(item.id) || [];
      list.push(event);
      changesByItem.set(item.id, list);
    }
  }
  for (const item of workItems) {
    item.change = latestChange(changesByItem.get(item.id) || []);
    delete item.canvas_id;
  }

  const dueDays = new Map();
  for (const item of workItems) dueDays.set(item, dueDay(item.due_at, tz) || "");
  workItems.sort((a, b) => compareItems(a, b, tz, dueDays));
  // Array order stays the contract total order. `student.order` is a separate
  // fact: id-ascending inside one planned day, because week.json stores no sequence.
  const byDay = new Map();
  for (const item of workItems) {
    const day = item.student.planned_day;
    if (!day) continue;
    const list = byDay.get(day) || [];
    list.push(item);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) {
    const ranked = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    ranked.forEach((item, index) => {
      item.student.order = index;
    });
  }

  const courseList = [...courses.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const freshnessStatus = inputs.freshness?.status || "missing";
  const studyStatus = inputs.study?.status === "ok" ? "ok" : inputs.study?.status || "missing";
  const state = {
    schema_version: SCHEMA_VERSION,
    generated_at: now || null,
    source: {
      canvas_sync_id: inputs.canvasCoverage === "missing" ? null : syncId,
      // Count of events that parsed, not a physical line count and not a byte
      // offset. Junk lines stay in health.skipped_lines and do not mint a
      // generation. Valid because events.jsonl is append-only and never compacted.
      freshness_event_cursor: inputs.freshness?.events?.length || 0,
      plan_revision: inputs.planStatus === "missing" ? null : inputs.planRevision,
    },
    coverage: {
      canvas: inputs.canvasCoverage,
      freshness: freshnessStatus,
      plan: inputs.planStatus,
      study: studyStatus,
    },
    courses: courseList,
    work_items: workItems,
  };
  const health = {
    schema_version: SCHEMA_VERSION,
    inputs: {
      canvas: {
        status: inputs.canvasCoverage,
        sync_id: syncId,
        health_state: inputs.canvas?.health?.state || null,
        failed_endpoints: inputs.canvas?.health?.failed_endpoints || [],
        unavailable_endpoints: inputs.canvas?.health?.unavailable_endpoints || [],
      },
      freshness: {
        status: freshnessStatus,
        event_count: inputs.freshness?.events?.length || 0,
        skipped_lines: inputs.freshness?.skipped || 0,
      },
      plan: {
        status: inputs.planStatus,
        week: inputs.weekStatus,
        captures: inputs.captures?.status || "missing",
      },
      study: { status: studyStatus },
    },
    orphans,
    ambiguous_plan_ids: [...new Set(ambiguous)].sort(),
    unmatched_change_keys: unmatched.sort().slice(0, 20),
    unmatched_change_count: unmatched.length,
    ignored_change_count: ignoredChanges,
    errors: [],
  };
  if (inputs.weekStatus === "unreadable") health.errors.push("plan week.json unreadable");
  if (inputs.captures?.status === "unreadable") health.errors.push("plan items.jsonl unreadable");
  if (inputs.canvasCoverage === "unreadable") health.errors.push("canvas projection unreadable");
  if (freshnessStatus === "unreadable") health.errors.push("freshness events unreadable");
  if (studyStatus === "unreadable") health.errors.push("study projection unreadable");
  return { state, health, timezone: tz };
}

function hashedBody(built) {
  return hashFields({
    state: { ...built.state, generated_at: null },
    health: built.health,
  });
}

function generationId(finishedAt, contentHash) {
  const stamp = String(finishedAt || "undated").replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `ws-${stamp}-${contentHash.slice(0, 12)}`;
}

function withLock(userRoot, fn) {
  const paths = workPaths(userRoot);
  fs.mkdirSync(paths.root, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(paths.lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(paths.lock).mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (stale && attempt === 0) {
        fs.rmSync(paths.lock, { force: true });
        continue;
      }
      return { ok: false, busy: true, preserved: true };
    }
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    try {
      fs.writeFileSync(fd, token);
      return fn();
    } finally {
      fs.closeSync(fd);
      // Only release our own lock: a stale takeover may already have replaced it.
      let mine = false;
      try {
        mine = fs.readFileSync(paths.lock, "utf8") === token;
      } catch {
        mine = false;
      }
      if (mine) fs.rmSync(paths.lock, { force: true });
    }
  }
  return { ok: false, busy: true, preserved: true };
}

function pruneGenerations(userRoot, currentId, previousId) {
  const dir = workPaths(userRoot).generations;
  if (!fs.existsSync(dir)) return;
  const names = fs.readdirSync(dir).filter((name) => {
    try {
      return fs.statSync(path.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  }).sort();
  const keep = new Set([currentId]);
  if (previousId) keep.add(previousId);
  for (const name of [...names].reverse()) {
    if (keep.size >= MAX_GENERATIONS) break;
    keep.add(name);
  }
  for (const name of names) {
    if (!keep.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function pointerPayload(userRoot, id, contentHash, previousId, finishedAt) {
  const rel = path.join("inbox", "work-state", "v1", "generations", id);
  return {
    schema_version: SCHEMA_VERSION,
    generation_id: id,
    content_hash: contentHash,
    path: rel.split(path.sep).join("/"),
    previous_generation_id: previousId,
    finished_at: finishedAt,
  };
}

function loadGenerationDir(dir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    const health = JSON.parse(fs.readFileSync(path.join(dir, "health.json"), "utf8"));
    if (state?.schema_version !== SCHEMA_VERSION || health?.schema_version !== SCHEMA_VERSION) {
      return { ok: false, reason: "schema" };
    }
    if (!Array.isArray(state.work_items) || !state.coverage) return { ok: false, reason: "schema" };
    return { ok: true, state, health };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function readWorkState(userRoot) {
  const pointer = readPointer(workPaths(userRoot).pointer);
  if (!pointer) return { ok: false, reason: "missing", state: null, health: null };
  if (pointer.schema_version !== SCHEMA_VERSION) return { ok: false, reason: "schema", state: null, health: null };
  const dir = confinedGeneration(userRoot, pointer.path);
  if (!dir) return { ok: false, reason: "unconfined", state: null, health: null };
  const primary = loadGenerationDir(dir);
  if (primary.ok) return { ok: true, fell_back: false, reason: null, pointer, ...primary };
  const previousId = pointer.previous_generation_id;
  if (typeof previousId === "string" && /^ws-[A-Za-z0-9-]+$/.test(previousId) && !previousId.includes("..")) {
    const previousDir = confinedGeneration(userRoot, `inbox/work-state/v1/generations/${previousId}`);
    if (previousDir) {
      const previous = loadGenerationDir(previousDir);
      if (previous.ok) {
        return { ok: true, fell_back: true, reason: primary.reason, pointer, ...previous };
      }
    }
  }
  return { ok: false, reason: primary.reason, state: null, health: null, fell_back: false };
}

export function commitWorkState(userRoot, built, { beforePointer, finishedAt } = {}) {
  return withLock(userRoot, () => {
    const paths = workPaths(userRoot);
    const contentHash = hashedBody(built);
    const existing = readPointer(paths.pointer);
    if (
      existing?.content_hash === contentHash
      && confinedGeneration(userRoot, existing.path)
      && fs.existsSync(path.join(confinedGeneration(userRoot, existing.path), "state.json"))
    ) {
      return { ok: true, unchanged: true, generation_id: existing.generation_id, preserved: true };
    }
    const finished = finishedAt || built.state.generated_at || new Date().toISOString();
    const existingFinished = Date.parse(existing?.finished_at || "");
    const ourFinished = Date.parse(finished);
    if (Number.isFinite(existingFinished) && Number.isFinite(ourFinished) && existingFinished > ourFinished) {
      return { ok: true, unchanged: true, stale: true, generation_id: existing.generation_id, preserved: true };
    }
    const id = generationId(finished, contentHash);
    const rel = path.join("inbox", "work-state", "v1", "generations", id);
    const dest = confinedGeneration(userRoot, rel.split(path.sep).join("/"));
    if (!dest) return { ok: false, reason: "unconfined", preserved: true };
    if (!fs.existsSync(path.join(dest, "state.json"))) {
      const staging = path.join(paths.staging, id);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(paths.generations, { recursive: true });
      fs.mkdirSync(staging, { recursive: true });
      writeJsonAtomic(path.join(staging, "state.json"), built.state);
      writeJsonAtomic(path.join(staging, "health.json"), built.health);
      fs.renameSync(staging, dest);
    }
    if (beforePointer) beforePointer();
    const previousId = existing?.generation_id || null;
    writePointer(paths.pointer, pointerPayload(userRoot, id, contentHash, previousId, finished));
    pruneGenerations(userRoot, id, previousId);
    return { ok: true, unchanged: false, generation_id: id };
  });
}

export function rebuildWorkState(userRoot, { now = new Date().toISOString(), beforePointer } = {}) {
  const inputs = loadWorkInputs(userRoot);
  const built = reduceWorkState(inputs, { now });
  built.state.generated_at = now;
  try {
    const committed = commitWorkState(userRoot, built, { beforePointer, finishedAt: now });
    return { ...committed, coverage: built.state.coverage };
  } catch (error) {
    return { ok: false, preserved: true, reason: String(error?.message || error).slice(0, 200) };
  }
}

export { SCHEMA_VERSION };
