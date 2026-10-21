// Purpose: tests the courses view
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transport } from "../study/api";
import type { SemesterSurface, SemesterTick } from "../ipc";
import type { Status } from "../study/types";
import { CoursesView } from "./CoursesView";
import { examScope, sameCourse } from "./StudyPathView";

const tick = (over: Partial<SemesterTick>): SemesterTick => ({
  id: "item-a1",
  course_id: "1300",
  course_label: "MATH 1300",
  color: "#2E86AB",
  title: "Homework 4",
  kind: "assignment",
  due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  points_possible: 10,
  weight_share: 0.03,
  html_url: null,
  completed: false,
  description: "",
  ...over,
});

const surface: SemesterSurface = {
  range: "full",
  window_start: "",
  window_end: "",
  today: new Date().toISOString(),
  courses: [
    {
      id: "1300",
      label: "MATH 1300",
      code: "MATH 1300",
      name: "Calculus 1",
      color: "#2E86AB",
      term: { start_at: null, end_at: null, source: "canvas" },
      counts: { assignments: 1, quizzes: 0, exams: 1 },
      ticks: [tick({}), tick({ id: "ex", title: "Midterm 1", kind: "exam", weight_share: 0.25, due_at: new Date(Date.now() + 9 * 86_400_000).toISOString() })],
    },
  ],
};

describe("CoursesView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(transport, "send").mockResolvedValue({ ok: true, library: { entries: [], courses: [], categories: [], total_bytes: 0 } } as never);
  });

  it("lists each course with the Canvas grade beside the grade with missing work as zero", async () => {
    const onOpenCourse = vi.fn();
    const user = userEvent.setup();
    render(
      <CoursesView
        surface={surface}
        grades={{ "1300": { lead: { canvas_says: 88.4, canvas_letter: "B+", unsubmitted_due_count: 1, risk: 85.1, why: "" } } }}
        onOpenCourse={onOpenCourse}
        onBack={() => undefined}
        onStudy={() => undefined}
      />
    );
    expect(screen.getByText("Canvas says 88.4% (B+). With missing work as zero, 85.1%.")).toBeInTheDocument();
    expect(screen.getByText(/Next: Homework 4, in 2 days/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Calculus 1/ }));
    expect(onOpenCourse).toHaveBeenCalledWith("1300");
  });

  it("shows a course page with open work, its exams, and its files", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<CoursesView courseId="1300" surface={surface} grades={{}} onOpenCourse={() => undefined} onBack={() => undefined} onStudy={onStudy} />);
    expect(screen.getByRole("heading", { name: "Calculus 1" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Open work" })).getByText("Homework 4")).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Exams and quizzes" })).getByRole("button", { name: /Midterm 1/ }));
    expect(onStudy).toHaveBeenCalledWith(expect.objectContaining({ id: "ex" }));
    expect(await screen.findByText("Add files to MATH 1300")).toBeInTheDocument();
  });
});

describe("exam scope", () => {
  const exam = tick({ id: "ex", title: "Midterm 1", kind: "exam" });
  const status = (scope: string[]) =>
    ({ exams: [{ id: "x", course: "MATH 1300: Calculus 1", label: "Midterm 1", objective_scope: scope }], packets: [] }) as unknown as Status;

  it("uses the exam's own scope first", () => {
    const s = examScope(exam, status(["Chain rule", "Related rates"]), [{ title: "Limits" }]);
    expect(s.topics).toEqual(["Chain rule", "Related rates"]);
  });

  it("falls back to recent unlocked modules and says it's a guess", () => {
    const s = examScope(exam, status([]), [{ title: "Limits" }, { title: "Chain rule" }, { title: "Locked unit", locked: true }]);
    expect(s.sources.map((x) => x.title)).toEqual(["Limits", "Chain rule"]);
    expect(s.note).toMatch(/a guess/);
  });

  it("claims nothing when there's nothing to go on", () => {
    expect(examScope(exam, null, [])).toEqual({ topics: [], sources: [], note: "" });
  });

  it("matches course labels loosely", () => {
    expect(sameCourse("MATH 1300", "math-1300: Calculus")).toBe(true);
    expect(sameCourse("MATH 1300", "CSCI 1300")).toBe(false);
  });
});
