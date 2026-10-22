import { describe, expect, it } from "vitest";
import { predicateHolds } from "./predicates";

const noon = new Date(2026, 9, 21, 12, 0, 0);
const sunday = new Date(2026, 9, 18, 12, 0, 0);

describe("workspace predicates", () => {
  it("shows a block for an unknown predicate and for data the caller does not have", () => {
    expect(predicateHolds("not_a_predicate", {})).toBe(true);
    expect(predicateHolds("has_changes", {})).toBe(true);
    expect(predicateHolds("due_within_48h", {})).toBe(true);
    expect(predicateHolds("has_exam_within_7d", {})).toBe(true);
    expect(predicateHolds("has_unread_announcements", {})).toBe(true);
    expect(predicateHolds("missing_course_sources", {})).toBe(true);
  });

  it("resolves the known predicates from the snapshot only", () => {
    expect(predicateHolds("always", { now: noon })).toBe(true);
    expect(predicateHolds("weekday", { now: noon })).toBe(true);
    expect(predicateHolds("weekend", { now: noon })).toBe(false);
    expect(predicateHolds("weekend", { now: sunday })).toBe(true);
    expect(predicateHolds("weekday", { now: sunday })).toBe(false);

    expect(predicateHolds("has_changes", { changes: [] })).toBe(false);
    expect(predicateHolds("has_changes", { changes: [{ kind: "due" }] })).toBe(true);

    const soon = new Date(noon.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(noon.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(predicateHolds("due_within_48h", { now: noon, ticks: [{ due_at: soon, kind: "assignment" }] })).toBe(true);
    expect(predicateHolds("due_within_48h", { now: noon, ticks: [{ due_at: soon, kind: "assignment", completed: true }] })).toBe(false);
    expect(predicateHolds("due_within_48h", { now: noon, ticks: [{ due_at: later, kind: "assignment" }] })).toBe(false);
    expect(predicateHolds("has_exam_within_7d", { now: noon, ticks: [{ due_at: soon, kind: "exam" }] })).toBe(true);
    expect(predicateHolds("has_exam_within_7d", { now: noon, ticks: [{ due_at: soon, kind: "assignment" }] })).toBe(false);

    const seen = noon.getTime();
    expect(predicateHolds("has_unread_announcements", { changes: [{ kind: "announcement", detected_at: new Date(seen + 1000).toISOString() }], seenAt: seen })).toBe(true);
    expect(predicateHolds("has_unread_announcements", { changes: [{ kind: "announcement", detected_at: new Date(seen - 1000).toISOString() }], seenAt: seen })).toBe(false);
    expect(predicateHolds("has_unread_announcements", { changes: [] })).toBe(false);

    expect(predicateHolds("missing_course_sources", { coursesMissingSources: true })).toBe(true);
    expect(predicateHolds("missing_course_sources", { coursesMissingSources: false })).toBe(false);
  });
});
