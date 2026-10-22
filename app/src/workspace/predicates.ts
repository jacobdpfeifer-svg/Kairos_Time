/**
 * Resolve `visible_when` from a snapshot the caller already has.
 * This module does not fetch. A missing field, like an unknown predicate, shows the block.
 */

export type PredicateTick = { due_at?: string | null; kind?: string | null; completed?: boolean };
export type PredicateChange = { kind?: string; detected_at?: string | null; at?: string | null };

export type PredicateSnapshot = {
  now?: Date;
  changes?: PredicateChange[] | null;
  /** Milliseconds. Present only when the caller already recorded what the student has seen. */
  seenAt?: number | null;
  ticks?: PredicateTick[] | null;
  /** Present only when the caller already knows a course is missing files. */
  coursesMissingSources?: boolean | null;
};

const KNOWN = new Set([
  "always",
  "has_changes",
  "due_within_48h",
  "has_exam_within_7d",
  "has_unread_announcements",
  "missing_course_sources",
  "weekend",
  "weekday",
]);

function dueMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function dueWithin(tick: PredicateTick, now: number, windowMs: number): boolean {
  if (tick.completed) return false;
  const due = dueMs(tick.due_at);
  if (due === null) return false;
  return due >= now && due <= now + windowMs;
}

export function predicateHolds(name: string | undefined, snap: PredicateSnapshot = {}): boolean {
  const predicate = name || "always";
  if (!KNOWN.has(predicate)) return true;
  const now = snap.now ?? new Date();
  const nowMs = now.getTime();
  switch (predicate) {
    case "always":
      return true;
    case "weekend":
      return now.getDay() === 0 || now.getDay() === 6;
    case "weekday":
      return now.getDay() !== 0 && now.getDay() !== 6;
    case "has_changes":
      if (snap.changes == null) return true;
      return snap.changes.length > 0;
    case "due_within_48h":
      if (snap.ticks == null) return true;
      return snap.ticks.some((tick) => dueWithin(tick, nowMs, 48 * 60 * 60 * 1000));
    case "has_exam_within_7d":
      if (snap.ticks == null) return true;
      return snap.ticks.some((tick) => (tick.kind === "exam" || tick.kind === "quiz") && dueWithin(tick, nowMs, 7 * 24 * 60 * 60 * 1000));
    case "has_unread_announcements":
      if (snap.changes == null) return true;
      return snap.changes.some((change) => {
        if (change.kind !== "announcement") return false;
        if (snap.seenAt == null) return true;
        const at = dueMs(change.detected_at || change.at);
        return at === null || at > snap.seenAt;
      });
    case "missing_course_sources":
      if (snap.coursesMissingSources == null) return true;
      return snap.coursesMissingSources;
    default:
      return true;
  }
}
