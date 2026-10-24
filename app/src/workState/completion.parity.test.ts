import { describe, expect, it } from "vitest";
import { SUBMITTED_STATES } from "../../../browser/scripts/lib/work-completion.mjs";
import { LEGACY_SUBMITTED, itemCompleted } from "./snapshot";

type Item = Parameters<typeof itemCompleted>[0];

const base: Item = {
  id: "canvas:cu:1300:assignment:101",
  course_id: "canvas:course:cu:1300",
  kind: "assignment",
  title: "HW",
  due_at: null,
  canvas: { url: null, submission_state: "unsubmitted" },
  change: null,
  student: { status: null, estimate_minutes: null, planned_day: null, order: null, plan_id: null },
};

describe("completion parity with the authored rule", () => {
  it("holds the app fallback list to browser/scripts/lib/work-completion.mjs", () => {
    expect([...LEGACY_SUBMITTED].sort()).toEqual([...SUBMITTED_STATES].sort());
  });

  it("prefers the projection's own answer over re-deriving from submission_state", () => {
    // An unposted teacher-entered grade: `unsubmitted` with completed true.
    const graded = { ...base, canvas: { url: null, submission_state: "unsubmitted", completed: true } };
    expect(itemCompleted(graded)).toBe(true);
    const notStarted = { ...base, canvas: { url: null, submission_state: "unsubmitted", completed: false } };
    expect(itemCompleted(notStarted)).toBe(false);
  });

  it("falls back for a generation promoted before the field existed", () => {
    expect(itemCompleted(base)).toBe(false);
    expect(itemCompleted({ ...base, canvas: { url: null, submission_state: "graded" } })).toBe(true);
  });

  it("uses the student's own state for a row with no Canvas side", () => {
    const capture = { ...base, id: "capture:cap-1", canvas: null, student: { ...base.student, status: "done" } };
    expect(itemCompleted(capture)).toBe(true);
  });
});
