/**
 * Compatibility views from canonical projections. Adapter failure must not
 * touch raw generations.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildWeekNoteParts,
  collectTruncationWarnings,
  escCell,
  filterDatedInWindow,
  formatDueForSync,
  resolveCourseFile,
  schoolLocalDay,
  shouldIncludeInWeekTable,
} from "./canvas-session.mjs";
import { courseRecord } from "./study-sources.mjs";
import { resolveUserRoot } from "./user-root.mjs";
import { completeFromItem } from "./work-completion.mjs";

export function itemsToWeekRows(items, courses) {
  const byId = Object.fromEntries((courses || []).map((c) => [String(c.id), c]));
  return items.map((it) => {
    const c = byId[it.course_id] || {};
    return {
      source: (it.seen_in || [])[0] || "assignment",
      course: c.name || c.course_code || it.course_name || it.course_id,
      title: it.title,
      description: it.description || "",
      submission_types: it.submission_types || [],
      due: it.effective_due_at || "",
      points: it.points_possible ?? "",
      type: it.object_type,
      html_url: it.html_url || "",
      complete: completeFromItem(it),
      course_id: it.course_id,
      canvas_id: it.canvas_id,
      lti: it.lti,
      notes: it.disagreements?.length ? "sources disagree" : it.lti ? "external/LTI" : "",
    };
  });
}

export function generateWeekMarkdown({ items, courses, health, daysAhead = 14, today, timezone, sync_id }) {
  const day = today || schoolLocalDay();
  const rows = itemsToWeekRows(items, courses);
  const openRows = filterDatedInWindow(rows, { today: day, daysAhead, includeComplete: false }).filter(shouldIncludeInWeekTable);
  const doneRows = filterDatedInWindow(rows, { today: day, daysAhead, includeComplete: true }).filter((r) => r.complete);
  const notes = [
    `Canonical projection sync_id=${sync_id}. SSO→/api/v1. Health=${health?.state}.`,
    `Window: ${day} → +${daysAhead}d ${timezone || health?.timezone || "UTC"}. Open: ${openRows.length}; completed hidden: ${doneRows.length}.`,
  ];
  for (const reason of health?.partial_reasons || []) notes.push(`Partial sync: ${reason}`);
  const truncationWarnings = collectTruncationWarnings({
    planner: { truncated: health?.truncated?.includes("planner") },
    assignments: { truncated: health?.truncated?.includes("assignments") },
    todo: { truncated: health?.truncated?.includes("todo") },
  });
  if (truncationWarnings.length) {
    notes.push(`**TRUNCATION WARNING:** ${truncationWarnings.join("; ")}`);
  }
  if (health?.advisory_truncated?.includes("planner")) {
    notes.push("Planner coverage is advisory and incomplete; assignments/calendar remain the due-date sources.");
  }
  const table =
    openRows.length > 0
      ? openRows
          .map((r) => {
            const noteParts = buildWeekNoteParts(r);
            return `| ${escCell(r.course)} | ${escCell(r.title)} | ${escCell(formatDueForSync(r.due, timezone))} | ${escCell(r.points)} | ${escCell(r.type)} | ${escCell(noteParts.join("; "))} |`;
          })
          .join("\n")
      : "| | | | | | |";
  const courseList = (courses || []).map((c) => `- ${escCell(c.name || c.course_code)} (\`${c.course_code || c.id}\`)`).join("\n");
  return `# Week ahead

Updated: ${day}

Source: canvas-reliability projection (${sync_id})

## Due window (${daysAhead}d, open only)

| Course | Assignment | Due | Points | Type | Notes |
|--------|------------|-----|--------|------|-------|
${table}

## Enrolled courses (from /api/v1/courses)

${courseList || "- (none)"}

## Sync notes

${notes.map((n) => `- ${n}`).join("\n")}

## Agent next steps

1. Read \`USER.md\` and triage this table (Worth / Agent / Ask).
2. For rows marked external/LTI or assessment (Bucket B) — process help only; the student does the tool UI.
3. Review \`inbox/tool-gaps.md\` for Bucket-A tools without a registry connector — flag only; never auto-build.
4. Native Canvas text/file work is preview-only: review the preview, then submit it yourself in Canvas.
`;
}

export function writeAdaptersFromProjection({
  userRoot,
  generation,
  projections,
  daysAhead = 14,
} = {}) {
  const root = userRoot || resolveUserRoot({ create: true });
  const inbox = path.join(root, "inbox");
  const errors = [];
  const sync_id = projections.sync_id;
  const syncDay = schoolLocalDay(new Date(generation.manifest?.finished_at || Date.now()));
  const courses = (generation.courses || []).map((p) => p.course);
  try {
    const md = generateWeekMarkdown({
      items: projections.work_surface.items,
      courses,
      health: projections.health,
      daysAhead,
      today: syncDay,
      timezone: generation.timezone,
      sync_id,
    });
    fs.mkdirSync(inbox, { recursive: true });
    const weekPath = path.join(inbox, "week.md");
    fs.writeFileSync(weekPath, md, "utf8");
  } catch (e) {
    errors.push(`week.md: ${e.message || e}`);
  }
  try {
    const lines = [
      `# Synced from Canvas enrollments (computed_* scores). Local GPA estimate only.`,
      `# grade scenarios live in inbox/canvas/projections/${sync_id}/grade-truth/`,
      `synced_at: "${syncDay}"`,
      `sync_id: "${sync_id}"`,
      `courses:`,
    ];
    if (!courses.length) lines.push("  []");
    else {
      for (const c of courses) {
        const enrollment = (c.enrollments || [])[0] || {};
        const filePath = resolveCourseFile(c.name, c.course_code);
        const code = filePath
          ? path.basename(filePath, ".md")
          : String(c.course_code || c.id || "").replace(/\s+/g, "").toUpperCase();
        lines.push(`  - code: ${JSON.stringify(code)}`);
        lines.push(`    name: ${JSON.stringify(c.name || "")}`);
        lines.push(`    canvas_course_id: ${c.id ?? "null"}`);
        lines.push(`    letter: ${JSON.stringify(enrollment.computed_current_grade || "")}`);
        const pct = enrollment.computed_current_score;
        lines.push(`    percent: ${pct == null || pct === "" ? "null" : Number(pct)}`);
      }
    }
    fs.writeFileSync(path.join(inbox, "grades.yaml"), `${lines.join("\n")}\n`, "utf8");
  } catch (e) {
    errors.push(`grades.yaml: ${e.message || e}`);
  }
  try {
    const outDir = path.join(inbox, "study-sources");
    fs.mkdirSync(outDir, { recursive: true });
    const summaries = [];
    for (const pack of generation.courses || []) {
      const courseId = String(pack.course.id);
      const failedEndpoints = (generation.manifest?.failed_endpoints || [])
        .filter((row) => String(row.endpoint || row).endsWith(`:${courseId}`) || String(row.endpoint || row).includes(`:${courseId}:`))
        .map((row) => String(row.endpoint || row));
      const courseTruncated = (generation.manifest?.pagination || [])
        .some((row) => String(row.endpoint || row).endsWith(`:${courseId}`) || String(row.endpoint || row).includes(`:${courseId}:`));
      const record = courseRecord({
        course: pack.course,
        syllabus: pack.course.syllabus_body,
        pages: pack.pages || [],
        moduleSources: pack.moduleSources || [],
        assignments: pack.assignments || [],
        quizzes: pack.quizzes || [],
        assignmentGroups: pack["assignment-groups"] || [],
        fetchedAt: generation.manifest?.finished_at,
        errors: failedEndpoints,
        truncated: courseTruncated,
      });
      record.sync_id = sync_id;
      record.projection_schema = projections.schema_version;
      const target = path.join(outDir, `${pack.course.id}.json`);
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
      fs.renameSync(tmp, target);
      summaries.push({ id: courseId, label: record.course.label, ok: failedEndpoints.length === 0 && !courseTruncated, errors: failedEndpoints, truncated: courseTruncated });
    }
    fs.writeFileSync(
      path.join(outDir, "status.json"),
      JSON.stringify(
        {
          schema: 2,
          sync_id,
          projection_schema: projections.schema_version,
          started_at: generation.manifest?.started_at,
          finished_at: generation.manifest?.finished_at,
          ok: Boolean(generation.manifest?.complete && errors.length === 0),
          partial: !generation.manifest?.complete || errors.length > 0,
          session: "ok",
          errors,
          courses: summaries,
        },
        null,
        2
      )
    );
  } catch (e) {
    errors.push(`study-sources: ${e.message || e}`);
  }
  return { ok: errors.length === 0, errors, sync_id };
}
