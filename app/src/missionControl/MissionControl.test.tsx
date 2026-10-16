import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gcal, drafts } = vi.hoisted(() => ({
  gcal: { preview: vi.fn(), confirm: vi.fn() },
  drafts: { get: vi.fn(), create: vi.fn(), update: vi.fn(), review: vi.fn(), discard: vi.fn(), list: vi.fn() },
}));
vi.mock("../study/api", () => ({
  connectors: {
    gcalPreview: (...a: unknown[]) => gcal.preview(...a),
    gcalConfirm: (...a: unknown[]) => gcal.confirm(...a),
  },
  emailDrafts: drafts,
  briefs: { enrich: vi.fn().mockResolvedValue({ status: "complete", enrichment: null }) },
}));
vi.mock("../ipc", () => ({
  isTauri: () => false,
  dismissCalendarSuggestion: vi.fn().mockResolvedValue(undefined),
}));

import { MissionControlView } from "./MissionControlView";
import { fixtureBrief, fixtureMissionControl } from "./fixtures";
import { BRIEF_ACTION_KINDS, type MissionControlSurface } from "./contracts";

const NOW = new Date("2026-10-15T15:00:00Z");
const loader = vi.fn(async (c: string, a: string) => fixtureBrief(c, a, NOW) ?? { error: "not_found" });
const base = { onStudy: vi.fn(), onAsk: vi.fn(), onOpenUrl: vi.fn(), loadBrief: loader, now: NOW, enrichEnabled: false };

function surface(overrides: Partial<MissionControlSurface> = {}): MissionControlSurface {
  return { ...fixtureMissionControl(NOW), ...overrides };
}

function setCompact(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  sessionStorage.clear();
  setCompact(false);
  vi.clearAllMocks();
});
afterEach(() => sessionStorage.clear());

describe("brief islands", () => {
  it("are an accordion, not tabs: one open, keyboard moves between headers only", async () => {
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const headers = screen.getAllByRole("button", { expanded: false }).concat(screen.getAllByRole("button", { expanded: true }));
    expect(headers).toHaveLength(4);
    // A new day: the first island opens by itself.
    const first = screen.getByRole("button", { name: /Midterm 2/ });
    expect(first).toHaveAttribute("aria-expanded", "true");
    const panel = await screen.findByRole("region", { name: /Midterm 2/ });
    expect(first).toHaveAttribute("aria-controls", panel.id);
    expect(await within(panel).findByText("Start a 25-minute practice set in Study")).toBeInTheDocument();

    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Problem Set 4/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^WebAssign 7/ }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^WebAssign 7/ }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /^WebAssign 7/ })).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll(".mc-island-panel")).toHaveLength(1);
    await user.keyboard(" ");
    expect(document.querySelectorAll(".mc-island-panel")).toHaveLength(0);
  });

  it("opens the first island only on a new visit", () => {
    const { unmount } = render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    unmount();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    expect(document.querySelectorAll(".mc-island-panel")).toHaveLength(0);
  });

  it("at a narrow width opens the brief as a sheet and returns focus to its island", async () => {
    setCompact(true);
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    // Never a sheet over the page on load.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const header = screen.getByRole("button", { name: /Problem Set 4/ });
    await user.click(header);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(header);
  });

  it("shows status as text, long titles intact, and routes the rest to Week", async () => {
    const onOpenWeek = vi.fn();
    const user = userEvent.setup();
    const s = surface({ operations: [] });
    s.assignments[3] = { ...s.assignments[3], title: "A very long assignment title ".repeat(8).trim() };
    render(<MissionControlView {...base} surface={s} onOpenWeek={onOpenWeek} />);
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("Needs a source")).toBeInTheDocument();
    expect(screen.getByText(s.assignments[3].title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See the rest in Week (3 more)" }));
    expect(onOpenWeek).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(" · ");
  });

  it("in exam focus mode the other islands are quiet but still open", () => {
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    expect(screen.getByRole("heading", { name: "Today is about this" })).toBeInTheDocument();
    const second = screen.getByRole("button", { name: /Problem Set 4/ });
    expect(second.textContent).not.toContain("Due tomorrow");
  });
});

describe("a brief", () => {
  beforeEach(() => sessionStorage.setItem("mc_first_open_day", surface().today));

  it("labels proposals, keeps provenance, and only offers safe actions", async () => {
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    const panel = await screen.findByRole("region", { name: /Problem Set 4/ });
    await within(panel).findByText(/Prepared .* from Canvas and 1 course material/);
    expect(within(panel).getByText("Suggestion, yours to change")).toBeInTheDocument();
    expect(within(panel).getAllByText("From Canvas").length).toBeGreaterThan(0);
    const labels = within(panel)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    for (const bad of [/submit/i, /post/i, /comment/i, /send/i]) expect(labels.some((l) => bad.test(l))).toBe(false);
    await user.click(within(panel).getByRole("button", { name: "Open in Canvas" }));
    expect(base.onOpenUrl).toHaveBeenCalledWith("https://canvas.example.edu/courses/101/assignments/11");
    expect(BRIEF_ACTION_KINDS).not.toContain("submit");
  });

  it("an exam brief starts Study on that exam", async () => {
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    await user.click(screen.getByRole("button", { name: /Midterm 2/ }));
    await user.click(await screen.findByRole("button", { name: "Start studying" }));
    expect(base.onStudy).toHaveBeenCalledWith("item-a12");
  });

  it("marks an open brief as updated instead of replacing it", async () => {
    const user = userEvent.setup();
    const s = surface({ operations: [] });
    const { rerender } = render(<MissionControlView {...base} surface={s} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    const panel = await screen.findByRole("region", { name: /Problem Set 4/ });
    await within(panel).findByText("Do this next");
    const next = { ...s, assignments: s.assignments.map((a) => (a.assignment_id === "a11" ? { ...a, source_fingerprint: "fp-new" } : a)) };
    rerender(<MissionControlView {...base} surface={next} />);
    expect(within(panel).getByText(/Updated since this brief was prepared/)).toBeInTheDocument();
    expect(within(panel).getByText("Do this next")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
    await user.click(within(panel).getByRole("button", { name: "Show the updated brief" }));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("offers an update when the reason changed and the fingerprint did not", async () => {
    const user = userEvent.setup();
    const s = surface({ operations: [] });
    const { rerender } = render(<MissionControlView {...base} surface={s} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    const panel = await screen.findByRole("region", { name: /Problem Set 4/ });
    await within(panel).findByText("Do this next");
    const next = {
      ...s,
      assignments: s.assignments.map((a) => (a.assignment_id === "a11" ? { ...a, priority_reason: "Due today" } : a)),
    };
    rerender(<MissionControlView {...base} surface={next} />);
    expect(within(panel).getByText(/Updated since this brief was prepared/)).toBeInTheDocument();
    expect(within(panel).getByText("Do this next")).toBeInTheDocument();
  });

  it("retries a brief that failed to load", async () => {
    sessionStorage.setItem("mc_first_open_day", surface().today);
    const user = userEvent.setup();
    const loadBrief = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (c: string, a: string) => fixtureBrief(c, a, NOW) ?? { error: "not_found" });
    render(<MissionControlView {...base} surface={surface({ operations: [] })} loadBrief={loadBrief} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    expect(await screen.findByText(/isn't ready/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    expect(await screen.findByText("Do this next")).toBeInTheDocument();
  });

  it("a malformed brief says the file could not be read", async () => {
    sessionStorage.setItem("mc_first_open_day", surface().today);
    const user = userEvent.setup();
    const loadBrief = vi.fn().mockResolvedValue({ error: "malformed" });
    render(<MissionControlView {...base} surface={surface({ operations: [] })} loadBrief={loadBrief} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    expect(await screen.findByText(/couldn't be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a slower brief response does not replace a newer one", async () => {
    sessionStorage.setItem("mc_first_open_day", surface().today);
    const user = userEvent.setup();
    let resolveFirst: (value: { error: string }) => void = () => undefined;
    const first = new Promise<{ error: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const loadBrief = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async (c: string, a: string) => fixtureBrief(c, a, NOW) ?? { error: "not_found" });
    render(<MissionControlView {...base} surface={surface({ operations: [] })} loadBrief={loadBrief} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    expect(await screen.findByText("Opening the brief…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    expect(await screen.findByText("Do this next")).toBeInTheDocument();
    await act(async () => {
      resolveFirst({ error: "not_found" });
      await Promise.resolve();
    });
    expect(screen.getByText("Do this next")).toBeInTheDocument();
    expect(screen.queryByText(/isn't ready/)).not.toBeInTheDocument();
  });

  it("records one-tap feedback locally", async () => {
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    await user.click(screen.getByRole("button", { name: /Problem Set 4/ }));
    await user.click(await screen.findByRole("button", { name: "Not specific enough" }));
    expect(screen.getByText("Thanks. Saved on this Mac only.")).toBeInTheDocument();
  });
});

describe("operations islands", () => {
  beforeEach(() => sessionStorage.setItem("mc_first_open_day", surface().today));

  it("appear only when there is something to review", () => {
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    expect(screen.queryByRole("list", { name: "To review" })).not.toBeInTheDocument();
  });

  it("calendar: no write without a connected calendar and an explicit yes on a token bound to the fields", async () => {
    const user = userEvent.setup();
    const s = surface();
    render(<MissionControlView {...base} surface={s} />);
    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    expect(screen.getByRole("button", { name: "Add to calendar" })).toBeDisabled();

    const connected = surface();
    connected.operations[0] = { ...connected.operations[0], action: { ...connected.operations[0].action, availability: "available" } };
    gcal.preview.mockResolvedValueOnce({ confirmation_token: "tok-1", executable: true, preview: {}, note: "" });
    gcal.confirm.mockResolvedValueOnce({ created: { id: "e1" } });
    const view = render(<MissionControlView {...base} surface={connected} />);
    const island = within(view.container);
    await user.click(island.getByRole("button", { name: /Calendar/ }));
    await user.click(island.getByRole("button", { name: "Add to calendar" }));
    expect(gcal.confirm).not.toHaveBeenCalled();
    const sheet = await screen.findByRole("dialog", { name: "Add this to your calendar?" });
    await user.click(within(sheet).getByRole("button", { name: "Yes, add it" }));
    const p = connected.operations[0].calendar!;
    expect(gcal.confirm).toHaveBeenCalledWith(p.summary, p.start, p.end, p.why, "tok-1");
    expect(await screen.findByText("Added to your Google Calendar.")).toBeInTheDocument();
  });

  it("calendar: a preview that can't execute never shows a confirm step", async () => {
    const user = userEvent.setup();
    const s = surface();
    s.operations[0] = { ...s.operations[0], action: { ...s.operations[0].action, availability: "available" } };
    gcal.preview.mockResolvedValueOnce({ confirmation_token: "t", executable: false, preview: {}, note: "" });
    render(<MissionControlView {...base} surface={s} />);
    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    await user.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(await screen.findByText(/isn't connected/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("email: a draft reviews exactly, and there is no Send button on this device", async () => {
    const user = userEvent.setup();
    const draft = { draft_id: "d0000000000000001", status: "draft", intent: "", to: ["instructor@example.edu"], subject: "Office hours", body: "Hi,\nCan I come Thursday?", evidence: [{ id: "m1", subject: "MATH 1300: office hours moved to Thursday", kind: "email" }], connector: "outlook", created_at: "", updated_at: "" };
    drafts.create.mockResolvedValueOnce({ draft });
    drafts.review.mockResolvedValueOnce({ draft: { ...draft, status: "reviewed" }, fingerprint: "f", send: { available: false, reason: "Sending is not connected on this device" } });
    render(<MissionControlView {...base} surface={surface()} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.click(screen.getByRole("button", { name: "Reply to this" }));
    await user.type(screen.getByLabelText("To"), "instructor@example.edu");
    await user.type(screen.getByLabelText("Subject"), "Office hours");
    await user.type(screen.getByLabelText("Message"), "Hi,");
    await user.click(screen.getByRole("button", { name: "Review draft" }));
    const review = await screen.findByRole("region", { name: "Exactly what would be sent" });
    expect(review).toHaveTextContent("instructor@example.edu");
    expect(review).toHaveTextContent("MATH 1300: office hours moved to Thursday");
    expect(review).toHaveTextContent("Sending is not connected on this device");
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(drafts.create).toHaveBeenCalledWith(expect.objectContaining({ evidence: [{ id: "m1", subject: "MATH 1300: office hours moved to Thursday" }] }));
    // Editing anything leaves review.
    await user.type(screen.getByLabelText("Subject"), "!");
    expect(screen.queryByRole("region", { name: "Exactly what would be sent" })).not.toBeInTheDocument();
  });
});

describe("calibration", () => {
  it("is optional, two questions, and only reorders", async () => {
    sessionStorage.setItem("mc_first_open_day", surface().today);
    const user = userEvent.setup();
    render(<MissionControlView {...base} surface={surface({ operations: [] })} />);
    await screen.findByRole("heading", { name: /paper brief/ });
    await user.click(screen.getByRole("button", { name: "A starting outline" }));
    await screen.findByRole("heading", { name: /problem set brief/ });
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Skip" }));
    });
    expect(screen.queryByRole("heading", { name: /problem set brief/ })).not.toBeInTheDocument();
  });
});
