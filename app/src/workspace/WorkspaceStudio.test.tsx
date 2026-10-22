import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceCapability } from "./catalog";
import { WORKSPACE_CAPABILITIES } from "./catalog";
import type { WorkspaceSpec } from "./contracts";
import { REPLAY_MS, cloneSpec, patchesFromSpec, type ProposedWorkspace } from "./patch";
import { WorkspaceStudio } from "./WorkspaceStudio";

vi.mock("../ipc", () => ({
  writeAcceptedSpec: vi.fn(async (spec: unknown) => spec),
  writeProposedWorkspace: vi.fn(async () => undefined),
  discardProposedWorkspace: vi.fn(async () => undefined),
  readProposedWorkspace: vi.fn(async () => null),
}));

vi.mock("./store", () => ({
  loadWorkspace: vi.fn(async () => undefined),
}));

import { discardProposedWorkspace, writeAcceptedSpec, writeProposedWorkspace } from "../ipc";

const note: WorkspaceCapability = {
  id: "today.note",
  label: "A margin note",
  blurb: "A second block on Today.",
  surfaces: ["today"],
  component: "TodayView",
  sizes: ["full"],
  props: {},
  supports: [],
  requires: [],
  max_instances: 1,
  availability: "available",
  tier: "local",
  weight: 11,
};

const calendar: WorkspaceCapability = {
  id: "calendar.read",
  label: "Calendar",
  blurb: "Dates beside your week.",
  surfaces: ["today"],
  component: "TodayView",
  sizes: ["full"],
  props: {},
  supports: [],
  requires: [],
  max_instances: 1,
  availability: "optional_connector",
  tier: "local",
  weight: 1,
};

const caps = [...WORKSPACE_CAPABILITIES, note];
const full = { size: "full" as const, props: {}, visible_when: "always" };

function desk(slots: string[], blocks: WorkspaceSpec["blocks"]): WorkspaceSpec {
  return {
    schema_version: 1,
    status: "proposed",
    name: "Desk",
    density: "comfortable",
    surfaces: { today: { slots }, week: { slots: [] }, courses: { slots: [] }, study: { slots: [] }, advisor: { slots: [] } },
    blocks,
  };
}

function proposal(spec: WorkspaceSpec, extra: Partial<ProposedWorkspace> = {}): ProposedWorkspace {
  const baseline = extra.baseline ?? cloneSpec(spec);
  return {
    spec: extra.spec ?? cloneSpec(baseline),
    baseline,
    patches: extra.patches ?? patchesFromSpec(baseline),
    rationale: extra.rationale ?? { b1: "You said you lose track after Sunday." },
    nudge_shown: extra.nudge_shown ?? false,
  };
}

function acceptedFrom(spec: WorkspaceSpec): WorkspaceSpec {
  return { ...cloneSpec(spec), status: "accepted", accepted_by: "student" };
}

const two = desk(["b1", "b2"], {
  b1: { capability: "today.next_action", ...full },
  b2: { capability: "today.note", ...full },
});

describe("WorkspaceStudio replay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the compiler narration for the block that just landed", () => {
    const heard: Array<string | null> = [];
    const patches = patchesFromSpec(two).map((patch) =>
      patch.op === "place" && patch.block_id === "b1" ? { ...patch, narration: "One clear next action is here because you asked for one next step." } : patch,
    );
    render(
      <WorkspaceStudio
        accepted={acceptedFrom(two)}
        proposal={proposal(two, { patches })}
        capabilities={caps}
        reducedMotion={false}
        onClose={() => undefined}
        onPlaybackNarration={(line) => heard.push(line)}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(REPLAY_MS);
    });
    expect(heard).toContain("One clear next action is here because you asked for one next step.");
  });

  it("lands one block at a time", () => {
    const view = render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion={false} onClose={() => undefined} />);
    expect(screen.queryByText("One clear next action")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(REPLAY_MS);
    });
    expect(screen.getByText("One clear next action")).toBeInTheDocument();
    expect(screen.getByText("Today, with the next thing to start and what changed in Canvas.")).toBeInTheDocument();
    expect(screen.queryByText("A margin note")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(REPLAY_MS);
    });
    expect(screen.getByText("A margin note")).toBeInTheDocument();
    view.unmount();
  });

  it("Skip shows the finished spec and stops the stream", () => {
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion={false} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("One clear next action")).toBeInTheDocument();
    expect(screen.getByText("A margin note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(REPLAY_MS * 4);
    });
    expect(screen.getAllByText("A margin note")).toHaveLength(1);
  });
});

describe("WorkspaceStudio editing", () => {
  beforeEach(() => {
    vi.mocked(writeAcceptedSpec).mockClear();
    vi.mocked(writeProposedWorkspace).mockClear();
    vi.mocked(discardProposedWorkspace).mockClear();
  });

  it("shows the finished spec and its rationale when motion is reduced", () => {
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    expect(screen.getByText("One clear next action")).toBeInTheDocument();
    expect(screen.getByText("Today, with the next thing to start and what changed in Canvas.")).toBeInTheDocument();
    expect(screen.getByText("You said you lose track after Sunday.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });

  it("nudges once when nothing was moved, then accepts with zero edits", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.getByRole("status")).toHaveTextContent("Move one thing so it's yours.");
    expect(writeAcceptedSpec).not.toHaveBeenCalled();
    expect(writeProposedWorkspace).toHaveBeenCalledWith(expect.objectContaining({ nudge_shown: true }));
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(writeAcceptedSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        accepted_by: "student",
        authorship: expect.objectContaining({ student_edits: 0 }),
      }),
    );
    expect(discardProposedWorkspace).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("accepts on the first click when the nudge was already shown", async () => {
    const user = userEvent.setup();
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two, { nudge_shown: true })} capabilities={caps} reducedMotion onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.queryByText("Move one thing so it's yours.")).not.toBeInTheDocument();
    expect(writeAcceptedSpec).toHaveBeenCalledWith(expect.objectContaining({ authorship: expect.objectContaining({ student_edits: 0 }) }));
  });

  it("counts a reorder as an edit and skips the nudge", async () => {
    const user = userEvent.setup();
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Move down One clear next action" }));
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.queryByText("Move one thing so it's yours.")).not.toBeInTheDocument();
    expect(writeAcceptedSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        accepted_by: "student",
        origin: expect.objectContaining({ kind: "edit" }),
        authorship: expect.objectContaining({ student_edits: 1 }),
      }),
    );
  });

  it("adds to the edits already on the workspace instead of replacing the count", async () => {
    const user = userEvent.setup();
    const earlier = cloneSpec(two);
    earlier.authorship = { student_edits: 3, renamed: true, last_edited_at: "2026-10-14T09:00:00.000Z" };
    render(<WorkspaceStudio accepted={acceptedFrom(earlier)} proposal={proposal(earlier)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Move down One clear next action" }));
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(writeAcceptedSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        authorship: expect.objectContaining({ student_edits: 4, renamed: true }),
      }),
    );
  });

  it("moves focus between blocks with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    const items = screen.getAllByRole("listitem");
    expect(screen.getByRole("button", { name: "Move up One clear next action" })).toBeInTheDocument();
    items[1].focus();
    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();
  });

  it("says what Today gains, loses, and reorders", () => {
    const onlyNext = desk(["b1"], { b1: { capability: "today.next_action", ...full } });
    const onlyNote = desk(["b2"], { b2: { capability: "today.note", ...full } });
    const { unmount } = render(
      <WorkspaceStudio accepted={acceptedFrom(onlyNext)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={() => undefined} />,
    );
    expect(screen.getByText("Today gains A margin note.")).toBeInTheDocument();
    unmount();

    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(onlyNext)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    expect(screen.getByText("Today loses A margin note.")).toBeInTheDocument();
    unmount();

    render(<WorkspaceStudio accepted={acceptedFrom(onlyNext)} proposal={proposal(onlyNote)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    expect(screen.getByText("Today gains A margin note, loses One clear next action.")).toBeInTheDocument();
    unmount();

    const swapped = desk(["b2", "b1"], two.blocks);
    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(swapped)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    expect(screen.getByText("Today is in a different order.")).toBeInTheDocument();
  });

  it("does not treat a tool outside the registry as a connector", () => {
    const spec = desk(["b1"], { b1: { capability: "calendar.read", ...full } });
    render(
      <WorkspaceStudio
        accepted={acceptedFrom(desk([], {}))}
        proposal={proposal(spec)}
        capabilities={[calendar]}
        reducedMotion
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.queryByText("Requested")).not.toBeInTheDocument();
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/oauth/i)).not.toBeInTheDocument();
  });

  it("shows a reviewed connector as not available and still offers no connect button", () => {
    const campus: WorkspaceCapability = {
      ...calendar,
      id: "campusgroups",
      label: "Campus groups",
    };
    const spec = desk(["b1"], { b1: { capability: "campusgroups", ...full } });
    render(
      <WorkspaceStudio
        accepted={acceptedFrom(desk([], {}))}
        proposal={proposal(spec)}
        capabilities={[campus]}
        reducedMotion
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/oauth/i)).not.toBeInTheDocument();
  });

  it("keeps the current workspace when asked, and start over drops the edit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Keep what I have" }));
    expect(discardProposedWorkspace).toHaveBeenCalled();
    expect(writeAcceptedSpec).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    render(<WorkspaceStudio accepted={acceptedFrom(two)} proposal={proposal(two)} capabilities={caps} reducedMotion onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Move down One clear next action" }));
    expect(screen.getByText("Today is in a different order.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByText("Today is in a different order.")).not.toBeInTheDocument();
  });
});
