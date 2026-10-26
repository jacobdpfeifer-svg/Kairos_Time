import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkStateRead } from "../ipc";

vi.mock("../ipc", () => ({
  readSemester: vi.fn().mockResolvedValue({
    range: "1m",
    window_start: "2026-09-01T00:00:00Z",
    window_end: "2026-12-01T00:00:00Z",
    today: "2026-10-08T16:00:00Z",
    courses: [
      {
        id: "1300",
        label: "MATH",
        code: "MATH 1300",
        name: "Calculus",
        color: "#2E86AB",
        term: { start_at: "2026-08-24T00:00:00Z", end_at: "2026-12-18T00:00:00Z", source: "canvas" },
        counts: { assignments: 1, quizzes: 0, exams: 0 },
        ticks: [
          {
            id: "item-a101",
            course_id: "1300",
            course_label: "MATH",
            color: "#2E86AB",
            title: "Homework 1",
            kind: "assignment",
            due_at: "2026-10-26T16:00:00Z",
            points_possible: 10,
            weight_share: 0.2,
            html_url: "https://canvas.example/courses/1300/assignments/101",
            completed: false,
            description: "",
          },
        ],
      },
    ],
  }),
}));

import { SemesterLine } from "./SemesterLine";

const work: WorkStateRead = {
  ok: true,
  reason: null,
  fell_back: false,
  health: { schema_version: 1 },
  state: {
    schema_version: 1,
    coverage: { canvas: "ok", freshness: "ok", plan: "ok", study: "unlinked" },
    work_items: [
      {
        id: "canvas:cu-boulder:1300:assignment:101",
        course_id: "canvas:course:cu-boulder:1300",
        kind: "assignment",
        title: "Homework 1",
        due_at: "2026-10-26T16:00:00Z",
        canvas: {
          url: "https://canvas.example/courses/1300/assignments/101",
          submission_state: "graded",
          completed: true,
        },
        change: null,
        student: { status: null, estimate_minutes: null, planned_day: null, order: null, plan_id: "item-a101" },
      },
    ],
  },
};

describe("SemesterLine", () => {
  it("marks a tick done when work state says the student is finished", async () => {
    render(<SemesterLine work={work} onOpen={() => undefined} />);
    const tick = await screen.findByRole("button", { name: "Homework 1" });
    expect(tick.className).toContain("done");
  });
});
