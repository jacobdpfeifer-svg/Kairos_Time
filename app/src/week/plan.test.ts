// Purpose: tests week plan math
import { describe, expect, it } from "vitest";
import type { SemesterTick } from "../ipc";
import { EMPTY_STATE, buildWeek, capacitySentence, couldWait, estimateMinutes, mondayOf, pileFor, proposePlan, type WeekSnapshot } from "./plan";

// Wednesday, Oct 14 2026 at 9:00 local.
const NOW = new Date(2026, 9, 14, 9, 0, 0);
const at = (day: number, hour = 23, minute = 59) => new Date(2026, 9, day, hour, minute).toISOString();

const tick = (id: string, title: string, kind: string, day: number, points: number, weight = 0.05): SemesterTick => ({
  id,
  course_id: "1300",
  course_label: "MATH 1300",
  color: "#2E86AB",
  title,
  kind,
  due_at: at(day),
  points_possible: points,
  weight_share: weight,
  html_url: null,
  completed: false,
  description: "",
});

const snap = (over: Partial<WeekSnapshot["state"]> = {}, items: WeekSnapshot["items"] = []): WeekSnapshot => ({
  state: { ...structuredClone(EMPTY_STATE), ...over },
  items,
  piles: { courses: {} },
});

describe("week plan", () => {
  it("starts the week on Monday in local time", () => {
    expect(mondayOf(NOW)).toBe("2026-10-12");
  });

  it("guesses longer for exams and big written work", () => {
    expect(estimateMinutes({ kind: "exam", title: "Midterm", points_possible: 100 })).toBe(240);
    expect(estimateMinutes({ kind: "assignment", title: "Reading notes", points_possible: 5 })).toBe(30);
    expect(estimateMinutes({ kind: "assignment", title: "Position essay draft", points_possible: 100 })).toBe(240);
  });

  it("plans long work the day before it's due and sums it against the hours", () => {
    const ticks = [tick("a", "Problem set", "assignment", 16, 20), tick("b", "Reading notes", "assignment", 15, 5)];
    const m = buildWeek(ticks, snap({ default_hours: 7 }), NOW);
    const where = Object.fromEntries(m.days.flatMap((d) => d.rows.map((r) => [r.id, d.day])));
    expect(where).toEqual({ a: "2026-10-15", b: "2026-10-15" });
    expect(m.workMinutes).toBe(120);
    // 7 hours a week, 5 days left (Wed to Sun) → 300 minutes
    expect(m.freeMinutes).toBe(300);
    expect(capacitySentence(m)).toBe("About 2 hours of work left this week and about 5 hours free. It fits.");
  });

  it("says when the week is too full and offers the cheapest things to wait, never an exam", () => {
    const ticks = [
      tick("ex", "Midterm", "exam", 17, 100, 0.3),
      tick("p", "Project", "assignment", 18, 50, 0.2),
      tick("r", "Reading notes", "assignment", 16, 5, 0.01),
    ];
    const m = buildWeek(ticks, snap({ default_hours: 3 }), NOW);
    expect(capacitySentence(m)).toMatch(/more than fits\.$/);
    const wait = couldWait(m);
    expect(wait.map((r) => r.id)[0]).toBe("r");
    expect(wait.some((r) => r.id === "ex")).toBe(false);
  });

  it("a deferral wins over the default day, and a later accept wins over an older deferral", () => {
    const ticks = [tick("a", "Problem set", "assignment", 18, 20)];
    let m = buildWeek(ticks, snap({ deferrals: { a: { to: "2026-10-16", at: "2026-10-14T10:00:00Z" } } }), NOW);
    expect(m.days.find((d) => d.rows.some((r) => r.id === "a"))?.day).toBe("2026-10-16");
    m = buildWeek(
      ticks,
      snap({
        deferrals: { a: { to: "2026-10-16", at: "2026-10-14T10:00:00Z" } },
        weeks: { "2026-10-12": { accepted: { at: "2026-10-14T11:00:00Z", days: { a: "2026-10-15" } } } },
      }),
      NOW
    );
    expect(m.days.find((d) => d.rows.some((r) => r.id === "a"))?.day).toBe("2026-10-15");
  });

  it("keeps an accepted plan put, and lists new arrivals instead of slotting them in", () => {
    const accepted = { "2026-10-12": { accepted: { at: "2026-10-13T11:00:00Z", days: { a: "2026-10-14" } } } };
    const m = buildWeek([tick("a", "Problem set", "assignment", 18, 20), tick("n", "New lab", "assignment", 17, 10)], snap({ weeks: accepted }), NOW);
    expect(m.days.find((d) => d.day === "2026-10-14")?.rows.map((r) => r.id)).toEqual(["a"]);
    expect(m.newSincePlan.map((r) => r.id)).toEqual(["n"]);
  });

  it("puts overdue work in leftovers and proposes only days before the due date", () => {
    const ticks = [tick("late", "Old quiz corrections", "assignment", 12, 10), tick("a", "Problem set", "assignment", 16, 20)];
    const m = buildWeek(ticks, snap({ default_hours: 10 }), NOW);
    expect(m.leftovers.map((r) => r.id)).toEqual(["late"]);
    const proposal = proposePlan(m, m.leftovers);
    expect(proposal.a <= "2026-10-15").toBe(true);
    expect(proposal.late).toBe("2026-10-14");
  });

  it("includes the student's own rows and drops done ones", () => {
    const m = buildWeek(
      [],
      snap({}, [
        { id: "cap-1", title: "Email TA", course: null, due_at: null, day: "2026-10-15", source: "typed", created_at: "x" },
        { id: "cap-2", title: "Done thing", course: null, due_at: null, day: "2026-10-15", source: "typed", created_at: "x", done_at: "y" },
      ]),
      NOW
    );
    expect(m.days.flatMap((d) => d.rows).map((r) => r.id)).toEqual(["cap-1"]);
  });

  it("sorts Canvas arrivals into piles the student can correct", () => {
    const change = (kind: string, key = kind, detail = {}) => ({ key, kind, label: kind, title: kind, course: "CSCI 1300", detail });
    const s = snap();
    expect(pileFor(change("due_changed"), s)).toBe("needs_you");
    expect(pileFor(change("announcement"), s)).toBe("fyi");
    expect(pileFor(change("announcement", "a2", { actions: ["Bring a laptop"] }), s)).toBe("needs_you");
    s.piles.courses["CSCI 1300"] = { announcement: "needs_you" };
    expect(pileFor(change("announcement"), s)).toBe("needs_you");
    s.state.pile_moves.announcement = "changed";
    expect(pileFor(change("announcement"), s)).toBe("changed");
  });
});
