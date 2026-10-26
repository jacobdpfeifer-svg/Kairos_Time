/*
 * Rare, relevant notifications (MASTER §06 notifications, Flighty's rule).
 * Three triggers only: a due date moved, high-stakes work within 48 hours that
 * isn't done, and a broken Canvas sign-in. Quiet at night and during class,
 * at most three a day, each sent once. Never "you haven't opened Kairos".
 */
import type { FreshnessChange, SemesterTick, SyncHealth } from "../ipc";
import { friendlyWhen, friendlyRelative } from "../format";

export type Note = { key: string; title: string; body: string };

export type NotifyState = { sent: Record<string, string>; day: string; count: number };

export const EMPTY_NOTIFY_STATE: NotifyState = { sent: {}, day: "", count: 0 };

export const DAILY_CAP = 3;
const HOUR = 3_600_000;
const QUIET_FROM = 23;
const QUIET_UNTIL = 8;

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Night hours, or inside a class block from Canvas's own calendar. */
export function isQuiet(now: Date, classes: { start: string; end: string }[] = []): boolean {
  const h = now.getHours();
  if (h >= QUIET_FROM || h < QUIET_UNTIL) return true;
  const t = now.getTime();
  return classes.some((c) => Date.parse(c.start) <= t && t < Date.parse(c.end));
}

/** Exams, and anything worth at least a tenth of the course or 50 points. */
export function isHighStakes(t: SemesterTick): boolean {
  return t.kind === "exam" || (t.weight_share || 0) >= 0.1 || (Number(t.points_possible) || 0) >= 50;
}

export function candidates({
  changes,
  ticks,
  health,
  now,
}: {
  changes: FreshnessChange[];
  ticks: SemesterTick[];
  health: SyncHealth | null;
  now: Date;
}): Note[] {
  const out: Note[] = [];
  if (health?.state === "blocked") {
    out.push({
      key: `sync-blocked:${localDay(now)}`,
      title: "Kairos can't read Canvas",
      body: "Your Canvas sign-in needs renewing. Open Kairos to sign in again.",
    });
  }
  for (const c of changes) {
    if (c.kind !== "due_changed") continue;
    const seen = Date.parse(c.detected_at || c.at || "");
    if (!Number.isFinite(seen) || now.getTime() - seen > 48 * HOUR) continue;
    const to = (c.detail as { to?: string } | undefined)?.to;
    out.push({
      key: `moved:${c.key}`,
      title: `${c.title} moved`,
      body: to ? `Now ${friendlyWhen(to)}. Open your plan in Kairos.` : "The due date changed in Canvas. Open your plan in Kairos.",
    });
  }
  for (const t of ticks) {
    if (t.completed || !t.due_at || !isHighStakes(t)) continue;
    const due = Date.parse(t.due_at);
    if (!(due > now.getTime() && due - now.getTime() <= 48 * HOUR)) continue;
    const exam = t.kind === "exam" || t.kind === "quiz";
    out.push({
      key: `soon:${t.course_id}:${t.id}`,
      title: `${t.title} is ${friendlyRelative(t.due_at, now)}`,
      body: exam
        ? `${t.course_label}, ${friendlyWhen(t.due_at)}. Your study plan is in Kairos.`
        : `${t.course_label}, due ${friendlyWhen(t.due_at)}, and not turned in yet.`,
    });
  }
  return out;
}

/** Drop notes the accepted workspace has narrowed away. Missing list keeps all three kinds. */
export function maskNotes(notes: Note[], interruptFor?: readonly string[]): Note[] {
  if (!interruptFor) return notes;
  const allowed = new Set(interruptFor);
  return notes.filter((note) => {
    const kind = note.key.startsWith("sync-blocked:") ? "sync_broken" : note.key.startsWith("moved:") ? "due_moved" : note.key.startsWith("soon:") ? "high_stakes_48h" : "";
    return kind !== "" && allowed.has(kind);
  });
}

/** What to send now, and the state to keep. Unsent notes wait for the next check. */
export function decide(
  notes: Note[],
  state: NotifyState,
  now: Date,
  classes: { start: string; end: string }[] = []
): { send: Note[]; state: NotifyState } {
  const day = localDay(now);
  const fresh: NotifyState = state.day === day ? { ...state, sent: { ...state.sent } } : { sent: { ...state.sent }, day, count: 0 };
  // Forget keys older than two weeks so the record stays small.
  for (const [k, at] of Object.entries(fresh.sent)) {
    if (now.getTime() - Date.parse(at) > 14 * 24 * HOUR) delete fresh.sent[k];
  }
  if (isQuiet(now, classes)) return { send: [], state: fresh };
  const send: Note[] = [];
  for (const n of notes) {
    if (fresh.count >= DAILY_CAP) break;
    if (fresh.sent[n.key]) continue;
    send.push(n);
    fresh.sent[n.key] = now.toISOString();
    fresh.count += 1;
  }
  return { send, state: fresh };
}
