/**
 * Placeholder course/kind classification for photo intake.
 * Pure functions — safe to import from tests and Mac scripts.
 *
 * Course codes/patterns come from schools/{slug}.yaml `course_file_map`
 * (empty by default until the school or student calibrates enrollments).
 */
import crypto from "node:crypto";
import { getSchoolConfig } from "./school-config.mjs";

/** Course codes come from school yaml; escape them so one can never act as a pattern. */
function escapeCode(code) {
  return String(code).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @typedef {'high'|'med'|'low'} Confidence */
/** @typedef {'whiteboard'|'slide'|'handout'|'syllabus_delta'|'homework_problem'|'event_selfie'|'graded_work'|'quiz'|'unknown'} CaptureKind */
/** @typedef {'update_course_md'|'canvas_upload'|'needs_review'} CaptureAction */

function schoolTimezone() {
  return getSchoolConfig().timezone || "UTC";
}

function courseFileMap() {
  return getSchoolConfig().course_file_map || [];
}

/** Codes from school yaml (may be empty). */
export function getCourseCodes() {
  return courseFileMap().map((e) => e.code);
}

/**
 * Primary OCR match: first yaml pattern, or a word-boundary on the code.
 * @returns {{ code: string, re: RegExp }[]}
 */
function ocrCodePatterns() {
  return courseFileMap().map((entry) => {
    if (entry.patterns?.length) {
      return { code: entry.code, re: entry.patterns[0] };
    }
    return { code: entry.code, re: new RegExp(`\\b${escapeCode(entry.code)}\\b`, "i") };
  });
}

/**
 * User-text aliases: each yaml pattern as a RegExp (already compiled by school-config).
 * @returns {{ code: string, patterns: RegExp[] }[]}
 */
function userAliases() {
  return courseFileMap().map((entry) => ({
    code: entry.code,
    patterns: entry.patterns?.length
      ? entry.patterns
      : [new RegExp(`\\b${escapeCode(entry.code)}\\b`, "i")],
  }));
}

const SELFIE_RE =
  /\bselfie\b|major dinner|ai lab workshop|post-?event|after (the )?dinner|attended/i;
const QUIZ_RE = /\bquiz\b|exam|midterm|final/i;
const WHITEBOARD_RE = /whiteboard|chalk|marker|board notes/i;
const SLIDE_RE = /\bslide\b|powerpoint|presentation deck/i;
const HANDOUT_RE = /handout|worksheet|printout/i;
const SYLLABUS_RE = /syllabus|grading policy|office hours/i;
const HOMEWORK_RE = /homework|problem set|written hw|assignment #/i;

/**
 * @param {Date} [d]
 * @returns {string} YYYYMMDD-HHMMSS-hex4 in school timezone
 */
export function makeCaptureId(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: schoolTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");
  const hex = crypto.randomBytes(2).toString("hex");
  return `${y}${mo}${da}-${h}${mi}${s}-${hex}`;
}

/**
 * @param {Date} [d]
 * @returns {string} YYYY-MM-DDTHH:MM MT
 */
export function formatCapturedAt(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: schoolTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")} MT`;
}

/**
 * @param {string} userText
 * @returns {string|null}
 */
export function parseUserCourseOverride(userText) {
  const t = String(userText || "");
  if (!t.trim()) return null;
  for (const { code, re } of ocrCodePatterns()) {
    if (re.test(t)) return code;
  }
  for (const { code, patterns } of userAliases()) {
    if (patterns.some((p) => p.test(t))) return code;
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ code: string, confidence: Confidence }|null}
 */
export function classifyCourseFromOcr(text) {
  const t = String(text || "");
  for (const { code, re } of ocrCodePatterns()) {
    if (re.test(t)) return { code, confidence: "high" };
  }
  // Secondary: any remaining yaml patterns at med confidence
  for (const entry of courseFileMap()) {
    const rest = (entry.patterns || []).slice(1);
    if (rest.some((p) => p.test(t))) return { code: entry.code, confidence: "med" };
  }
  return null;
}

/**
 * @param {string} text
 * @returns {CaptureKind}
 */
export function detectCaptureKind(text) {
  const t = String(text || "").toLowerCase();
  if (SELFIE_RE.test(t)) return "event_selfie";
  if (QUIZ_RE.test(t) && !/reading quiz description/i.test(t)) return "quiz";
  if (SYLLABUS_RE.test(t)) return "syllabus_delta";
  if (WHITEBOARD_RE.test(t)) return "whiteboard";
  if (SLIDE_RE.test(t)) return "slide";
  if (HANDOUT_RE.test(t)) return "handout";
  if (HOMEWORK_RE.test(t) || /problem\s*\d+/i.test(t)) return "homework_problem";
  if (/graded|exam paper|test booklet/i.test(t)) return "graded_work";
  return "unknown";
}

/**
 * @param {CaptureKind} kind
 * @returns {CaptureAction}
 */
export function actionForKind(kind) {
  switch (kind) {
    case "event_selfie":
      return "canvas_upload";
    case "quiz":
    case "graded_work":
    case "unknown":
      return "needs_review";
    default:
      return "update_course_md";
  }
}

/**
 * @param {CaptureAction} action
 * @returns {string}
 */
export function defaultStatusForAction(action) {
  if (action === "canvas_upload") return "pending_mac";
  if (action === "needs_review") return "needs_review";
  return "done";
}

/**
 * @param {{ userText?: string, ocrText?: string, visionSummary?: string, allowHighConfidence?: boolean }} input
 * @returns {{
 *   courseGuess: string,
 *   confidence: Confidence,
 *   kind: CaptureKind,
 *   action: CaptureAction,
 *   status: string,
 *   assignmentMatch: string,
 * }}
 */
export function classifyCapture(input = {}) {
  const userText = input.userText || "";
  const combined = [userText, input.ocrText, input.visionSummary].filter(Boolean).join("\n");
  const allowHigh = input.allowHighConfidence !== false;

  const override = parseUserCourseOverride(userText);
  let courseGuess = "UNKNOWN";
  /** @type {Confidence} */
  let confidence = "low";

  if (override) {
    courseGuess = override;
    confidence = "high";
  } else {
    const ocrHit = classifyCourseFromOcr(combined);
    if (ocrHit) {
      courseGuess = ocrHit.code;
      confidence = allowHigh && ocrHit.confidence === "high" ? "high" : "med";
    }
  }

  const kind = detectCaptureKind(combined);
  const action = actionForKind(kind);
  let status = defaultStatusForAction(action);

  if (courseGuess === "UNKNOWN" && action !== "needs_review") {
    status = "needs_review";
  }

  let assignmentMatch = "-";
  if (kind === "event_selfie") {
    assignmentMatch = "post-event upload";
  }

  return {
    courseGuess,
    confidence,
    kind,
    action,
    status,
    assignmentMatch,
  };
}

/**
 * Escape pipe for markdown table cells.
 * @param {string} s
 */
export function escapeTableCell(s) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Build one queue.md table row.
 * @param {object} row
 */
export function formatQueueRow(row) {
  const cols = [
    row.id,
    row.capturedAt,
    row.courseGuess,
    row.confidence,
    row.kind,
    row.assignmentMatch || "-",
    row.action,
    row.status,
    row.localPath,
    escapeTableCell(row.notes),
  ];
  return `| ${cols.join(" | ")} |`;
}

/**
 * Append a dated bullet for course MD ## Lecture captures.
 * @param {{ date?: string, summary: string, captureId: string, assignmentMatch?: string }} opts
 */
export function formatLectureCaptureBullet(opts) {
  const date = opts.date || new Intl.DateTimeFormat("en-CA", {
    timeZone: schoolTimezone(),
  }).format(new Date());
  const suffix = opts.assignmentMatch && opts.assignmentMatch !== "-"
    ? ` (${opts.assignmentMatch})`
    : "";
  return `- **${date}** — ${opts.summary}${suffix} (capture id: ${opts.captureId})`;
}
