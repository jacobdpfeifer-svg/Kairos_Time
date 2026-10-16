/**
 * Rebuild projections from an immutable raw generation.
 */
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "./canvas-model.mjs";
import { pathsFor, writeJsonAtomic, commitProjectionPointer, loadGeneration, readCurrentProjections } from "./canvas-store.mjs";
import { summarize_sync_health } from "./canvas-health.mjs";
import { reconcile_due_items, workSurfaceFromItems } from "./canvas-reconcile.mjs";
import { normalize_course_map } from "./canvas-course-map.mjs";
import { compute_grade_scenarios } from "./canvas-grades.mjs";

export function buildProjections(generation, { now, whatIfByCourse = {} } = {}) {
  const health = summarize_sync_health({ generation, now });
  const { items, unkeyed_sources } = reconcile_due_items(generation);
  health.unkeyed_sources_count = unkeyed_sources.length;
  const work = workSurfaceFromItems(items, {
    nowIso: generation.manifest?.finished_at,
    sync_id: generation.manifest?.sync_id,
    health,
  });
  const course_maps = {};
  const grade_truth = {};
  for (const pack of generation.courses || []) {
    const cid = String(pack.course.id);
    const assignments = (pack.assignments || []).map((a) => ({
      ...a,
      effective_due_at: items.find((i) => i.course_id === cid && i.canvas_id === String(a.id))?.effective_due_at || a.due_at,
    }));
    const grades = compute_grade_scenarios({
      course: pack.course,
      assignments,
      assignmentGroups: pack["assignment-groups"] || [],
      now: now || Date.parse(generation.manifest?.finished_at || Date.now()),
      as_of: generation.manifest?.finished_at,
      whatIf: whatIfByCourse[cid] || {},
    });
    grade_truth[cid] = grades;
    course_maps[cid] = normalize_course_map(pack, {
      workItems: items,
      health,
      gradeTruth: grades,
      sync_id: generation.manifest?.sync_id,
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    sync_id: generation.manifest?.sync_id,
    health,
    work_surface: work,
    course_maps,
    grade_truth,
    unkeyed_sources,
  };
}

export function writeProjections(userRoot, projections) {
  const p = pathsFor(userRoot);
  const dir = path.join(p.projections, projections.sync_id);
  fs.mkdirSync(path.join(dir, "course-map"), { recursive: true });
  fs.mkdirSync(path.join(dir, "grade-truth"), { recursive: true });
  writeJsonAtomic(path.join(dir, "sync-health.json"), projections.health);
  writeJsonAtomic(path.join(dir, "work-surface.json"), projections.work_surface);
  // Course ids name files; same rule as the app's reader (canvas.rs valid_course_id).
  const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
  for (const [id, map] of Object.entries(projections.course_maps)) {
    if (safeId(id)) writeJsonAtomic(path.join(dir, "course-map", `${id}.json`), map);
  }
  for (const [id, g] of Object.entries(projections.grade_truth)) {
    if (safeId(id)) writeJsonAtomic(path.join(dir, "grade-truth", `${id}.json`), g);
  }
  writeJsonAtomic(path.join(dir, "unkeyed-sources.json"), projections.unkeyed_sources || []);
  return dir;
}

export function promoteProjections(userRoot, generation, { now } = {}) {
  const projections = buildProjections(generation, { now });
  const dir = writeProjections(userRoot, projections);
  commitProjectionPointer(userRoot, { sync_id: projections.sync_id, dir, health: projections.health });
  return { dir, projections };
}

export function readJsonIf(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function loadCurrentProjections(userRoot) {
  const cur = readCurrentProjections(userRoot);
  if (!cur) return null;
  const dir = cur.dir;
  return {
    pointer: cur.pointer,
    health: readJsonIf(path.join(dir, "sync-health.json")),
    work_surface: readJsonIf(path.join(dir, "work-surface.json")),
    unkeyed_sources: readJsonIf(path.join(dir, "unkeyed-sources.json")) || [],
    dir,
  };
}

export { loadGeneration };
