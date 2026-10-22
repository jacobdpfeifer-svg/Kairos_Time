import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPEC, type WorkspaceSpec } from "./contracts";
import { WorkspaceRenderer, type WorkspaceHost } from "./WorkspaceRenderer";

vi.mock("../views/TodayView", () => ({
  TodayView: ({ openItem }: { openItem?: { itemId: string } | null }) => <h1>Today view {openItem?.itemId}</h1>,
}));
vi.mock("../views/WeekView", () => ({ WeekView: () => <h1>Week view</h1> }));
vi.mock("../views/CoursesView", () => ({
  CoursesView: ({ courseId }: { courseId?: string }) => <h1>Courses view {courseId}</h1>,
}));
vi.mock("../views/StudyPathView", () => ({
  StudyPathView: ({ examId, practice }: { examId?: string; practice?: boolean }) => <h1>{practice ? `Practice ${examId}` : `Study view ${examId}`}</h1>,
}));
vi.mock("../views/AdvisorView", () => ({ AdvisorView: () => <h1>Advisor view</h1> }));

const host = {
  lastAsk: null,
  openItem: { itemId: "item-a1" },
  onStudyToday: () => undefined,
  onAsk: () => undefined,
  onOpenWeek: () => undefined,
  onToast: () => undefined,
  onStudyTick: () => undefined,
  examId: "exam-1",
  practice: true,
  onOpenExam: () => undefined,
  onPractice: () => undefined,
  onBack: () => undefined,
  onGoToSources: () => undefined,
  onOpenCourse: () => undefined,
  courseId: "1300",
  filesVersion: 2,
} satisfies WorkspaceHost;

describe("WorkspaceRenderer", () => {
  it("renders every current surface from the default spec", () => {
    const { rerender } = render(<WorkspaceRenderer surface="today" spec={DEFAULT_SPEC} host={host} />);
    expect(screen.getByRole("heading", { name: "Today view item-a1" })).toBeInTheDocument();
    rerender(<WorkspaceRenderer surface="week" spec={DEFAULT_SPEC} host={host} />);
    expect(screen.getByRole("heading", { name: "Week view" })).toBeInTheDocument();
    rerender(<WorkspaceRenderer surface="courses" spec={DEFAULT_SPEC} host={host} />);
    expect(screen.getByRole("heading", { name: "Courses view 1300" })).toBeInTheDocument();
    rerender(<WorkspaceRenderer surface="study" spec={DEFAULT_SPEC} host={host} />);
    expect(screen.getByRole("heading", { name: "Practice exam-1" })).toBeInTheDocument();
    rerender(<WorkspaceRenderer surface="advisor" spec={DEFAULT_SPEC} host={host} />);
    expect(screen.getByRole("heading", { name: "Advisor view" })).toBeInTheDocument();
  });

  it("renders the default screen instead of a spec that fails validation", () => {
    const onInvalid = vi.fn();
    const bad = { schema_version: 1, status: "draft", surfaces: { today: { slots: ["b_today"] } }, blocks: {} } as WorkspaceSpec;
    render(<WorkspaceRenderer surface="today" spec={bad} host={host} onInvalid={onInvalid} />);
    expect(screen.getByRole("heading", { name: "Today view item-a1" })).toBeInTheDocument();
    expect(screen.queryByText(/draft/)).not.toBeInTheDocument();
    expect(onInvalid).toHaveBeenCalledWith("Kairos kept your previous workspace because the new one didn't check out.");
  });
});
