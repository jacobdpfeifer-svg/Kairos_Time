/**
 * Deterministic brief assembly: the common frame (do this next, what it
 * requires, pre-flight checklist, why it matters, materials, a safe next path)
 * plus the kind module. Pure — inputs in, a schema-valid brief out. No model,
 * no network, no Canvas write of any kind.
 */
import crypto from "node:crypto";
import { briefKind, isExternalTool, isSparse } from "./classify.mjs";
import { ANSWER_SOURCE_RE, buildModule, requirementLines } from "./modules.mjs";
import { localDay, plannedDay, rankIslands, recentChanges, shareOf, weekKey } from "./rank.mjs";
import { FRAME_SECTIONS, ID_RE, LIMITS, SCHEMA_VERSION, WORK_ITEM_RE, clipText, validateBrief, validateIndex } from "./schema.mjs";

const DAY = 86_400_000;
const STALE_SOURCE_MS = 3 * DAY;
const STOP = new Set(["the", "and", "for", "with", "from", "your", "this", "that", "assignment", "homework", "part", "week", "due", "quiz", "exam", "unit", "module"]);

function t(v) {
  const n = Date.parse(v || "");
  return Number.isFinite(n) ? n : null;
}

export function sha(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

/** Key-sorted JSON so a fingerprint never changes because of property order. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** `item-a123` → `a123`: unique across assignments and quizzes, safe as a file-name part. */
export function assignmentIdOf(item) {
  const raw = String(item.id || "").replace(/^item-/, "");
  return ID_RE.test(raw) ? raw : null;
}

function keywords(title) {
  return String(title || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Course sources that plausibly relate to this item, by shared title words or an explicit exam flag. */
export function relatedSources(record, item, kind) {
  const words = keywords(item.title);
  const numbers = (String(item.title).match(/\b\d+(?:\.\d+)?\b/g) || []).filter((n) => n.length <= 4);
  const out = [];
  for (const s of record.sources || []) {
    if (s.kind === "assignment" && String(s.canvas_id) === String(item.canvas_id)) continue;
    if (s.kind === "syllabus") continue;
    if (s.part && s.part > 1) continue;
    const hay = String(s.title || "").toLowerCase();
    const wordHit = words.some((w) => hay.includes(w));
    const numberHit = numbers.length && numbers.some((n) => new RegExp(`\\b${n.replace(".", "\\.")}\\b`).test(hay)) && /chapter|section|unit|week|module|lecture/i.test(hay);
    const examHit = (kind === "exam" || kind === "quiz") && s.exam_relevant;
    if (wordHit || numberHit || examHit) out.push(s);
    if (out.length >= 6) break;
  }
  // Live graded work never gets an answer key or solution as "material".
  return out.filter((s) => !ANSWER_SOURCE_RE.test(s.title));
}

function httpsOrNull(url) {
  return typeof url === "string" && /^https:\/\//.test(url) ? url.slice(0, 2048) : null;
}

function submissionLine(item) {
  const types = (item.submission_types || []).map(String);
  if (types.includes("external_tool")) return "Submitted through an external tool (you open and use it yourself)";
  if (types.includes("online_quiz")) return "Taken as a Canvas quiz";
  if (types.includes("discussion_topic")) return "Posted as a Canvas discussion (you write and post it)";
  if (types.includes("on_paper")) return "Turned in on paper";
  if (types.includes("none") || !types.length) return "Submission type: not found in Canvas";
  const named = types.map((x) => ({ online_upload: "file upload", online_text_entry: "text entry", online_url: "a link", media_recording: "media recording" })[x] || x.replace(/_/g, " "));
  return `Submit online: ${named.join(" or ")}`;
}

function nextStep(kind, sparse) {
  if (sparse && kind !== "exam" && kind !== "quiz") return "Open it in Canvas and write down what it asks for (5 min)";
  return (
    {
      exam: "Start a 25-minute practice set in Study",
      quiz: "Start a 15-minute practice set in Study",
      math: "List the topic each problem uses, then try the first one (20 min)",
      writing: "Re-read the prompt and underline every requirement (10 min)",
      project: "Turn the deliverables into a checklist (15 min)",
      lab: "Read the lab steps and check you have every tool (15 min)",
      reading: "Skim the headings and write two questions to read for (15 min)",
      discussion: "Read the prompt and jot your first point in your own words (10 min)",
    }[kind] || "Read the instructions and turn them into a checklist (10 min)"
  );
}

export function sectionOrder(kind, prefs) {
  const arm = prefs?.beta_opt_in && prefs?.beta_arm ? prefs.beta_arm : prefs?.default_order || "next_step_first";
  let order = arm === "requirements_first" ? ["requirements", "next_step", "checklist", "why", "module", "materials"] : ["next_step", "requirements", "checklist", "why", "module", "materials"];
  // Paper "outline first" / problem-set "concept map first" lift the module, never hide requirements.
  if ((kind === "writing" && prefs?.paper_first === "outline") || (kind === "math" && prefs?.problem_set_first && prefs.problem_set_first !== "next_step")) {
    order = ["module", ...order.filter((s) => s !== "module")];
  }
  if (kind === "writing" && prefs?.paper_first === "requirements") order = ["requirements", ...order.filter((s) => s !== "requirements")];
  return order.filter((s) => FRAME_SECTIONS.includes(s));
}

function whyItMatters(item, skipCost, exam, courseLabel) {
  const parts = [];
  if (skipCost && skipCost.status !== "cannot_calculate" && skipCost.current != null && skipCost.if_zero != null) {
    const est = skipCost.status === "estimate" ? " (an estimate)" : "";
    parts.push(`Skipping it would take your ${courseLabel} grade from ${skipCost.current}% to about ${skipCost.if_zero}%${est}, from your Canvas grades.`);
  } else if (Number(item.weight_share) > 0) {
    parts.push(`It's about ${Math.max(1, Math.round(Number(item.weight_share) * 100))}% of your ${courseLabel} grade, from Canvas weights.`);
  }
  if (exam) parts.push(`It comes before ${exam.label}, so it's practice for that (inferred from Canvas titles).`);
  if (parts.length) return { text: parts.join(" "), general: false };
  return { text: "Canvas has no grade weight for this. Work that's done on time usually makes the next exam easier.", general: true };
}

/**
 * @param {object} c candidate: { item, record, kind, skipCost, changes, planned, reason, state, rank }
 * @param {{ now: number, prefs: object }} ctx
 */
export function assembleBrief(c, { now, prefs }) {
  const { item, record } = c;
  const course = record.course || {};
  const kind = c.kind;
  const sparse = isSparse(item);
  const assignmentId = assignmentIdOf(item);
  const courseId = String(course.id);
  const fetchedAt = record.fetched_at || null;
  const html = httpsOrNull(item.html_url);
  const desc = String(item.description || "");

  const evidence = [];
  const canvasEvidenceId = `canvas-${assignmentId}`;
  evidence.push({
    id: canvasEvidenceId,
    label: `Canvas: ${clipText(item.title, 200)}`,
    kind: "canvas",
    locator: html,
    retrieved_at: fetchedAt,
    excerpt: desc ? clipText(desc, LIMITS.excerpt) : null,
    fingerprint: sha({ title: item.title, due_at: item.due_at, points: item.points_possible, desc }).slice(0, 16),
  });
  const related = relatedSources(record, item, kind).slice(0, LIMITS.evidence - 2).map((s) => {
    const id = `src-${String(s.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100)}`;
    evidence.push({
      id,
      label: clipText(s.title, 200),
      kind: "course_source",
      locator: httpsOrNull(s.url),
      retrieved_at: s.updated_at || fetchedAt,
      excerpt: clipText(s.text, 240),
      fingerprint: sha(String(s.text || "")).slice(0, 16),
    });
    return { evidenceId: id, source: s };
  });

  const due = t(item.due_at);
  const exams = (record.exams || []).filter((e) => e.label !== item.title && t(e.due_at) != null && (due == null || t(e.due_at) > due)).sort((a, b) => t(a.due_at) - t(b.due_at));
  const exam = kind === "exam" || kind === "quiz" ? null : exams[0] || null;
  const examCoverage = (record.exams || []).find((e) => e.label === item.title) || null;
  const why = whyItMatters(item, c.skipCost, exam, course.code || course.label || "course");
  if (why.general) evidence.push({ id: "general", label: "General study recommendation", kind: "general_recommendation", locator: null, retrieved_at: null, excerpt: null });

  const mod = buildModule({ item, kind, sparse, related, exam, examCoverage, prefs, canvasEvidenceId, now });

  // What the assignment requires: Canvas facts, unknowns said plainly.
  const requirements = [];
  requirements.push(item.points_possible != null ? `Worth ${item.points_possible} points` : "Points: not found in Canvas");
  const share = shareOf(c);
  if (share != null && share > 0) requirements.push(`About ${Math.max(1, Math.round(share * 100))}% of the course grade`);
  if (!item.due_at) requirements.push("Due date: not found in Canvas");
  requirements.push(submissionLine(item));
  const reqLines = requirementLines(desc);
  requirements.push(...reqLines);
  if (!reqLines.length) requirements.push(sparse ? "Instructions: not found in Canvas" : "No explicit requirements stated; read the full instructions in Canvas");

  // Pre-flight checklist: preparation, never a claim that work was submitted.
  const checklist = [];
  reqLines.slice(0, 3).forEach((line, i) => checklist.push({ id: `req-${i}`, text: `Check: ${line}`, kind: "source_backed", evidence_ids: [canvasEvidenceId] }));
  if (html && checklist.length < 2) checklist.push({ id: "open-canvas", text: "Open the instructions in Canvas and read them through once", kind: "source_backed", evidence_ids: [canvasEvidenceId] });
  if (c.planned) checklist.push({ id: "planned", text: `You planned this for ${c.planned.day} in Week`, kind: "student_setting" });
  for (const [i, p] of mod.proposals.entries()) if (checklist.length < 6) checklist.push({ id: `prop-${i}`, text: p, kind: "agent_proposal" });
  const fillers = [
    { id: "materials", text: "Gather the materials listed below in one place", kind: "agent_proposal" },
    { id: "time", text: "Pick a time today or tomorrow to start", kind: "agent_proposal" },
    { id: "questions", text: "Write down anything unclear to ask your instructor", kind: "agent_proposal" },
  ];
  for (const f of fillers) if (checklist.length < 3) checklist.push(f);
  checklist.splice(7);

  // A safe next path. No Canvas submission, comment, or post — by construction.
  const actions = [];
  const studyFirst = kind === "exam" || kind === "quiz";
  if (studyFirst) actions.push({ id: "study", label: "Start studying", kind: "study", availability: "available", target: String(item.id), primary: true });
  if (html) actions.push({ id: "open-canvas", label: "Open in Canvas", kind: "open_canvas", availability: "available", target: html, primary: !studyFirst });
  if (!studyFirst && kind !== "unknown" && !sparse) actions.push({ id: "study", label: "Practice in Study", kind: "study", availability: "available", target: null });
  actions.push({ id: "ask", label: "Ask about this", kind: "ask", availability: "available", target: null, primary: !studyFirst && !html });
  if (due != null && due > now) actions.push({ id: "calendar", label: "Propose a study block", kind: "calendar_preview", availability: "available", target: null });

  const gaps = [...mod.gaps];
  const fetchedMs = t(fetchedAt);
  // Coarse bucket only. The raw fetched_at must not move the fingerprint on a routine refresh.
  const sourceFreshness = fetchedMs != null && now - fetchedMs > STALE_SOURCE_MS ? "stale" : "fresh";
  let state;
  if (sparse && !(studyFirst && related.length)) state = "needs_source";
  else if (sourceFreshness === "stale") {
    state = "stale";
    gaps.unshift("Canvas hasn't synced in over 3 days");
  } else state = gaps.length ? "partial" : "ready";

  const fingerprintInputs = {
    item: { title: item.title, due_at: item.due_at, points: item.points_possible, desc, types: item.submission_types, kind },
    sources: related.map((r) => [r.source.id, sha(String(r.source.text || "")).slice(0, 16)]),
    exams: (record.exams || []).map((e) => [e.label, e.due_at]),
    skip: c.skipCost ? [c.skipCost.current, c.skipCost.if_zero, c.skipCost.status] : null,
    planned: c.planned?.day || null,
    prefs: prefs ? [prefs.paper_first, prefs.problem_set_first, prefs.default_order, prefs.beta_opt_in ? prefs.beta_arm : null] : null,
    source_freshness: sourceFreshness,
  };
  const expiresCandidates = [now + DAY, due != null && due > now ? due : null].filter((x) => x != null);

  const brief = {
    schema_version: SCHEMA_VERSION,
    id: `${courseId}--${assignmentId}`,
    assignment_id: assignmentId,
    course_id: courseId,
    course_label: clipText(course.label || course.code || course.name || `Course ${courseId}`, 200),
    course_color: /^#[0-9A-Fa-f]{6}$/.test(course.color || "") ? course.color : "#2E86AB",
    title: clipText(item.title, LIMITS.title),
    kind,
    due_at: item.due_at || null,
    points_possible: item.points_possible ?? null,
    state,
    gaps: gaps.slice(0, 6).map((g) => clipText(g, 160)),
    prepared_at: new Date(now).toISOString(),
    expires_at: new Date(Math.min(...expiresCandidates)).toISOString(),
    source_fingerprint: sha(fingerprintInputs),
    next_step: nextStep(kind, sparse),
    priority_reason: clipText(c.reason, 160),
    requirements: requirements.slice(0, LIMITS.requirements).map((r) => clipText(r, LIMITS.line)),
    checklist,
    why_it_matters: why.text,
    why_is_general: why.general,
    evidence: evidence.slice(0, LIMITS.evidence),
    module: { kind, title: mod.title, sections: mod.sections },
    actions,
    section_order: sectionOrder(kind, prefs),
  };
  if (typeof c.work_item_id === "string" && WORK_ITEM_RE.test(c.work_item_id)) brief.work_item_id = c.work_item_id;
  return validateBrief(brief);
}

/** Open, meaningful work. Completed and low-signal rows never become islands. */
export function isCandidate(item, { now, planned }) {
  if (item.completed) return false;
  if (!assignmentIdOf(item)) return false;
  const due = t(item.due_at);
  if (item.kind === "other" && !(Number(item.points_possible) > 0)) return false;
  if (due == null) return Boolean(planned);
  if (due < now - 14 * DAY) return false;
  if (due > now + 21 * DAY) return false;
  // Ungraded and zero-point work stays in Week unless it's an exam or the student planned it.
  if (!(Number(item.points_possible) > 0) && item.kind !== "exam" && !planned) return false;
  return true;
}

/**
 * Pure: every input already loaded. Returns { index, briefs }.
 * @param {{ records: object[], events?: object[], skipCosts?: object, plan?: object|null, prefs?: object|null, now: number, timeZone: string }} input
 */
/**
 * Index work-state rows once per rebuild. A brief links only to a canonical
 * Canvas work item: during a partial sync work state keeps a student decision
 * as a `plan:` orphan, and linking to that would fail the brief schema and
 * take every island down with it.
 */
export function workItemIndex(workItems) {
  const byPlan = new Map();
  const byCanvas = new Map();
  if (!Array.isArray(workItems)) return { byPlan, byCanvas };
  for (const row of workItems) {
    const id = String(row?.id || "");
    if (!WORK_ITEM_RE.test(id)) continue;
    const planId = row?.student?.plan_id;
    if (typeof planId === "string" && !byPlan.has(planId)) byPlan.set(planId, id);
    const parts = id.split(":");
    const key = `${parts[2]}\u0000${parts[4]}`;
    if (!byCanvas.has(key)) byCanvas.set(key, id);
  }
  return { byPlan, byCanvas };
}

export function workItemIdFor(item, index) {
  if (!index) return null;
  const byPlan = index.byPlan.get(item.id);
  if (byPlan) return byPlan;
  return index.byCanvas.get(`${String(item.course_id || "")}\u0000${String(item.canvas_id || "")}`) || null;
}

export function buildBriefProjection({ records, events = [], skipCosts = {}, plan = null, prefs = null, workItems = null, now, timeZone }) {
  const today = localDay(now, timeZone);
  const week = weekKey(today);
  const planAccepted = Boolean(plan?.weeks?.[week]?.accepted);
  const workIndex = workItemIndex(workItems);
  const candidates = [];
  for (const record of records) {
    for (const item of record.items || []) {
      const planned = plan ? plannedDay(item.id, plan, week) : null;
      if (!isCandidate(item, { now, planned })) continue;
      candidates.push({
        item,
        record,
        kind: briefKind(item, record.course),
        skipCost: skipCosts[`${item.course_id}:${item.canvas_id}`] || null,
        changes: recentChanges(events, item, now),
        planned,
        work_item_id: workItemIdFor(item, workIndex),
      });
    }
  }
  const { shown, rest } = rankIslands(candidates, { now, today, planAccepted, timeZone });
  const briefs = shown.map((c) => assembleBrief(c, { now, prefs }));
  const assignments = shown.map((c, i) => {
    const b = briefs[i];
    return {
      kind: "assignment",
      island_id: `island-${b.id}`,
      assignment_id: b.assignment_id,
      course_id: b.course_id,
      title: b.title,
      course_label: b.course_label,
      course_color: b.course_color,
      due_at: b.due_at,
      assignment_kind: b.kind,
      brief_state: b.state,
      state: b.state === "stale" && c.state === "normal" ? "stale" : c.state,
      priority_reason: b.priority_reason,
      rank: c.rank,
      source_fingerprint: b.source_fingerprint,
      focus: Boolean(c.focus),
    };
  });
  const index = validateIndex({ schema_version: SCHEMA_VERSION, generated_at: new Date(now).toISOString(), today, assignments, rest_count: rest });
  return { index, briefs };
}
