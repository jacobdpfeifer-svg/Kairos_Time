import type { FreshnessChange, SemesterTick } from "../ipc";

/*
 * The week as a page (MASTER §10 Week): work summed against the hours the
 * student has, each row on a planned day, deferrals the student chose, and a
 * proposed order that only takes effect when the student says yes. Pure
 * functions: the state lives in `{user_root}/inbox/plan/week.json`.
 */

export type Pile = "needs_you" | "changed" | "fyi";

export type WeekPlanState = {
  schema: number;
  default_hours: number | null;
  weeks: Record<string, { hours?: number; accepted?: { at: string; days: Record<string, string> } }>;
  estimates: Record<string, number>;
  deferrals: Record<string, { to: string; at: string }>;
  pile_moves: Record<string, Pile>;
};

export type Capture = {
  id: string;
  title: string;
  course: string | null;
  due_at: string | null;
  day: string | null;
  source: string;
  created_at: string;
  done_at?: string | null;
};

export type PilePrefs = { courses: Record<string, Record<string, Pile>> };

export type WeekSnapshot = { state: WeekPlanState; items: Capture[]; piles: PilePrefs };

export const EMPTY_STATE: WeekPlanState = { schema: 1, default_hours: null, weeks: {}, estimates: {}, deferrals: {}, pile_moves: {} };

export type PlanRow = {
  id: string;
  title: string;
  course: string | null;
  color: string | null;
  kind: string;
  due_at: string | null;
  minutes: number;
  /** Local day it is planned for (YYYY-MM-DD). */
  day: string;
  why: "accepted" | "deferred" | "default";
  captured: boolean;
  tick?: SemesterTick;
  points: number;
  weight: number;
  html_url: string | null;
  /** Set only on a row in `WeekModel.done`. */
  done_at?: string;
};

const DAY_MS = 86_400_000;

/** Local calendar day, never UTC: "2026-10-14". */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return dayKey(copy);
}

export function dayLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return fromKey(key).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min / 5) * 5} min`;
  const h = Math.round((min / 60) * 2) / 2;
  return h === 1 ? "1 hour" : `${h} hours`;
}

const BIG_WORK = /\b(essay|paper|draft|project|report|presentation|portfolio)\b/i;

/** First guess at how long something takes. The student corrects it; the guess is never shown as fact. */
export function estimateMinutes(item: { kind: string; title: string; points_possible?: number | null }): number {
  const pts = Number(item.points_possible) || 0;
  if (item.kind === "exam") return 240;
  if (item.kind === "quiz") return 60;
  if (item.kind === "discussion") return 30;
  let m = pts <= 5 ? 30 : pts <= 15 ? 60 : pts <= 40 ? 90 : 150;
  if (BIG_WORK.test(item.title)) m = Math.max(m, pts >= 50 ? 240 : 120);
  return m;
}

function defaultDay(due: string | null, minutes: number, kind: string, today: string): string {
  if (!due) return today;
  const dueDay = dayKey(new Date(due));
  // Prep for an exam, and anything an hour or longer, is planned the day before it is due.
  const before = kind === "exam" || kind === "quiz" || minutes >= 60 ? addDays(dueDay, -1) : dueDay;
  return before < today ? (dueDay < today ? today : dueDay) : before;
}

function plannedDay(id: string, fallback: string, state: WeekPlanState, week: string): { day: string; why: PlanRow["why"] } {
  const accepted = state.weeks[week]?.accepted;
  const deferral = state.deferrals[id];
  const acceptedDay = accepted?.days[id];
  if (deferral && (!acceptedDay || deferral.at > (accepted?.at ?? ""))) return { day: deferral.to, why: "deferred" };
  if (acceptedDay) return { day: acceptedDay, why: "accepted" };
  return { day: fallback, why: "default" };
}

export type WeekModel = {
  week: string;
  today: string;
  days: { day: string; label: string; rows: PlanRow[] }[];
  /** Overdue and not done, or planned before today: the Replan pile. */
  leftovers: PlanRow[];
  workMinutes: number;
  hours: number | null;
  freeMinutes: number | null;
  /** Rows added after the student accepted a plan; never slotted in silently. */
  newSincePlan: PlanRow[];
  /** Captures marked done this week. Off the day, still on the page, so Not done is not a toast. */
  done: PlanRow[];
  accepted: { at: string } | null;
};

/**
 * Done work stays on the week it was done, then leaves the page. Without this
 * the Done section would carry every capture a student ever finished. Only the
 * lower bound is checked: a stamp ahead of this week is a clock, not a reason
 * to hide a row, and an unreadable stamp keeps the row rather than taking away
 * the only Not done.
 */
function doneThisWeek(doneAt: string, week: string): boolean {
  const t = Date.parse(doneAt);
  if (!Number.isFinite(t)) return true;
  return dayKey(new Date(t)) >= week;
}

export function buildWeek(ticks: SemesterTick[], snap: WeekSnapshot, now: Date): WeekModel {
  const today = dayKey(now);
  const week = mondayOf(now);
  const end = addDays(week, 7);
  const { state } = snap;
  const rows: PlanRow[] = [];
  const done: PlanRow[] = [];

  for (const t of ticks) {
    if (t.completed || !t.due_at) continue;
    const minutes = state.estimates[t.id] ?? estimateMinutes(t);
    const fallback = defaultDay(t.due_at, minutes, t.kind, today);
    const { day, why } = plannedDay(t.id, fallback, state, week);
    rows.push({
      id: t.id,
      title: t.title,
      course: t.course_label,
      color: t.color,
      kind: t.kind,
      due_at: t.due_at,
      minutes,
      day,
      why,
      captured: false,
      tick: t,
      points: Number(t.points_possible) || 0,
      weight: t.weight_share || 0,
      html_url: t.html_url,
    });
  }
  for (const c of snap.items) {
    const minutes = state.estimates[c.id] ?? 30;
    const fallback = c.day ?? (c.due_at ? defaultDay(c.due_at, minutes, "assignment", today) : today);
    const { day, why } = plannedDay(c.id, fallback, state, week);
    const row: PlanRow = {
      id: c.id,
      title: c.title,
      course: c.course,
      color: null,
      kind: "todo",
      due_at: c.due_at,
      minutes,
      day,
      why,
      captured: true,
      points: 0,
      weight: 0,
      html_url: null,
    };
    if (c.done_at) {
      if (doneThisWeek(c.done_at, week)) done.push({ ...row, done_at: c.done_at });
    } else rows.push(row);
  }

  const leftovers = rows
    .filter((r) => r.day < today || (r.due_at && Date.parse(r.due_at) < now.getTime() && !r.captured))
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  const leftoverIds = new Set(leftovers.map((r) => r.id));
  const inWeek = rows.filter((r) => !leftoverIds.has(r.id) && r.day >= today && r.day < end);

  const days: WeekModel["days"] = [];
  for (let key = today; key < end; key = addDays(key, 1)) {
    const dayRows = inWeek
      .filter((r) => r.day === key)
      .sort((a, b) => String(a.due_at ?? "9").localeCompare(String(b.due_at ?? "9")));
    days.push({ day: key, label: dayLabel(key, today), rows: dayRows });
  }

  const hours = state.weeks[week]?.hours ?? state.default_hours ?? null;
  const daysLeft = Math.max(1, Math.round((fromKey(end).getTime() - fromKey(today).getTime()) / DAY_MS));
  const freeMinutes = hours == null ? null : Math.round((hours * 60 * daysLeft) / 7);
  const accepted = state.weeks[week]?.accepted ?? null;
  const newSincePlan = accepted ? inWeek.filter((r) => !(r.id in accepted.days) && r.why === "default") : [];

  return {
    week,
    today,
    days,
    leftovers,
    workMinutes: inWeek.reduce((s, r) => s + r.minutes, 0) + leftovers.reduce((s, r) => s + r.minutes, 0),
    hours,
    freeMinutes,
    newSincePlan,
    done: done.sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))),
    accepted: accepted ? { at: accepted.at } : null,
  };
}

/** The one capacity sentence at the top of Week. */
export function capacitySentence(m: WeekModel): string {
  if (m.workMinutes === 0) return "Nothing left on this week's page.";
  const work = `About ${formatMinutes(m.workMinutes)} of work left this week`;
  if (m.freeMinutes == null) return `${work}.`;
  const free = `about ${formatMinutes(m.freeMinutes)} free`;
  if (m.workMinutes <= m.freeMinutes) return `${work} and ${free}. It fits.`;
  return `${work} and ${free}. That's ${formatMinutes(m.workMinutes - m.freeMinutes)} more than fits.`;
}

/**
 * Rows that could wait, cheapest to move first: never an exam, lowest share of
 * the grade, then latest due. The student decides; nothing is moved for them.
 */
export function couldWait(m: WeekModel, limit = 3): PlanRow[] {
  if (m.freeMinutes == null || m.workMinutes <= m.freeMinutes) return [];
  let over = m.workMinutes - m.freeMinutes;
  const pool = m.days
    .flatMap((d) => d.rows)
    .filter((r) => r.kind !== "exam")
    .sort((a, b) => a.weight - b.weight || a.points - b.points || String(b.due_at).localeCompare(String(a.due_at)));
  const out: PlanRow[] = [];
  for (const r of pool) {
    if (over <= 0 || out.length >= limit) break;
    out.push(r);
    over -= r.minutes;
  }
  return out;
}

/**
 * A proposed day for every row: earliest-due first, filled into the days before
 * each due date up to an even share of the week's hours. A proposal only.
 */
export function proposePlan(m: WeekModel, include: PlanRow[] = []): Record<string, string> {
  const days = m.days.map((d) => d.day);
  const cap = m.freeMinutes != null ? Math.max(60, Math.round(m.freeMinutes / Math.max(1, days.length))) : 180;
  const load: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  const rows = [...include, ...m.days.flatMap((d) => d.rows)].sort(
    (a, b) => String(a.due_at ?? "9").localeCompare(String(b.due_at ?? "9")) || b.minutes - a.minutes
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    const dueDay = r.due_at ? dayKey(new Date(r.due_at)) : days[days.length - 1];
    const latest = r.kind === "exam" || r.kind === "quiz" || r.minutes >= 60 ? addDays(dueDay, -1) : dueDay;
    const window = days.filter((d) => d <= latest);
    const candidates = window.length ? window : [days[0]];
    const fit = candidates.find((d) => load[d] + r.minutes <= cap);
    const pick = fit ?? candidates.reduce((best, d) => (load[d] < load[best] ? d : best), candidates[0]);
    out[r.id] = pick;
    load[pick] += r.minutes;
  }
  return out;
}

const DEFAULT_PILE: Record<string, Pile> = {
  due_changed: "needs_you",
  assignment_added: "needs_you",
  comment: "needs_you",
  instructions_edited: "changed",
  points_changed: "changed",
  page_updated: "changed",
  announcement: "fyi",
  graded: "fyi",
};

/** Which pile a Canvas change lands in: the student's move, then their "always" for the course, then the default. */
export function pileFor(change: FreshnessChange, snap: WeekSnapshot): Pile {
  const moved = snap.state.pile_moves[change.key];
  if (moved) return moved;
  const always = change.course ? snap.piles.courses[change.course]?.[change.kind] : undefined;
  if (always) return always;
  const actions = (change.detail as { actions?: unknown[] } | undefined)?.actions;
  if (change.kind === "announcement" && Array.isArray(actions) && actions.length > 0) return "needs_you";
  return DEFAULT_PILE[change.kind] ?? "fyi";
}

export const PILE_LABEL: Record<Pile, string> = { needs_you: "Needs you", changed: "Changed", fyi: "For your info" };
