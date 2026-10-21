// Purpose: tests today and capture flows
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemesterSurface } from "../ipc";

const inbox: { handler: (() => void) | null } = { handler: null };
const failed: { handler: ((m: string) => void) | null } = { handler: null };
const health = { current: { state: "empty_unverified", surfaces_enabled: false, as_of: null } as Record<string, unknown> };
vi.mock("../ipc", () => ({
  readSemester: vi.fn().mockResolvedValue({ range: "1m", window_start: "", window_end: "", today: "2026-10-08T16:00:00Z", courses: [] }),
  readSyncHealth: vi.fn().mockImplementation(async () => health.current),
  readFreshness: vi.fn().mockResolvedValue({ changes: [] }),
  readSkipCosts: vi.fn().mockResolvedValue({}),
  onFreshnessUpdated: vi.fn().mockResolvedValue(() => undefined),
  onSyncFailed: vi.fn().mockImplementation(async (h: (m: string) => void) => {
    failed.handler = h;
    return () => undefined;
  }),
  onInboxUpdated: vi.fn().mockImplementation(async (h: () => void) => {
    inbox.handler = h;
    return () => undefined;
  }),
  readCourseMap: vi.fn().mockResolvedValue(null),
  readGradeTruth: vi.fn().mockResolvedValue(null),
  openExternalUrl: vi.fn(),
  syncCanvas: vi.fn().mockResolvedValue({ ok: true }),
  openCanvasSso: vi.fn().mockResolvedValue(undefined),
  setTrayNext: vi.fn().mockResolvedValue(undefined),
  isTauri: () => false,
}));

import { TodayView } from "./TodayView";
import { openExternalUrl, syncCanvas } from "../ipc";
import { fixtureBrief, fixtureMissionControl } from "../missionControl/fixtures";

const surface: SemesterSurface = {
  range: "1m",
  window_start: "2026-09-20T00:00:00Z",
  window_end: "2026-10-20T00:00:00Z",
  today: "2026-09-20T00:00:00Z",
  courses: [
    {
      id: "1300",
      label: "MATH 1300",
      code: "MATH 1300",
      name: "Calc",
      color: "#2E86AB",
      term: { start_at: "2026-08-24T00:00:00Z", end_at: "2026-12-18T00:00:00Z", source: "canvas" },
      counts: { assignments: 2, quizzes: 0, exams: 1 },
      ticks: [
        {
          id: "item-a77",
          course_id: "1300",
          course_label: "MATH 1300",
          color: "#2E86AB",
          title: "Homework 1",
          kind: "assignment",
          due_at: "2026-09-22T16:00:00Z",
          points_possible: 10,
          weight_share: 0.05,
          html_url: "https://canvas.example/hw",
          completed: false,
          description: "hw",
        },
        {
          id: "item-a78",
          course_id: "1300",
          course_label: "MATH 1300",
          color: "#2E86AB",
          title: "Reading notes",
          kind: "assignment",
          due_at: "2026-09-24T16:00:00Z",
          points_possible: 5,
          weight_share: 0.01,
          html_url: null,
          completed: false,
          description: "",
        },
        {
          id: "ex",
          course_id: "1300",
          course_label: "MATH 1300",
          color: "#2E86AB",
          title: "Midterm 1",
          kind: "exam",
          due_at: "2026-10-15T16:00:00Z",
          points_possible: 100,
          weight_share: 0.6,
          html_url: "https://canvas.example/ex",
          completed: false,
          description: "chain rule",
        },
      ],
    },
  ],
};

const fresh = { state: "fresh_complete" as const, surfaces_enabled: true, sync_id: "s", as_of: "2026-09-20T00:00:00Z" };
const NOW = new Date("2026-09-20T00:00:00Z");
const mission = fixtureMissionControl(NOW);
const loadBrief = async (c: string, a: string) => fixtureBrief(c, a, NOW) ?? { error: "not_found" };
const base = { onStudy: () => undefined, onAsk: () => undefined, mission, loadBrief };

describe("TodayView (Mission Control)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("leads with the brief islands and opens the first brief on a new day", async () => {
    render(<TodayView {...base} surface={surface} health={fresh} />);
    expect(screen.getByRole("heading", { name: "Today is about this" })).toBeInTheDocument();
    const panel = await screen.findByRole("region", { name: /Midterm 2/ });
    expect(await within(panel).findByText("Do this next")).toBeInTheDocument();
    // No second dashboard: the old focus block and "Also this week" are gone.
    expect(screen.queryByRole("region", { name: "Also this week" })).not.toBeInTheDocument();
    // MASTER §13: no middle-dot chains
    expect(document.body.textContent).not.toContain(" · ");
  });

  it("opens Canvas and starts Study from a brief", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<TodayView {...base} surface={surface} health={fresh} onStudy={onStudy} />);
    await user.click(await screen.findByRole("button", { name: "Start studying" }));
    expect(onStudy).toHaveBeenCalledWith({ id: "item-a12" });
    await user.click(screen.getByRole("button", { name: /^Problem Set 4/ }));
    const panel = await screen.findByRole("region", { name: /Problem Set 4/ });
    await user.click(await within(panel).findByRole("button", { name: "Open in Canvas" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://canvas.example.edu/courses/101/assignments/11");
  });

  it("a deep link opens that item's brief, or its sheet when it has no brief", async () => {
    sessionStorage.setItem("mc_first_open_day", mission.today);
    const { unmount } = render(<TodayView {...base} surface={surface} health={fresh} openItem={{ courseId: "101", itemId: "item-a11" }} />);
    expect(await screen.findByRole("region", { name: /Problem Set 4/ })).toBeInTheDocument();
    unmount();
    render(<TodayView {...base} surface={surface} health={fresh} openItem={{ courseId: "1300", itemId: "item-a77" }} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Homework 1");
  });

  it("offers the last answer as a row", async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    const lastAsk = { ok: true, input_id: "ask-1", response: { one_sentence: "The derivative is 2x." } } as never;
    render(<TodayView {...base} surface={surface} health={fresh} lastAsk={lastAsk} onAsk={onAsk} />);
    expect(screen.getByText("The derivative is 2x.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onAsk).toHaveBeenCalledWith(lastAsk);
  });

  it("says how many things changed since the student last looked", async () => {
    const user = userEvent.setup();
    const changes = [
      { key: "a", kind: "due_changed", label: "Due date moved", title: "Homework 1", course: "MATH 1300", detected_at: "2026-09-19T00:00:00Z" },
      { key: "b", kind: "announcement", label: "Announcement", title: "Office hours moved", course: "MATH 1300", detected_at: "2026-09-19T01:00:00Z" },
    ];
    render(<TodayView {...base} surface={surface} health={fresh} changes={changes} />);
    expect(screen.getByRole("heading", { name: /2 things changed in Canvas since you last looked/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See what changed" }));
    expect(screen.getByText("Office hours moved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark these as seen" }));
    expect(screen.queryByText(/changed in Canvas since you last looked/)).not.toBeInTheDocument();
  });

  it("shows empty_unverified as a warning with a Sync now that works", async () => {
    const user = userEvent.setup();
    render(<TodayView {...base} surface={{ ...surface, courses: [] }} health={{ state: "empty_unverified", surfaces_enabled: false, sync_id: null }} />);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(/not an empty week/i);
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncCanvas).toHaveBeenCalled();
  });

  it("offers Sign in again when Canvas is blocked", () => {
    render(<TodayView {...base} surface={surface} health={{ state: "blocked", surfaces_enabled: false, sync_id: null }} />);
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

  it("says briefs come after the first sync instead of inventing any", () => {
    render(<TodayView {...base} mission={{ ...mission, prepared: false, assignments: [], operations: [] }} surface={surface} health={fresh} />);
    expect(screen.getByText("Your briefs are prepared after the first Canvas sync.")).toBeInTheDocument();
  });
});

describe("TodayView captures", () => {
  it("shows the student's own rows for the week", () => {
    render(
      <TodayView
        {...base}
        surface={surface}
        health={fresh}
        captures={[{ id: "cap-2", title: "outline the lab", course: "MATH 1300", due_at: null, day: "2026-09-22", source: "typed", created_at: "2026-09-20T18:00:00" }]}
      />
    );
    expect(screen.getByRole("region", { name: "You added" })).toHaveTextContent("outline the lab");
  });
});

describe("TodayView after a background Canvas sync", () => {
  it("re-reads sync health when the sync finishes, and surfaces a failed background sync", async () => {
    render(<TodayView onStudy={() => undefined} onAsk={() => undefined} />);
    expect(await screen.findByText(/hasn't finished reading Canvas yet/)).toBeInTheDocument();
    health.current = { state: "fresh_complete", surfaces_enabled: true, as_of: "2026-10-08T16:05:00Z" };
    await act(async () => inbox.handler?.());
    expect(await screen.findByText(/Up to date with Canvas/)).toBeInTheDocument();
    await act(async () => failed.handler?.("Canvas timed out"));
    expect(await screen.findByText(/last background sync didn't finish/)).toBeInTheDocument();
    expect(screen.getByText(/Canvas timed out/)).toBeInTheDocument();
  });
});
