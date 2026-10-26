/**
 * Pure helpers for the study-source sync (no network, no Playwright): shape
 * Canvas REST payloads into the `inbox/study-sources/<course>.json` record the
 * Python study core imports. Kept separate so `node --test` can cover them.
 *
 * Schema 2 adds semester-line items (kind, weights, term, color). Weight and
 * term inference live here — the React shell never computes them.
 */
import { stripHtmlTags } from "./canvas-session.mjs";
import { effectiveDateFromAssignment } from "./canvas-model.mjs";
import { completeFromSubmission } from "./work-completion.mjs";

export const MAX_TEXT_CHARS = 60_000;
export const PACKET_TEXT_CHARS = 18_000;
export const MAX_PAGES = 40;
export const SCHEMA_VERSION = 2;
/** Exam-like titles (not quizzes). */
export const EXAM_TITLE_RE = /\b(exam|midterm|final|test)\b/i;
export const QUIZ_TITLE_RE = /\bquiz\b/i;
/** Legacy matcher used by exam-candidate inference (exams + quizzes). */
export const EXAM_OR_QUIZ_TITLE_RE = /\b(exam|midterm|final|test|quiz)\b/i;

/**
 * Okabe–Ito inspired set, shifted so each hue stays readable on Paper cream
 * and Night #1C1C1E. Deuteranopia: blue/gold/teal/rose remain separable
 * (no red-green pair as the only distinction).
 */
export const COURSE_PALETTE = [
  "#2E86AB",
  "#E09F3E",
  "#2A9D8F",
  "#C44569",
  "#5B8DEF",
  "#E76F51",
  "#7B68EE",
  "#6A994E",
];

export function clip(text, max = MAX_TEXT_CHARS) {
  const value = String(text || "");
  return value.length > max ? { text: value.slice(0, max), truncated: true } : { text: value, truncated: false };
}

function chunks(source) {
  const text = String(source?.text || "");
  if (text.length <= PACKET_TEXT_CHARS) return [source];
  const out = [];
  for (let i = 0; i < text.length; i += PACKET_TEXT_CHARS) {
    const part = Math.floor(i / PACKET_TEXT_CHARS) + 1;
    out.push({ ...source, id: `${source.id}-part-${part}`, title: `${source.title} (part ${part})`, text: text.slice(i, i + PACKET_TEXT_CHARS), truncated: true, part });
  }
  return out;
}

/** Course record used as the packet course label. */
export function courseLabel(course) {
  const code = String(course?.course_code || "").trim();
  const name = String(course?.name || "").trim();
  if (code && name && !name.startsWith(code)) return `${code} — ${name}`;
  return name || code || `course-${course?.id}`;
}

export function courseColor(courseId) {
  const s = String(courseId ?? "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % COURSE_PALETTE.length;
  return COURSE_PALETTE[idx];
}

export function syllabusSource(course) {
  const body = course?.syllabus_body;
  if (!body || !String(body).trim()) return null;
  const { text, truncated } = clip(stripHtmlTags(body));
  if (!text) return null;
  return {
    id: `syllabus-${course.id}`,
    kind: "syllabus",
    title: "Syllabus",
    canvas_id: String(course.id),
    updated_at: course.updated_at || null,
    url: null,
    text,
    truncated,
  };
}

export function pageSource(courseId, page) {
  const { text, truncated } = clip(stripHtmlTags(page?.body || ""));
  if (!text) return null;
  return {
    id: `page-${page.page_id ?? page.url}`,
    kind: "page",
    title: String(page.title || page.url || "Page"),
    canvas_id: String(page.page_id ?? page.url),
    updated_at: page.updated_at || null,
    url: page.html_url || null,
    text,
    truncated,
    course_id: String(courseId),
  };
}

export function moduleSource(courseId, item) {
  const raw = item?.text || (item?.kind === "module_file" ? `[Attachment unavailable for local text extraction: ${item.title || "file"}]` : "");
  const { text, truncated } = clip(item?.kind === "module_file" ? raw : stripHtmlTags(raw));
  if (!text) return null;
  return {
    id: `${item.kind || "module"}-${item.canvas_id || item.id || item.title}`,
    kind: item.kind || "module_page",
    title: String(item.title || "Module material"),
    canvas_id: String(item.canvas_id || item.id || ""),
    updated_at: item.updated_at || null,
    url: item.url || null,
    text,
    truncated,
    course_id: String(courseId),
    exam_relevant: Boolean(item.exam_relevant || /exam|review|study guide|formula|answer|key/i.test(`${item.title || ""} ${text}`)),
  };
}

export function assignmentSource(courseId, assignment) {
  const { text, truncated } = clip(stripHtmlTags(assignment?.description || ""));
  if (!text) return null;
  return {
    id: `assignment-${assignment.id}`,
    kind: "assignment",
    title: String(assignment.name || "Assignment"),
    canvas_id: String(assignment.id),
    updated_at: assignment.updated_at || null,
    url: assignment.html_url || null,
    text,
    truncated,
    course_id: String(courseId),
  };
}

export function classifyItem(raw, { fromQuiz = false } = {}) {
  const title = String(raw?.name || raw?.title || "");
  const types = Array.isArray(raw?.submission_types) ? raw.submission_types.map(String) : [];
  if (types.includes("discussion_topic") || String(raw?.type || "") === "discussion") return "discussion";
  const quizLike =
    fromQuiz ||
    raw?.is_quiz_assignment ||
    Boolean(raw?.quiz_id) ||
    QUIZ_TITLE_RE.test(title) ||
    ["assignment", "graded_quiz", "practice_quiz"].includes(String(raw?.quiz_type || ""));
  if (EXAM_TITLE_RE.test(title) && !QUIZ_TITLE_RE.test(title)) return "exam";
  if (quizLike || QUIZ_TITLE_RE.test(title)) return "quiz";
  if (types.includes("none") && !(raw?.points_possible > 0)) return "other";
  return "assignment";
}

export function itemFromAssignment(courseId, assignment, groupById = {}) {
  const groupId = assignment?.assignment_group_id ?? null;
  const group = groupId != null ? groupById[String(groupId)] : null;
  const submitted = completeFromSubmission(assignment?.submission);
  return {
    id: `item-a${assignment.id}`,
    canvas_id: String(assignment.id),
    course_id: String(courseId),
    title: String(assignment.name || "Assignment"),
    kind: classifyItem(assignment),
    points_possible: numOrNull(assignment?.points_possible),
    assignment_group_id: groupId != null ? String(groupId) : null,
    group_weight: group?.group_weight ?? null,
    due_at: effectiveDateFromAssignment(assignment).effective_due_at,
    html_url: assignment?.html_url || null,
    submission_types: Array.isArray(assignment?.submission_types) ? assignment.submission_types : [],
    completed: Boolean(submitted),
    description: stripHtmlTags(assignment?.description || "") || "",
  };
}

export function itemFromQuiz(courseId, quiz) {
  const submitted = Boolean(quiz?.submission?.attempt) || completeFromSubmission(quiz?.submission);
  return {
    id: `item-q${quiz.id}`,
    canvas_id: String(quiz.id),
    course_id: String(courseId),
    title: String(quiz.title || "Quiz"),
    kind: classifyItem(quiz, { fromQuiz: true }),
    points_possible: numOrNull(quiz?.points_possible),
    assignment_group_id: quiz?.assignment_group_id != null ? String(quiz.assignment_group_id) : null,
    group_weight: null,
    due_at: effectiveDateFromAssignment(quiz).effective_due_at,
    html_url: quiz?.html_url || null,
    submission_types: ["online_quiz"],
    completed: Boolean(submitted),
    description: stripHtmlTags(quiz?.description || "") || "",
  };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute each item's share of the course grade.
 * Group-weighted: group_weight × points / group_total.
 * Otherwise: points / course_total.
 * Zero-point / ungraded items get a floor share of 0.
 */
export function applyWeightShares(items, { useGroupWeights = false } = {}) {
  const rows = items.map((it) => ({ ...it }));
  const weighted = useGroupWeights && rows.some((it) => it.group_weight != null && Number(it.group_weight) > 0);
  if (weighted) {
    const groupTotals = new Map();
    for (const it of rows) {
      const gid = it.assignment_group_id || "_none";
      const pts = Math.max(0, it.points_possible || 0);
      groupTotals.set(gid, (groupTotals.get(gid) || 0) + pts);
    }
    for (const it of rows) {
      const gid = it.assignment_group_id || "_none";
      const total = groupTotals.get(gid) || 0;
      const gw = Number(it.group_weight) || 0;
      const pts = Math.max(0, it.points_possible || 0);
      it.weight_share = total > 0 && gw > 0 ? (gw / 100) * (pts / total) : 0;
    }
  } else {
    const total = rows.reduce((s, it) => s + Math.max(0, it.points_possible || 0), 0);
    for (const it of rows) {
      const pts = Math.max(0, it.points_possible || 0);
      it.weight_share = total > 0 ? pts / total : 0;
    }
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function inferTerm(course, items = []) {
  const start = course?.start_at || course?.term?.start_at || null;
  const end = course?.end_at || course?.term?.end_at || null;
  if (start && end) {
    return { start_at: start, end_at: end, source: "canvas" };
  }
  const dues = items.map((it) => it.due_at).filter(Boolean).map((d) => Date.parse(d)).filter(Number.isFinite);
  if (!dues.length) {
    return { start_at: start, end_at: end, source: start || end ? "canvas" : "inferred" };
  }
  const min = Math.min(...dues);
  const max = Math.max(...dues);
  return {
    start_at: start || new Date(min - 7 * DAY_MS).toISOString(),
    end_at: end || new Date(max + 7 * DAY_MS).toISOString(),
    source: start && end ? "canvas" : "inferred",
  };
}

export function countKinds(items = []) {
  const counts = { assignments: 0, quizzes: 0, exams: 0, discussions: 0, other: 0 };
  for (const it of items) {
    if (it.kind === "quiz") counts.quizzes += 1;
    else if (it.kind === "exam") counts.exams += 1;
    else if (it.kind === "discussion") counts.discussions += 1;
    else if (it.kind === "assignment") counts.assignments += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * Exam candidates inferred from titles/types. Labeled `inferred`: a Canvas
 * assignment named "Exam 1" is evidence of a date, not confirmation of scope.
 */
export function examCandidates(courseId, assignments = [], quizzes = []) {
  const rows = [];
  for (const a of assignments) {
    const title = String(a?.name || "");
    if (!EXAM_OR_QUIZ_TITLE_RE.test(title) && !a?.is_quiz_assignment) continue;
    rows.push({
      id: `canvas-exam-${courseId}-a${a.id}`,
      label: title,
      due_at: a.due_at || null,
      kind: a.is_quiz_assignment || QUIZ_TITLE_RE.test(title) ? "quiz" : "assignment",
      points: a.points_possible ?? null,
      inferred: true,
      starts_at: a.starts_at || a.start_at || null,
      ends_at: a.ends_at || a.due_at || null,
      source: a.starts_at || a.start_at ? "canvas_window" : "canvas_due_at",
      confidence: a.starts_at || a.start_at ? "medium" : "low",
    });
  }
  for (const q of quizzes) {
    const title = String(q?.title || "");
    const type = String(q?.quiz_type || "");
    if (!EXAM_OR_QUIZ_TITLE_RE.test(title) && type !== "assignment") continue;
    if (rows.some((r) => r.label === title && r.due_at === (q.due_at || null))) continue;
    rows.push({
      id: `canvas-exam-${courseId}-q${q.id}`,
      label: title,
      due_at: q.due_at || null,
      kind: "quiz",
      points: q.points_possible ?? null,
      inferred: true,
      starts_at: q.starts_at || q.start_at || null,
      ends_at: q.ends_at || q.due_at || null,
      source: q.starts_at || q.start_at ? "canvas_window" : "canvas_due_at",
      confidence: q.starts_at || q.start_at ? "medium" : "low",
    });
  }
  return rows;
}

function groupIndex(groups = []) {
  const byId = {};
  for (const g of groups) {
    if (g?.id == null) continue;
    byId[String(g.id)] = {
      id: String(g.id),
      name: g.name || "",
      group_weight: numOrNull(g.group_weight),
    };
  }
  return byId;
}

export function courseRecord({
  course,
  syllabus,
  pages,
  assignments,
  quizzes,
  assignmentGroups,
  moduleSources = [],
  fetchedAt,
  errors = [],
  truncated = false,
}) {
  const sources = [];
  const syl = syllabusSource({ ...course, syllabus_body: syllabus ?? course.syllabus_body });
  if (syl) sources.push(syl);
  for (const p of pages || []) {
    const s = pageSource(course.id, p);
    if (s) sources.push(s);
  }
  for (const a of assignments || []) {
    const s = assignmentSource(course.id, a);
    if (s) sources.push(s);
  }
  for (const m of moduleSources || []) {
    const s = moduleSource(course.id, m);
    if (s) sources.push(s);
  }
  const packetSources = sources.flatMap(chunks);
  const generated = generatePracticeItems(packetSources);
  const byId = groupIndex(assignmentGroups);
  const useGroupWeights = (assignmentGroups || []).some((g) => Number(g?.group_weight) > 0);
  const rawItems = [
    ...(assignments || []).map((a) => itemFromAssignment(course.id, a, byId)),
    ...(quizzes || [])
      .filter((q) => !(assignments || []).some((a) => String(a.quiz_id) === String(q.id) || a.name === q.title))
      .map((q) => itemFromQuiz(course.id, q)),
  ];
  const items = applyWeightShares(rawItems, { useGroupWeights });
  const term = inferTerm(course, items);
  return {
    schema: SCHEMA_VERSION,
    course: {
      id: String(course.id),
      name: String(course.name || ""),
      code: String(course.course_code || ""),
      label: courseLabel(course),
      color: courseColor(course.id),
    },
    term,
    fetched_at: fetchedAt,
    sources: packetSources,
    items,
    generated_items: generated,
    exams: examCandidates(course.id, assignments, quizzes),
    truncated,
    errors,
  };
}

function splitProblems(text) {
  const lines = String(text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const starts = lines.map((line, index) => /^(?:problem|question|#?\d+\s*[.)]|[Pp]\d+\b)/.test(line) ? index : -1).filter((x) => x >= 0);
  if (!starts.length) return lines.length ? [lines.join(" ")] : [];
  return starts.map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length).join(" ").slice(0, 4000));
}

export function generatePracticeItems(sources = []) {
  const review = sources.find((s) => /review|study guide|practice problem/i.test(`${s.title} ${s.kind || ""}`) && !/answer|key|solution/i.test(s.title));
  const answer = sources.find((s) => /answer|key|solution/i.test(s.title));
  if (!review || !answer) return [];
  const questions = splitProblems(review.text);
  const answers = splitProblems(answer.text);
  const answerSource = answer.id;
  return questions.slice(0, 40).map((stem, index) => ({
    id: `generated-${review.id}-${index + 1}`.replace(/[^A-Za-z0-9._:-]/g, "-"),
    objective_id: "objective-exam-review",
    source_refs: [review.id, answerSource],
    kind: "concept",
    stem,
    neutral_locator: review.title,
    fields: [{ id: "answer", label: "Your answer", kind: "text", options: [], checker: { type: "none" } }],
    key: { answer: answers[index] || "See the corresponding instructor answer.", explanation: "Compare your work with the paired instructor answer after submitting.", support_refs: [answerSource], provenance: "instructor" },
    feedback: {},
    hint: "Try the problem before opening the instructor answer.",
    modes: ["review", "practice"],
    predicted_seconds: 180,
    why: "Generated locally from paired instructor review and answer materials.",
  }));
}
