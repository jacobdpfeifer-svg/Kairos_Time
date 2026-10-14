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
const base = { onStudy: () => undefined, onAsk: () => undefined };

describe("TodayView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("puts one next move in the focus block with what skipping it costs", async () => {
    const user = userEvent.setup();
    render(
      <TodayView
        {...base}
        surface={surface}
        health={fresh}
        skipCosts={{ "1300:77": { course_id: "1300", assignment_id: "77", current: 88, if_zero: 84.5, if_full: 89, swing: 4.5, share_of_final: null, status: "ok" } }}
      />
    );
    const focus = screen.getByRole("region", { name: "Homework 1" });
    expect(within(focus).getByText("MATH 1300, homework")).toBeInTheDocument();
    expect(within(focus).getByText("Skip it: 88% → 84.5% in MATH 1300. Full marks: 89%.")).toBeInTheDocument();
    await user.click(within(focus).getByRole("button", { name: "Open in Canvas" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://canvas.example/hw");
    // the rest of the week is a quiet list without the lead
    const week = screen.getByRole("region", { name: "Also this week" });
    expect(week).toHaveTextContent("Reading notes");
    expect(week).not.toHaveTextContent("Homework 1");
    // MASTER §13: no middle-dot chains
    expect(document.body.textContent).not.toContain(" · ");
  });

  it("starts studying when the lead is an exam", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    const examFirst: SemesterSurface = {
      ...surface,
      courses: [{ ...surface.courses[0], ticks: surface.courses[0].ticks.map((t) => (t.kind === "assignment" ? { ...t, completed: true } : t)) }],
    };
    render(<TodayView {...base} surface={examFirst} health={fresh} onStudy={onStudy} />);
    await user.click(screen.getByRole("button", { name: "Start studying" }));
    expect(onStudy).toHaveBeenCalledWith(expect.objectContaining({ id: "ex" }));
  });

  it("opens an item sheet that takes focus and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<TodayView {...base} surface={surface} health={fresh} />);
    const title = within(screen.getByRole("region", { name: "Homework 1" })).getByRole("button", { name: "Homework 1" });
    await user.click(title);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(title);
  });

  it("opens the exam's study track from its sheet", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<TodayView {...base} surface={surface} health={fresh} onStudy={onStudy} />);
    await user.click(within(screen.getByRole("region", { name: "Also this week" })).queryByRole("button", { name: /Midterm 1/ }) ?? screen.getByRole("button", { name: "Midterm 1" }));
    await user.click(screen.getByRole("button", { name: "Study for it" }));
    expect(onStudy).toHaveBeenCalledWith(expect.objectContaining({ id: "ex" }));
  });

  it("keeps the next move on screen and offers the last answer as a row", async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    const lastAsk = { ok: true, input_id: "ask-1", response: { one_sentence: "The derivative is 2x." } } as never;
    render(<TodayView {...base} surface={surface} health={fresh} lastAsk={lastAsk} onAsk={onAsk} />);
    expect(screen.getByRole("region", { name: "Homework 1" })).toBeInTheDocument();
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
    expect(screen.getByText(/The due date moved/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See what changed" }));
    expect(screen.getByText("Office hours moved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark these as seen" }));
    expect(screen.queryByText(/changed in Canvas since you last looked/)).not.toBeInTheDocument();
  });

  it("shows empty_unverified as a warning with a Sync now that works", async () => {
    const user = userEvent.setup();
    render(<TodayView {...base} surface={{ ...surface, courses: [] }} health={{ state: "empty_unverified", surfaces_enabled: false, sync_id: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not an empty week/i);
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncCanvas).toHaveBeenCalled();
  });

  it("offers Sign in again when Canvas is blocked", () => {
    render(<TodayView {...base} surface={surface} health={{ state: "blocked", surfaces_enabled: false, sync_id: null }} />);
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
});

describe("TodayView captures", () => {
  it("shows a capture planned for today as the next move, and later ones as rows", () => {
    const dated: SemesterSurface = {
      ...surface,
      today: "2026-09-20T18:00:00",
      courses: [{ ...surface.courses[0], ticks: [] }],
    };
    const { rerender } = render(
      <TodayView
        {...base}
        surface={dated}
        health={fresh}
        captures={[{ id: "cap-1", title: "read ch 5", course: "MATH 1300", due_at: null, day: "2026-09-20", source: "typed", created_at: "2026-09-20T18:00:00" }]}
      />
    );
    expect(screen.getByRole("region", { name: "read ch 5" })).toHaveTextContent("Planned for today.");
    expect(screen.queryByText(/Nothing due in the next month/)).not.toBeInTheDocument();

    rerender(
      <TodayView
        {...base}
        surface={surface}
        health={fresh}
        captures={[{ id: "cap-2", title: "outline the lab", course: "MATH 1300", due_at: null, day: "2026-09-22", source: "typed", created_at: "2026-09-20T18:00:00" }]}
      />
    );
    expect(screen.getByRole("region", { name: "You added" })).toHaveTextContent("outline the lab");
    expect(screen.getByRole("region", { name: "Homework 1" })).toBeInTheDocument();
  });
});

describe("TodayView after a background Canvas sync", () => {
  it("re-reads sync health when the sync finishes, and surfaces a failed background sync", async () => {
    render(<TodayView {...base} />);
    expect(await screen.findByText(/hasn't finished reading Canvas yet/)).toBeInTheDocument();
    health.current = { state: "fresh_complete", surfaces_enabled: true, as_of: "2026-10-08T16:05:00Z" };
    await act(async () => inbox.handler?.());
    expect(await screen.findByText(/Up to date with Canvas/)).toBeInTheDocument();
    await act(async () => failed.handler?.("Canvas timed out"));
    expect(await screen.findByText(/last background sync didn't finish/)).toBeInTheDocument();
    expect(screen.getByText(/Canvas timed out/)).toBeInTheDocument();
  });
});

describe("TodayView in exam week", () => {
  it("shrinks to the exam when one is three days out, and the whole day is one click away", async () => {
    const user = userEvent.setup();
    const examSoon: SemesterSurface = { ...surface, today: "2026-10-13T16:00:00Z" };
    const onStudy = vi.fn();
    render(<TodayView {...base} surface={examSoon} health={fresh} onStudy={onStudy} />);
    const focus = screen.getByRole("region", { name: "Midterm 1" });
    expect(focus).toHaveTextContent(/In 2 days\. Day 2 of 3 before it\./);
    expect(screen.queryByRole("region", { name: "Also this week" })).not.toBeInTheDocument();
    await user.click(within(focus).getByRole("button", { name: "Study for it" }));
    expect(onStudy).toHaveBeenCalledWith(expect.objectContaining({ id: "ex" }));
    await user.click(screen.getByRole("button", { name: "Show my whole day" }));
    expect(screen.queryByRole("region", { name: "Midterm 1" })).not.toBeInTheDocument();
    sessionStorage.clear();
  });
});
