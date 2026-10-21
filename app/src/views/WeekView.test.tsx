// Purpose: tests the week planning view
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SemesterSurface } from "../ipc";
import { Toast, type ToastState } from "../components/Toast";
import { resetPreviewStore } from "../week/api";
import { WeekView } from "./WeekView";

// Wednesday, Oct 14 2026 at 9:00 local.
const NOW = new Date(2026, 9, 14, 9, 0, 0);
const at = (day: number) => new Date(2026, 9, day, 23, 59).toISOString();

const surface: SemesterSurface = {
  range: "1m",
  window_start: at(1),
  window_end: at(30),
  today: NOW.toISOString(),
  courses: [
    {
      id: "1300",
      label: "MATH 1300",
      code: "MATH 1300",
      name: "Calc",
      color: "#2E86AB",
      term: { start_at: null, end_at: null, source: "canvas" },
      counts: { assignments: 2, quizzes: 0, exams: 0 },
      ticks: [
        { id: "item-a1", course_id: "1300", course_label: "MATH 1300", color: "#2E86AB", title: "Problem set 5", kind: "assignment", due_at: at(16), points_possible: 20, weight_share: 0.05, html_url: null, completed: false, description: "" },
        { id: "item-a2", course_id: "1300", course_label: "MATH 1300", color: "#2E86AB", title: "Reading notes", kind: "assignment", due_at: at(15), points_possible: 5, weight_share: 0.01, html_url: null, completed: false, description: "" },
      ],
    },
  ],
};

function Harness({ changes = [] as never[] }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  return (
    <div className="workspace">
      <WeekView surface={surface} changes={changes} now={NOW} onToast={setToast} onStudy={() => undefined} />
      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

describe("WeekView", () => {
  beforeEach(() => resetPreviewStore());

  it("asks for hours once, then says whether the week fits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByText("About 2 hours of work left this week.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/How many hours outside class/), "1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/more than fits\./)).toBeInTheDocument();
    // The cheapest thing to move is offered, not moved.
    const wait = screen.getByRole("region", { name: "Could wait" });
    expect(within(wait).getByText("Reading notes")).toBeInTheDocument();
  });

  it("defers a row to the next day with undo, and D does the same from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const thursday = await screen.findByRole("region", { name: /Tomorrow/ });
    const row = within(thursday).getByRole("listitem", { name: "Problem set 5" });
    await user.click(within(row).getByRole("button", { name: "Defer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Problem set 5 moved to");
    const friday = screen.getByRole("region", { name: /Friday/ });
    expect(within(friday).getByText("Problem set 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await within(screen.getByRole("region", { name: /Tomorrow/ })).findByText("Problem set 5")).toBeInTheDocument();
    // keyboard
    within(screen.getByRole("region", { name: /Tomorrow/ })).getByRole("listitem", { name: "Reading notes" }).focus();
    await user.keyboard("d");
    expect(await within(screen.getByRole("region", { name: /Friday/ })).findByText("Reading notes")).toBeInTheDocument();
  });

  it("plans the week in three steps and only uses the order after a yes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Plan this week" }));
    const sheet = screen.getByRole("dialog", { name: "Plan this week" });
    expect(sheet).toHaveTextContent("step 1 of 3");
    await user.click(within(sheet).getByRole("button", { name: "Next" }));
    await user.click(within(sheet).getByRole("button", { name: "Next" }));
    expect(sheet).toHaveTextContent("Once you use it, this order stays put.");
    await user.click(within(sheet).getByRole("button", { name: "Use this plan" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Replan this week" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("stays put until you change it");
  });

  it("sorts Canvas changes into piles and lets the student move one for good", async () => {
    const user = userEvent.setup();
    const changes = [
      { key: "ann:1", kind: "announcement", label: "Announcement", title: "Lab moved to room 120", course: "CSCI 1300", detected_at: NOW.toISOString() },
      { key: "due:1", kind: "due_changed", label: "Due date moved", title: "Problem set 5", course: "MATH 1300", detected_at: NOW.toISOString() },
    ];
    render(<Harness changes={changes as never[]} />);
    expect(await screen.findByRole("heading", { name: "Needs you, 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "For your info, 1" })).toBeInTheDocument();
    const fyi = screen.getByRole("heading", { name: "For your info, 1" }).closest("section") as HTMLElement;
    await user.click(within(fyi).getByRole("button", { name: "Something in the wrong pile?" }));
    await user.click(within(fyi).getByRole("checkbox"));
    await user.click(within(fyi).getByRole("button", { name: "To needs you" }));
    expect(await screen.findByRole("heading", { name: "Needs you, 2" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("from now on");
  });
});
