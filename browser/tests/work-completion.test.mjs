/**
 * Cross-producer parity for "done" and for the student-effective due date.
 *
 * Three predicates disagreed before this gate existed: the semester surface
 * counted any score, week.md counted only submitted/graded/pending_review, and
 * the app re-derived its own set from `submission_state`. The disagreement was
 * invisible because every fixture agreed with itself. This test computes all
 * paths from one corpus and fails on divergence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reconcile_due_items } from "../scripts/lib/canvas-reconcile.mjs";
import { fixtureGeneration } from "../scripts/lib/canvas-reliability-fixtures.mjs";
import { promoteProjections } from "../scripts/lib/canvas-project.mjs";
import { itemsToWeekRows } from "../scripts/lib/canvas-adapters.mjs";
import { itemFromAssignment } from "../scripts/lib/study-sources.mjs";
import { completeFromItem, completeFromSubmission } from "../scripts/lib/work-completion.mjs";
import { rebuildWorkState, readWorkState } from "../scripts/lib/work-state.mjs";

const COURSE_ID = 1300;

/** Each case is a real Canvas shape the old predicates disagreed about. */
const CASES = [
  {
    name: "graded and submitted",
    expect: { completed: true, due_at: "2026-09-22T16:00:00Z" },
    assignment: {
      id: 101,
      name: "Homework 1",
      due_at: "2026-09-22T16:00:00Z",
      all_dates: [{ base: true, due_at: "2026-09-22T16:00:00Z" }],
      submission: { workflow_state: "graded", score: 9, submitted_at: "2026-09-21T12:00:00Z", posted_at: "2026-09-21T13:00:00Z" },
    },
  },
  {
    name: "teacher entered a score that is not posted yet",
    expect: { completed: true, due_at: "2026-10-01T16:00:00Z" },
    assignment: {
      id: 102,
      name: "In-class problem set",
      due_at: "2026-10-01T16:00:00Z",
      submission_types: ["on_paper"],
      all_dates: [{ base: true, due_at: "2026-10-01T16:00:00Z" }],
      submission: { workflow_state: "unsubmitted", score: 18, posted_at: null, submitted_at: null },
    },
  },
  {
    // The canonical reconciler buckets a late submission as overdue, not
    // submitted: it may still need the student to act. Every producer follows.
    name: "submitted after the due date",
    expect: { completed: false, due_at: "2026-10-05T16:00:00Z" },
    assignment: {
      id: 103,
      name: "Lab 3",
      due_at: "2026-10-05T16:00:00Z",
      all_dates: [{ base: true, due_at: "2026-10-05T16:00:00Z" }],
      submission: { workflow_state: "submitted", late: true, submitted_at: "2026-10-06T09:00:00Z", score: null },
    },
  },
  {
    name: "not started",
    expect: { completed: false, due_at: "2026-10-30T16:00:00Z" },
    assignment: {
      id: 104,
      name: "Homework 4",
      due_at: "2026-10-30T16:00:00Z",
      all_dates: [{ base: true, due_at: "2026-10-30T16:00:00Z" }],
      submission: { workflow_state: "unsubmitted", score: null, submitted_at: null },
    },
  },
  {
    name: "an instructor extension moves the student's due date",
    expect: { completed: false, due_at: "2026-11-06T16:00:00Z" },
    assignment: {
      id: 105,
      name: "Homework 5",
      due_at: "2026-10-28T16:00:00Z",
      all_dates: [
        { base: true, due_at: "2026-10-28T16:00:00Z" },
        { base: false, id: 9001, title: "1 student", due_at: "2026-11-06T16:00:00Z" },
      ],
      submission: { workflow_state: "unsubmitted", score: null, submitted_at: null },
    },
  },
  {
    name: "no due date at all",
    expect: { completed: false, due_at: null },
    assignment: {
      id: 106,
      name: "Optional reading",
      due_at: null,
      all_dates: [],
      submission: { workflow_state: "unsubmitted", score: null, submitted_at: null },
    },
  },
];

function corpusCourse() {
  const assignments = CASES.map((c) => ({
    points_possible: 10,
    assignment_group_id: 1,
    published: true,
    grading_type: "points",
    submission_types: ["online_upload"],
    html_url: `https://canvas.example/courses/${COURSE_ID}/assignments/${c.assignment.id}`,
    ...c.assignment,
  }));
  return {
    id: "completion-corpus",
    course: {
      id: COURSE_ID,
      name: "Calculus 1",
      course_code: "MATH 1300",
      enrollment_term_id: 1,
      time_zone: "America/Denver",
      start_at: "2026-08-24T06:00:00Z",
      end_at: "2026-12-18T07:00:00Z",
      syllabus_body: "<p>MATH 1300 syllabus.</p>",
      enrollments: [{ type: "student", enrollment_state: "active" }],
    },
    assignmentGroups: [{ id: 1, name: "Homework", group_weight: 100, rules: { drop_lowest: 0, drop_highest: 0, never_drop: [] } }],
    assignments,
    submissions: assignments.map((a) => ({ ...a.submission, assignment_id: a.id, id: a.id * 10 })),
    modules: [],
    discussions: [],
    quizzes: [],
    planner: [],
    todo: [],
    calendar: [],
    pages: [],
  };
}

describe("completion and due-date parity", () => {
  const generation = fixtureGeneration({ courses: [corpusCourse()] });
  const { items } = reconcile_due_items(generation);
  const byCanvasId = new Map(items.map((item) => [String(item.canvas_id), item]));
  const weekRows = new Map(
    itemsToWeekRows(items, [corpusCourse().course]).map((row) => [String(row.canvas_id), row]),
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pn-parity-"));
  promoteProjections(root, generation, { now: Date.parse("2026-10-23T18:00:00Z") });
  const built = rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" });
  assert.equal(built.ok, true, "work state must build from the corpus");
  const workRows = new Map(
    (readWorkState(root).state.work_items || [])
      .filter((row) => row.kind === "assignment")
      .map((row) => [row.id.split(":").pop(), row]),
  );

  for (const kase of CASES) {
    const id = String(kase.assignment.id);
    it(`agrees on "${kase.name}"`, () => {
      const canonical = byCanvasId.get(id);
      assert.ok(canonical, "the corpus item must reconcile");
      const legacy = itemFromAssignment(COURSE_ID, { ...corpusCourse().assignments.find((a) => String(a.id) === id) });
      const weekRow = weekRows.get(id);
      const workRow = workRows.get(id);
      assert.ok(workRow, "the corpus item must reach work state");

      const completion = {
        expected: kase.expect.completed,
        semesterSurface: legacy.completed,
        weekMarkdown: weekRow.complete,
        canonical: completeFromItem(canonical),
        rawSubmission: completeFromSubmission(kase.assignment.submission),
        workState: workRow.canvas.completed,
      };
      for (const [path_, value] of Object.entries(completion)) {
        assert.equal(value, kase.expect.completed, `${path_} disagrees on completion`);
      }

      const due = {
        semesterSurface: legacy.due_at,
        canonical: canonical.effective_due_at,
        weekMarkdown: weekRow.due || null,
        workState: workRow.due_at,
      };
      for (const [path_, value] of Object.entries(due)) {
        assert.equal(value, kase.expect.due_at, `${path_} disagrees on the due date`);
      }
    });
  }

  it("keeps the semester surface and work state on the same effective date", () => {
    // The native reader windows and sorts the semester surface on its own
    // due_at, so a disagreement here silently drops or misorders rows.
    for (const kase of CASES) {
      const id = String(kase.assignment.id);
      const legacy = itemFromAssignment(COURSE_ID, corpusCourse().assignments.find((a) => String(a.id) === id));
      assert.equal(legacy.due_at, workRows.get(id).due_at, `${kase.name} diverges`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
});
