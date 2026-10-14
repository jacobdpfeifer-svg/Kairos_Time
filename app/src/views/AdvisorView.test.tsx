import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorView, meetingBrief, paces, termsUntil } from "./AdvisorView";
import { EMPTY_ADVISOR, readAdvisorSnapshot, type AdvisorSnapshot } from "../ipc";
import { fixtureAdvisor } from "../dev/fixtures";
import { transport } from "../study/api";

vi.mock("../ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc")>();
  return {
    ...actual,
    onInboxUpdated: vi.fn().mockResolvedValue(() => undefined),
    readAdvisorSnapshot: vi.fn(),
  };
});

const OCT = new Date(2026, 9, 13);

function withSnapshot(snapshot: AdvisorSnapshot) {
  vi.mocked(readAdvisorSnapshot).mockResolvedValue(snapshot);
}

describe("AdvisorView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Dates render without a year only inside the current year.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT);
    withSnapshot(fixtureAdvisor());
  });
  afterEach(() => vi.useRealTimers());

  it("leads with the first open requirement from a dated audit copy and names every source", async () => {
    render(<AdvisorView />);
    expect(await screen.findByRole("heading", { name: "Plan for Upper-division humanities or social science elective" })).toBeInTheDocument();
    expect(screen.getByText("7 complete, 3 in progress, 2 open")).toBeInTheDocument();
    expect(screen.getByText("Aerospace Engineering Sciences")).toBeInTheDocument();
    expect(screen.getAllByText(/^Audit copy from Oct 1$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Canvas, synced Oct 12/).length).toBe(4);
    // Notebook: one primary action per view, no middle-dot chains.
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("primary"))).toHaveLength(1);
    expect(document.body.textContent).not.toContain("·");
  });

  it("stays in planning mode without an audit and never claims requirement counts", async () => {
    withSnapshot(EMPTY_ADVISOR);
    render(<AdvisorView />);
    expect(await screen.findByRole("heading", { name: "Add a copy of your degree audit" })).toBeInTheDocument();
    expect(screen.queryByText(/complete,/)).not.toBeInTheDocument();
    expect(screen.queryByText("Credits left")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Paths" }));
    expect(screen.getByText(/needs a remaining-credit total from your audit copy and a target term/)).toBeInTheDocument();
  });

  it("flags a stale audit copy instead of presenting it as current", async () => {
    const stale = fixtureAdvisor();
    stale.mode = "stale_audit";
    stale.audit = { ...stale.audit, stale: true, imported_on: "2026-03-01", stale_days: 226 };
    withSnapshot(stale);
    render(<AdvisorView />);
    expect(await screen.findByRole("heading", { name: "Refresh your audit copy" })).toBeInTheDocument();
    expect(screen.getAllByText(/out of date/).length).toBeGreaterThan(0);
  });

  it("warns when the target term needs more than a full load", async () => {
    const tight = fixtureAdvisor();
    tight.target_grad_term = "Fall 2027";
    tight.audit = { ...tight.audit, remaining_credits: 60 };
    withSnapshot(tight);
    render(<AdvisorView />);
    expect(await screen.findByRole("note")).toHaveTextContent(/about 30 credits a term, more than a typical full load/);
    fireEvent.click(screen.getByRole("tab", { name: "Paths" }));
    expect(screen.getByText("Above a full load")).toBeInTheDocument();
  });

  it("moves from the decision into a copyable meeting brief", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AdvisorView />);
    await screen.findByRole("heading", { name: "Advisor" });
    fireEvent.click(screen.getByRole("tab", { name: "Next decision" }));
    expect(screen.getByRole("heading", { name: "What to settle before you register" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare advisor questions" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Bring this to your advisor" })).toBeInTheDocument();
    expect(within(panel).getByText("Is Spring 2029 still realistic with 42 credits left?")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Copy questions" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
    expect(writeText.mock.calls[0][0]).toContain("1. What is the best way to finish");
  });

  it("supports arrow keys between modes", async () => {
    render(<AdvisorView />);
    await screen.findByRole("heading", { name: "Advisor" });
    const first = screen.getByRole("tab", { name: "Where I am" });
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Advisor meeting" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("advisor pacing", () => {
  it("counts fall and spring terms after the current one", () => {
    expect(termsUntil("Spring 2029", OCT)).toBe(5);
    expect(termsUntil("Fall 2027", OCT)).toBe(2);
    expect(termsUntil("Fall 2026", OCT)).toBeNull();
    expect(termsUntil("someday", OCT)).toBeNull();
    expect(termsUntil("Spring 2027", new Date(2026, 2, 1))).toBe(2);
  });

  it("offers an on-time and an extra-year pace", () => {
    expect(paces(42, "Spring 2029", OCT)).toEqual([
      { label: "Finish by Spring 2029", terms: 5, perTerm: 8.4, overload: false },
      { label: "One extra year", terms: 7, perTerm: 6, overload: false },
    ]);
    expect(paces(null, "Spring 2029", OCT)).toEqual([]);
  });

  it("writes a brief with no undated claims", () => {
    const brief = meetingBrief({ ...fixtureAdvisor(), audit: { ...fixtureAdvisor().audit, dated: false, imported_on: null } });
    expect(brief).toContain("Audit copy: no date, 42 credits left");
  });
});

describe("AdvisorView writes", () => {
  it("adds a dated audit from three pasted parts, then reads it back", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    vi.spyOn(transport, "send").mockImplementation(async (cmd, params) => {
      calls.push([cmd, params]);
      return { ok: true, saved: "degree-audit.md", imported_on: "2026-10-13", counts: { complete: 0, in_progress: 0, still_needed: 1 } } as never;
    });
    withSnapshot(EMPTY_ADVISOR);
    render(<AdvisorView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add your audit" }));
    const dialog = screen.getByRole("dialog", { name: "Add your degree audit" });
    fireEvent.change(within(dialog).getByLabelText("Still needed"), { target: { value: "ASEN senior design" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save my audit" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls[0][0]).toBe("audit-import");
    expect(calls[0][1].still_needed).toBe("ASEN senior design");
  });
});
