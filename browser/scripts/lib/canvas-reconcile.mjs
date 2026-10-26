/**
 * Deterministic due-work reconciler. One item, many signals. Keep seen_in.
 */
import { effectiveDateFromAssignment, identityKey, requireCanvasId, isHttpUrl } from "./canvas-model.mjs";

function objectTypeFor(row, fallback) {
  const t = String(row?.plannable_type || row?.type || fallback || "assignment").toLowerCase();
  if (t.includes("quiz")) return "quiz";
  if (t.includes("discussion")) return "discussion";
  if (t.includes("calendar")) return "calendar_event";
  return "assignment";
}

function submissionState(sub, { published = true } = {}) {
  if (!published) return "suppressed";
  if (!sub || typeof sub !== "object") return "unsubmitted";
  const wf = String(sub.workflow_state || "").toLowerCase();
  if (wf === "graded" || sub.score != null && sub.posted_at) return "graded";
  if (wf === "pending_review" || wf === "pending_review".replace("_", "")) return "pending_review";
  if (wf === "pending review") return "pending_review";
  if (wf === "submitted" || sub.submitted_at) {
    if (sub.late || wf === "late") return "late";
    return "submitted";
  }
  if (wf === "missing" || sub.missing) return "missing";
  if (wf === "late") return "late";
  if (wf === "unsubmitted" || wf === "unsubmitted") return "unsubmitted";
  if (!wf) return "unknown";
  return "unsubmitted";
}

function courseIdFrom(row, fallback) {
  if (row?.course_id != null) return String(row.course_id);
  const m = String(row?.context_code || "").match(/course_(\d+)/);
  if (m) return m[1];
  return fallback != null ? String(fallback) : null;
}

function pushSeen(item, source) {
  if (!item.seen_in.includes(source)) item.seen_in.push(source);
}

function disagreement(item, field, value, source) {
  if (value == null || value === "") return;
  const prev = item[field];
  if (prev == null || prev === "") {
    item[field] = value;
    return;
  }
  if (String(prev) !== String(value)) {
    item.disagreements.push({ field, sources: [item.field_sources?.[field] || "assignment", source], values: [prev, value] });
  }
}

export function reconcile_due_items(generation) {
  const tenant_id = generation.tenant_id || generation.manifest?.tenant_id;
  const timezone = generation.timezone || generation.manifest?.timezone || "UTC";
  const fetched_at = generation.fetched_at || generation.manifest?.finished_at;
  const byKey = new Map();
  const unkeyed_sources = [];

  function ensure({ course_id, object_type, canvas_id }) {
    const key = identityKey({ tenant_id, course_id, object_type, canvas_id });
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: key,
        tenant_id,
        course_id,
        object_type,
        canvas_id,
        title: "",
        description: "",
        submission_types: [],
        html_url: null,
        points_possible: null,
        assignment_group_id: null,
        effective_due_at: null,
        dates: [],
        submission_state: "unknown",
        grade_state: "unknown",
        authority: "authoritative",
        seen_in: [],
        module_placements: [],
        disagreements: [],
        field_sources: {},
        lti: false,
        published: true,
        actionable: true,
        suppress_reason: null,
        fetched_at,
        timezone,
        course_code: null,
        course_name: null,
        color: null,
      });
    }
    return byKey.get(key);
  }

  const courseMeta = new Map();
  for (const pack of generation.courses || []) {
    const c = pack.course || {};
    const cid = String(c.id);
    courseMeta.set(cid, c);
    const groups = pack["assignment-groups"] || [];
    const groupBy = Object.fromEntries(groups.map((g) => [String(g.id), g]));

    for (const a of pack.assignments || []) {
      const got = requireCanvasId(a, { object_type: "assignment" });
      if (!got.ok) {
        unkeyed_sources.push({ course_id: cid, ...got.unkeyed });
        continue;
      }
      const item = ensure({ course_id: cid, object_type: "assignment", canvas_id: got.canvas_id });
      item.title = a.name || a.title || item.title;
      item.description = [a.description || "", a.external_tool_tag_attributes?.url || ""]
        .filter(Boolean)
        .join(" ");
      item.submission_types = a.submission_types || [];
      item.html_url = isHttpUrl(a.html_url) ? a.html_url : item.html_url;
      item.points_possible = a.points_possible ?? item.points_possible;
      item.assignment_group_id = a.assignment_group_id != null ? String(a.assignment_group_id) : item.assignment_group_id;
      item.group_weight = groupBy[item.assignment_group_id]?.group_weight ?? null;
      item.grading_type = a.grading_type || null;
      item.published = a.published !== false;
      const dates = effectiveDateFromAssignment(a, { timezone });
      item.effective_due_at = dates.effective_due_at;
      item.dates = dates.dates;
      item.field_sources.effective_due_at = "assignment";
      const types = a.submission_types || [];
      item.lti = types.includes("external_tool") || Boolean(a.external_tool_tag_attributes) || Boolean(a.is_quiz_lti_assignment);
      if (!item.published) {
        item.actionable = false;
        item.suppress_reason = "unpublished";
        item.submission_state = "suppressed";
      } else {
        item.submission_state = submissionState(a.submission, { published: true });
      }
      item.score = a.submission?.score ?? null;
      item.posted_at = a.submission?.posted_at ?? null;
      item.submitted_at = a.submission?.submitted_at ?? null;
      item.course_code = c.course_code || null;
      item.course_name = c.name || null;
      pushSeen(item, "assignment");
    }

    for (const d of pack.discussions || []) {
      const aid = d.assignment_id ?? d.assignment?.id;
      if (aid == null) continue;
      const item = ensure({ course_id: cid, object_type: "assignment", canvas_id: String(aid) });
      if (!item.title) item.title = d.title;
      if (!item.description) item.description = d.message || d.description || "";
      if (!item.submission_types.length) item.submission_types = d.assignment?.submission_types || [];
      pushSeen(item, "discussion");
    }

    for (const q of pack.quizzes || []) {
      const got = requireCanvasId(q, { object_type: "quiz" });
      if (!got.ok) continue;
      const asAssignment = q.assignment_id != null
        ? ensure({ course_id: cid, object_type: "assignment", canvas_id: String(q.assignment_id) })
        : ensure({ course_id: cid, object_type: "quiz", canvas_id: got.canvas_id });
      if (!asAssignment.title) asAssignment.title = q.title;
      asAssignment.html_url = isHttpUrl(q.html_url) ? q.html_url : asAssignment.html_url;
      asAssignment.points_possible = q.points_possible ?? asAssignment.points_possible;
      asAssignment.effective_due_at = asAssignment.effective_due_at || effectiveDateFromAssignment(q).effective_due_at;
      pushSeen(asAssignment, "quiz");
    }

    for (const sub of pack.submissions || []) {
      if (sub.assignment_id == null) continue;
      const item = ensure({ course_id: cid, object_type: "assignment", canvas_id: String(sub.assignment_id) });
      const next = submissionState(sub, { published: item.published });
      if (item.submission_state === "unknown" || item.submission_state === "unsubmitted") {
        item.submission_state = next;
      }
      item.score = sub.score ?? item.score;
      pushSeen(item, "submission");
    }

    (pack.modules || []).forEach((mod, mi) => {
      (mod.items || []).forEach((it, ii) => {
        const contentId = it.content_id ?? it.content_id;
        if (it.type === "Assignment" && contentId != null) {
          const item = ensure({ course_id: cid, object_type: "assignment", canvas_id: String(contentId) });
          item.module_placements.push({
            module_id: String(mod.id),
            module_name: mod.name,
            module_position: mod.position ?? mi + 1,
            item_id: String(it.id),
            item_position: it.position ?? ii + 1,
            indent: it.indent || 0,
            lock: Boolean(it.content_details?.locked || it.locked),
            published: it.published !== false && mod.published !== false,
            completion_requirement: it.completion_requirement || null,
          });
          pushSeen(item, "module");
        }
      });
    });
  }

  for (const p of generation.global?.planner || []) {
    const cid = courseIdFrom(p);
    const got = requireCanvasId(p.plannable || p, { object_type: "assignment" });
    const pid = p.plannable_id ?? got.canvas_id;
    if (!cid || pid == null || pid === "") {
      unkeyed_sources.push({ title: p.plannable?.title || p.plannable_type, object_type: "planner_item" });
      continue;
    }
    const object_type = objectTypeFor(p, "assignment") === "quiz" ? "quiz" : "assignment";
    const item = ensure({ course_id: cid, object_type, canvas_id: String(pid) });
    if (!item.title) item.title = p.plannable?.title || p.plannable?.name || item.title;
    disagreement(item, "effective_due_at", p.plannable_date, "planner");
    if (!item.effective_due_at) item.effective_due_at = p.plannable_date || null;
    item.html_url = isHttpUrl(p.html_url) ? p.html_url : item.html_url;
    pushSeen(item, "planner");
  }

  for (const t of generation.global?.todo || []) {
    const a = t.assignment || {};
    if (a.id == null) {
      unkeyed_sources.push({ title: a.name || t.type, object_type: "todo" });
      continue;
    }
    const cid = courseIdFrom(a, a.course_id);
    const item = ensure({ course_id: String(cid), object_type: "assignment", canvas_id: String(a.id) });
    if (!item.title) item.title = a.name;
    disagreement(item, "effective_due_at", a.due_at, "todo");
    if (!item.effective_due_at) item.effective_due_at = a.due_at || null;
    pushSeen(item, "todo");
  }

  for (const missing of generation.global?.["missing-submissions"] || []) {
    const aid = missing?.id ?? missing?.assignment_id;
    const cid = courseIdFrom(missing, missing?.course_id);
    if (!cid || aid == null || aid === "") {
      unkeyed_sources.push({ title: missing?.name || missing?.title, object_type: "missing_submission" });
      continue;
    }
    const item = ensure({ course_id: String(cid), object_type: "assignment", canvas_id: String(aid) });
    if (!item.title) item.title = missing.name || missing.title || item.title;
    if (item.submission_state === "unknown" || item.submission_state === "unsubmitted") {
      item.submission_state = "missing";
    }
    if (!item.effective_due_at) item.effective_due_at = missing.due_at || null;
    item.html_url = isHttpUrl(missing.html_url) ? missing.html_url : item.html_url;
    pushSeen(item, "missing_submissions");
  }

  for (const ev of generation.global?.["calendar-events"] || []) {
    const cid = courseIdFrom(ev);
    const aid = ev.assignment?.id ?? ev.assignment_id;
    if (!cid || aid == null) {
      if (!aid) unkeyed_sources.push({ title: ev.title, object_type: "calendar_event" });
      continue;
    }
    const item = ensure({ course_id: cid, object_type: "assignment", canvas_id: String(aid) });
    if (!item.title) item.title = ev.title;
    disagreement(item, "effective_due_at", ev.start_at, "calendar");
    if (!item.effective_due_at) item.effective_due_at = ev.start_at || null;
    item.html_url = isHttpUrl(ev.html_url) ? ev.html_url : item.html_url;
    pushSeen(item, "calendar");
  }

  const items = [...byKey.values()].map((it) => {
    it.seen_in.sort();
    it.grade_state = it.score != null && it.posted_at ? "graded" : it.score != null ? "inferred" : "unknown";
    if (it.lti) it.launch_out = true;
    const c = courseMeta.get(it.course_id);
    if (c) {
      it.course_code = c.course_code || it.course_code;
      it.course_name = c.name || it.course_name;
    }
    return it;
  });
  items.sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
  return { items, unkeyed_sources };
}

export function bucketWorkItem(item, { nowIso, timezone } = {}) {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const due = item.effective_due_at ? Date.parse(item.effective_due_at) : NaN;
  const st = item.submission_state;
  if (st === "suppressed") return "suppressed";
  if (st === "missing") return "missing";
  if (st === "submitted" || st === "pending_review") return "submitted";
  if (st === "late") return "overdue";
  if (st === "graded") return item.score == null ? "ungraded" : "graded";
  if (!item.effective_due_at) return "no-date";
  if (st === "unsubmitted" && Number.isFinite(due) && due < now) return "overdue";
  if (st === "unsubmitted") return "future";
  if (st === "unknown") return "unknown";
  return "future";
}

export function workSurfaceFromItems(items, { nowIso, filters = {}, sync_id, health } = {}) {
  const buckets = {
    future: [],
    overdue: [],
    missing: [],
    submitted: [],
    ungraded: [],
    "no-date": [],
    graded: [],
    suppressed: [],
    unknown: [],
  };
  for (const item of items) {
    if (filters.course_id && item.course_id !== String(filters.course_id)) continue;
    const b = bucketWorkItem(item, { nowIso });
    if (!buckets[b]) buckets[b] = [];
    buckets[b].push(item);
  }
  return {
    sync_id,
    health_state: health?.state,
    as_of: health?.as_of,
    timezone: health?.timezone,
    inspect_in_canvas: true,
    filters,
    buckets,
    items,
  };
}
