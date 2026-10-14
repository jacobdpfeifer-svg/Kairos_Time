/** Small display helpers shared by the dashboard stage and the side panel. */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const diff = t - now;
  const abs = Math.abs(diff);
  const unit = abs < HOUR ? ["minute", MINUTE] : abs < DAY ? ["hour", HOUR] : ["day", DAY];
  const n = Math.max(1, Math.round(abs / unit[1]));
  if (abs < MINUTE) return "just now";
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.sign(diff) * n, unit[0]);
}

/** "Thu, Oct 9 at 11:59 PM MDT" (MASTER §02): the short zone, never the IANA name. */
export function formatDue(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day} at ${time}`;
}

function pct(v) {
  return v == null ? "None yet" : `${Number(v).toFixed(1)}%`;
}

/** "84.0% → 66.0%", full marks, share of the final grade — null when there is nothing honest to say. */
export function costLine(cost) {
  if (!cost || cost.status === "cannot_calculate" || cost.if_zero == null) return null;
  const skip = cost.current != null ? `${pct(cost.current)} → ${pct(cost.if_zero)}` : pct(cost.if_zero);
  return {
    skip,
    full: pct(cost.if_full),
    share: cost.share_of_final != null ? `${Number(cost.share_of_final).toFixed(1)}%` : null,
    estimate: cost.status !== "ok",
  };
}

/** A 90-minute block starting 26 hours before a due date (the student edits it in the app). */
export function blockBefore(dueIso, { minutes = 90, hoursBefore = 26 } = {}) {
  const due = Date.parse(dueIso || "");
  if (!Number.isFinite(due)) return null;
  const start = due - hoursBefore * HOUR;
  if (start < Date.now()) return null;
  return { start: new Date(start).toISOString(), end: new Date(start + minutes * MINUTE).toISOString() };
}

/**
 * The graded thing a Canvas page is about: an assignment, a quiz, or a
 * discussion, by course and id. Quizzes and discussions are resolved to their
 * assignment by the worker.
 */
export function workFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/^\/courses\/(\d+)\/(assignments|quizzes|discussion_topics)\/(\d+)(?:\/|$)/);
    if (!m) return null;
    const kind = m[2] === "assignments" ? "assignment" : m[2] === "quizzes" ? "quiz" : "discussion";
    return { courseId: m[1], kind, id: m[3] };
  } catch {
    return null;
  }
}

/** Kept for callers that only care about assignment pages. */
export function assignmentFromUrl(url) {
  const w = workFromUrl(url);
  return w && w.kind === "assignment" ? { courseId: w.courseId, assignmentId: w.id } : null;
}

/** The Kairos app route for a Canvas assignment (`kairos://` opens the Mac app). */
export function kairosItemLink(courseId, assignmentId) {
  if (!/^\d+$/.test(String(courseId)) || !/^\d+$/.test(String(assignmentId))) return "kairos://today";
  return `kairos://item/${courseId}/item-a${assignmentId}`;
}
