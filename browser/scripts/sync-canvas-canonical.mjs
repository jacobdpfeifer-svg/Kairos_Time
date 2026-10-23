/**
 * Reviewer: SSO cookie sync into the local inbox. It does not submit work.
 *
 * Unified Canvas reliability sync: one Playwright session → staged generation
 * → projections → adapters. Does not run the legacy two-pass fetch.
 *
 *   node scripts/sync-canvas-canonical.mjs
 *   CANVAS_ADAPTERS_ONLY=1  # rebuild adapters from current generation, no fetch
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  api,
  apiAllPages,
  dedupeRows,
  formatTeachers,
  syllabusHash,
  fromAssignments,
  fromDiscussions,
  getBase,
  launchCanvasContext,
  requireLoggedIn,
  writeCourseCatalogFiles,
  schoolLocalDay,
} from "./lib/canvas-session.mjs";
import { resolveUserRoot, resolveProductUserId } from "./lib/user-root.mjs";
import { fetchCanonicalGeneration } from "./lib/canvas-snapshot.mjs";
import { carryForwardFailedData, commitRawGeneration, newSyncId, pathsFor, readCurrentRaw, writeSyncRun, writeJsonAtomic } from "./lib/canvas-store.mjs";
import { buildProjections, promoteProjections } from "./lib/canvas-project.mjs";
import { writeAdaptersFromProjection } from "./lib/canvas-adapters.mjs";
import { afterCanonicalSync } from "./lib/freshness-run.mjs";
import { syncCourseColors } from "./lib/course-colors.mjs";
import { acquireSyncLock } from "./lib/sync-lock.mjs";
import { reconcileCommand } from "./lib/reconcile-command.mjs";

const userRoot = resolveUserRoot({ create: true, announce: true });
const releaseSyncLock = acquireSyncLock(userRoot);
process.on("exit", releaseSyncLock);
const adaptersOnly = process.env.CANVAS_ADAPTERS_ONLY === "1" || process.env.CANVAS_ADAPTERS_ONLY === "true";
// Raw fetch depth (term-wide "full scrape") — CATALOG_DAYS only. WEEK_TABLE_DAYS
// (below) controls only the week.md display window and must not shrink this.
const daysAhead = Number(process.env.CATALOG_DAYS || 150);
const weekTableDays = Number(process.env.WEEK_TABLE_DAYS || 7);
const outDir = path.join(userRoot, "inbox", "study-sources");
fs.mkdirSync(outDir, { recursive: true });
const progressPath = path.join(outDir, "progress.json");

function writeProgress(progress) {
  writeJsonAtomic(progressPath, progress);
  console.log(JSON.stringify({ type: "study-sync-progress", ...progress }));
}

function surfaceReconcile(userRoot, result) {
  const healthPath = path.join(userRoot, "inbox", "sync-health.json");
  writeJsonAtomic(healthPath, { reconcile: result, updated_at: new Date().toISOString() });
  const statusPath = path.join(userRoot, "inbox", "study-sources", "status.json");
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    status.reconcile = result;
    if (!result.ok) {
      status.ok = false;
      status.partial = true;
      status.errors = [...new Set([...(status.errors || []), `reconcile: ${result.error || "failed"}`])];
    }
    writeJsonAtomic(statusPath, status);
  } catch {
    /* The health file above remains the authoritative failure surface. */
  }
}

function writeCatalogsFromGeneration(generation) {
  const perCourse = (generation.courses || []).map((pack) => {
    const teachers = pack.course.teachers || [];
    const primary = teachers.filter((t) => !/ta\b|teaching assistant/i.test(String(t.display_name || t.name || "")));
    const tas = teachers.filter((t) => /ta\b|teaching assistant/i.test(String(t.display_name || t.name || "")));
    const syllabusPlain = String(pack.course.syllabus_body || "").replace(/<[^>]+>/g, " ");
    const usableSyllabus = Boolean(syllabusPlain.trim()) && !/uploading a doc|under construction|preferred to create a syllabus page|course information module/i.test(syllabusPlain);
    return {
      id: pack.course.id,
      name: pack.course.name,
      code: pack.course.course_code,
      rows: dedupeRows([
        ...fromAssignments(pack.course.name, pack.course.id, pack.assignments || []),
        ...fromDiscussions(pack.course.name, pack.course.id, pack.discussions || []),
      ]),
      assignments_ok: true,
      assignments_count: (pack.assignments || []).length,
      assignments_truncated: false,
      discussions_ok: true,
      discussions_count: (pack.discussions || []).length,
      canvasUrl: pack.course.html_url,
      primaryInstructors: formatTeachers(primary) || formatTeachers(teachers),
      tas: formatTeachers(tas),
      syllabusPlain,
      syllabusHash: usableSyllabus ? syllabusHash(syllabusPlain) : "",
      policyPages: [],
      syllabus_ok: usableSyllabus,
    };
  });
  return writeCourseCatalogFiles(perCourse, {
    today: schoolLocalDay(new Date(generation.manifest?.finished_at || Date.now())),
  });
}

function adaptersFromCurrent() {
  const cur = readCurrentRaw(userRoot);
  if (!cur) return { ok: false, error: "no current generation" };
  const projections = buildProjections(cur.generation);
  writeProjectionsSafe(cur.generation, projections);
  const ad = writeAdaptersFromProjection({
    userRoot,
    generation: cur.generation,
    projections,
    daysAhead: Number(process.env.WEEK_TABLE_DAYS || 7),
  });
  writeCatalogsFromGeneration(cur.generation);
  return { ok: ad.ok, error: ad.errors[0], sync_id: cur.pointer.sync_id };
}

function writeProjectionsSafe(generation, projections) {
  try {
    return promoteProjections(userRoot, generation);
  } catch (e) {
    console.error(`projection build failed; keeping previous projections pointer: ${e.message || e}`);
    const p = pathsFor(userRoot);
    const dir = path.join(p.projections, projections.sync_id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(path.join(dir, "FAILED.json"), { error: String(e.message || e), sync_id: projections.sync_id });
    } catch {
      /* ignore */
    }
    return null;
  }
}

if (adaptersOnly) {
  const r = adaptersFromCurrent();
  if (!r.ok) {
    console.error(r.error || "adapters-only failed");
    process.exit(1);
  }
  console.log(`Adapters rebuilt from ${r.sync_id}`);
  process.exit(0);
}

writeProgress({ phase: "running", courses: [] });
const { context, page } = await launchCanvasContext({ headless: true });
try {
  await requireLoggedIn(page);
} catch (e) {
  writeProgress({ phase: "failed", error: String(e?.message || e), courses: [] });
  console.error(String(e.message || e));
  await context.close();
  process.exit(1);
}

const sync_id = newSyncId();
let generation;
try {
  generation = await fetchCanonicalGeneration(page, {
    apiAllPages,
    api,
    sync_id,
    profile_id: resolveProductUserId(),
    daysAhead,
  });
} catch (e) {
  writeProgress({ phase: "failed", error: String(e?.message || e), courses: [] });
  console.error(String(e.message || e));
  await context.close();
  process.exit(1);
}

const previousRaw = readCurrentRaw(userRoot);
generation = carryForwardFailedData(previousRaw?.generation, generation);
const committed = commitRawGeneration(userRoot, generation, { sync_id });
if (!committed.ok) {
  writeProgress({ phase: "failed", error: "validation failed", courses: [] });
  console.error((committed.errors || []).join("; "));
  await context.close();
  process.exit(1);
}

let projections;
try {
  projections = buildProjections(committed.manifest ? generation : generation);
  const promoted = writeProjectionsSafe(generation, projections);
  if (promoted) projections = promoted.projections;
} catch (e) {
  console.error(`projection failed: ${e.message || e}`);
}

if (!projections) {
  writeSyncRun(userRoot, {
    sync_id,
    started_at: generation.manifest.started_at,
    finished_at: generation.manifest.finished_at,
    complete: false,
    health: { state: "blocked", blocked_reason: "projection_failed" },
  });
  writeProgress({ phase: "failed", error: "projection failed", courses: [] });
  await context.close();
  process.exit(1);
}

const adapter = writeAdaptersFromProjection({
  userRoot,
  generation,
  projections,
  daysAhead: weekTableDays,
});
if (!adapter.ok) {
  console.warn(`adapters failed (canonical snapshot kept): ${adapter.errors.join("; ")}`);
}

try {
  writeCatalogsFromGeneration(generation);
} catch (e) {
  console.warn(`course catalogs adapter failed: ${e.message || e}`);
}

writeSyncRun(userRoot, {
  sync_id,
  started_at: generation.manifest.started_at,
  finished_at: generation.manifest.finished_at,
  complete: generation.manifest.complete,
  health: projections?.health || null,
});

// Change events vs the previous generation, skip costs, and (weekly) feed
// capture while the session page is still open. Never fails the sync.
const freshness = await afterCanonicalSync({
  userRoot,
  previous: previousRaw?.generation || null,
  generation,
  page,
  api,
  base: getBase(),
});
if (freshness.errors.length) console.warn(`freshness: ${freshness.errors.join("; ")}`);

// Course card colours for Blot. One read-only GET; never fails the sync.
const colors = await syncCourseColors({ page, api, userRoot });
if (!colors.ok) console.warn(colors.error);

writeProgress({
  phase: generation.manifest.complete ? "done" : "done",
  error: null,
  courses: generation.courses.map((p) => ({
    id: String(p.course.id),
    label: p.course.course_code || p.course.name,
    ok: !(generation.manifest.named_courses_failed || []).includes(String(p.course.id)),
  })),
});

{
  // browser/.. → the core root (repo checkout, or Contents/Resources/core in an
  // installed app). reconcile has no --json flag. See reconcile-command.mjs.
  const coreRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const plan = reconcileCommand({ coreRoot });
  const proc = plan
    ? spawnSync(plan.command, plan.args, plan.options)
    : { status: null, stderr: "no Python runtime available for learn_loop reconcile" };
  const reconcile = proc.status === 0
    ? { ok: true, status: proc.status }
    : { ok: false, status: proc.status, error: String(proc.stderr || "reconcile failed").slice(-2000) };
  surfaceReconcile(userRoot, reconcile);
  writeSyncRun(userRoot, {
    sync_id,
    started_at: generation.manifest.started_at,
    finished_at: generation.manifest.finished_at,
    complete: Boolean(generation.manifest.complete && reconcile.ok),
    health: { ...(projections?.health || {}), reconcile },
  });
  if (!reconcile.ok) {
    console.warn("learn_loop reconcile exited non-zero — checkpoint drift may be stale");
    if (proc.stderr) console.warn(proc.stderr.trim());
  }
  writeProgress({ phase: "done", error: reconcile.ok ? null : "reconcile_failed", reconcile, courses: generation.courses.map((p) => ({ id: String(p.course.id), label: p.course.course_code || p.course.name, ok: !(generation.manifest.named_courses_failed || []).includes(String(p.course.id)) })) });
}

await context.close();
console.log(JSON.stringify({ sync_id, complete: generation.manifest.complete, reconcile: JSON.parse(fs.readFileSync(path.join(userRoot, "inbox", "sync-health.json"), "utf8")).reconcile, courses: generation.courses.length }, null, 2));
