/**
 * Island order. Only explainable local signals: overdue / due proximity,
 * assessment kind, grade weight, a material Canvas change, and the student's
 * accepted Week plan. Each island carries one plain-language reason; there is
 * no hidden score, no inferred difficulty, and no email content in here.
 *
 * Same base rule as freshness-dashboard rankPool and app/src/ask/rank.ts:
 * meaningful points first, then soonest due, then higher points.
 */
import { DEFAULT_ISLANDS, MAX_ISLANDS } from "./schema.mjs";

const DAY = 86_400_000;
const MEANINGFUL_POINTS = 10;
const CHANGE_KINDS = new Set(["due_changed", "instructions_edited", "points_changed", "assignment_added"]);

function t(v) {
  const n = Date.parse(v || "");
  return Number.isFinite(n) ? n : null;
}

/** Local calendar day "YYYY-MM-DD" in the given IANA zone (never UTC by accident). */
export function localDay(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Monday of the week containing `day` — the key week_plan.py uses. */
export function weekKey(day) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

/** Same precedence as app/src/week/plan.ts plannedDay: a newer deferral beats an accepted day. */
export function plannedDay(itemId, plan, week) {
  const accepted = plan?.weeks?.[week]?.accepted;
  const deferral = plan?.deferrals?.[itemId];
  const acceptedDay = accepted?.days?.[itemId];
  if (deferral && (!acceptedDay || String(deferral.at) > String(accepted?.at ?? ""))) return { day: deferral.to, why: "deferred" };
  if (acceptedDay) return { day: acceptedDay, why: "accepted" };
  return null;
}

/** Freshness events that touch this item in the last three days. */
export function recentChanges(events, item, now) {
  const title = String(item.title || "").toLowerCase();
  return (events || []).filter((e) => {
    if (!CHANGE_KINDS.has(e.kind)) return false;
    if (String(e.course_id) !== String(item.course_id)) return false;
    const at = t(e.detected_at || e.at);
    if (at == null || at < now - 3 * DAY) return false;
    const key = String(e.key || "");
    return key.endsWith(`:${item.canvas_id}`) || key.includes(`:${item.canvas_id}:`) || String(e.title || "").toLowerCase() === title;
  });
}

/** Fraction of the final grade (0–1). skip-cost share_of_final is a percent; study-sources weight_share a fraction. */
export function shareOf(c) {
  const pct = Number(c.skipCost?.share_of_final);
  if (c.skipCost?.share_of_final != null && Number.isFinite(pct)) return pct / 100;
  const share = Number(c.item.weight_share);
  return Number.isFinite(share) && share > 0 ? share : null;
}

/** "today" / "tomorrow" / "in N days" by the student's local calendar, not by rounding hours. */
function dayPhrase(ms, now, timeZone) {
  const [a, b] = [localDay(ms, timeZone), localDay(now, timeZone)].map((d) => Date.parse(`${d}T00:00:00Z`));
  const days = Math.round((a - b) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * @param {Array<{item: object, kind: string, skipCost?: object, changes: object[], planned: {day: string, why: string}|null}>} candidates
 * @param {{now: number, today: string, planAccepted: boolean}} ctx
 */
export function rankIslands(candidates, { now, today, planAccepted, timeZone = "UTC" }) {
  const scored = candidates.map((c) => {
    const due = t(c.item.due_at);
    const points = Number(c.item.points_possible) || 0;
    const share = shareOf(c);
    const assessment = c.kind === "exam" || (c.kind === "quiz" && (share ?? 0) >= 0.1);
    let tier;
    let reason;
    let state = "normal";
    let focus = false;
    if (assessment && due != null && due >= now && due <= now + 3 * DAY) {
      tier = 0;
      reason = `${c.kind === "exam" ? "Exam" : "Quiz"} ${dayPhrase(due, now, timeZone)}`;
      focus = true;
    } else if (due != null && due < now) {
      tier = 1;
      reason = "Past due and not submitted";
      state = "needs_attention";
    } else if (due != null && due <= now + 2 * DAY) {
      tier = 2;
      reason = `Due ${dayPhrase(due, now, timeZone)}`;
    } else if ((c.kind === "exam" || c.kind === "quiz") && due != null && due <= now + 7 * DAY) {
      tier = 3;
      reason = `${c.kind === "exam" ? "Exam" : "Quiz"} ${dayPhrase(due, now, timeZone)}`;
    } else {
      tier = 4;
      reason = due != null ? `Due ${dayPhrase(due, now, timeZone)}` : "You planned this";
    }
    const moved = c.changes.find((e) => e.kind === "due_changed");
    const edited = c.changes.find((e) => e.kind === "instructions_edited");
    if (moved || edited) {
      state = "changed";
      reason = moved ? "Due date moved" : "Instructions changed in Canvas";
      if (tier > 3) tier = 3;
    }
    if (share != null && share >= 0.05 && tier >= 2 && state === "normal") reason += `, about ${Math.round(share * 100)}% of the grade`;
    return { ...c, due, points, tier, reason, state, focus };
  });

  const byRule = (a, b) =>
    a.tier - b.tier ||
    Number(b.points >= MEANINGFUL_POINTS) - Number(a.points >= MEANINGFUL_POINTS) ||
    (a.due ?? Infinity) - (b.due ?? Infinity) ||
    b.points - a.points ||
    String(a.item.id).localeCompare(String(b.item.id));

  let ordered;
  if (planAccepted) {
    // The accepted plan is the student's order. Work it doesn't know about
    // follows, labeled "Changed" — it never reshuffles what they accepted.
    const inPlan = scored.filter((s) => s.planned);
    const outside = scored.filter((s) => !s.planned);
    inPlan.sort((a, b) => a.planned.day.localeCompare(b.planned.day) || (a.due ?? Infinity) - (b.due ?? Infinity));
    for (const s of inPlan) {
      if (s.state === "normal") s.reason = s.planned.day === today ? "You planned this for today" : s.planned.day < today ? "Planned earlier, still open" : `Planned for ${s.planned.day}`;
    }
    for (const s of outside) {
      if (s.state === "normal" || s.state === "needs_attention") {
        s.state = s.state === "needs_attention" ? s.state : "changed";
        s.reason = s.state === "needs_attention" ? s.reason : "New since you planned your week";
      }
    }
    outside.sort(byRule);
    ordered = [...inPlan.filter((s) => s.planned.day <= today), ...outside.filter((s) => s.tier <= 2), ...inPlan.filter((s) => s.planned.day > today), ...outside.filter((s) => s.tier > 2)];
  } else {
    ordered = scored.slice().sort(byRule);
  }

  // Four by default; up to six when today genuinely holds more urgent work.
  const urgent = ordered.filter((s) => s.tier <= 2).length;
  const count = Math.min(MAX_ISLANDS, Math.max(DEFAULT_ISLANDS, urgent));
  const shown = ordered.slice(0, count);
  const focusIdx = shown.findIndex((s) => s.focus);
  if (!planAccepted && focusIdx > 0) shown.unshift(shown.splice(focusIdx, 1)[0]);
  shown.forEach((s, i) => {
    s.rank = i + 1;
    s.focus = i === 0 && s.focus;
  });
  return { shown, rest: ordered.length - shown.length };
}
