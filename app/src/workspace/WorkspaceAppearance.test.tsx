import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPEC } from "./contracts";
import type { WorkspaceState } from "./store";
import { WorkspaceAppearance, workspaceLine } from "./WorkspaceAppearance";

const saved: WorkspaceState = {
  spec: { ...DEFAULT_SPEC, name: "Calm daily focus", accepted_at: "2026-10-21T16:00:00.000Z", authorship: { student_edits: 0 } },
  notice: null,
  fromDisk: true,
  history: [{ ts: "1000000000000", name: "Kairos" }],
  loaded: true,
};

describe("WorkspaceAppearance", () => {
  it("names the saved workspace and reverts to the previous one", async () => {
    const onRevert = vi.fn();
    render(<WorkspaceAppearance state={saved} onRevert={onRevert} />);
    expect(screen.getByText(/Your workspace, Calm daily focus, was built/)).toBeInTheDocument();
    expect(screen.getByText(/with no edits/)).toBeInTheDocument();
    expect(screen.getByText(/Kairos/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Revert to Kairos" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Revert" }));
    expect(onRevert).toHaveBeenCalledWith("1000000000000");
  });

  it("shows one sentence when a spec was rejected", () => {
    render(
      <WorkspaceAppearance
        state={{ spec: DEFAULT_SPEC, notice: "Kairos kept your previous workspace because the new one didn't check out.", fromDisk: false, history: [], loaded: true }}
        onRevert={() => undefined}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/kept your previous workspace/);
    expect(screen.queryByRole("button", { name: "Revert" })).not.toBeInTheDocument();
  });

  it("says nothing when the student is still on the standard layout", () => {
    const { container } = render(
      <WorkspaceAppearance state={{ spec: DEFAULT_SPEC, notice: null, fromDisk: false, history: [], loaded: true }} onRevert={() => undefined} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(workspaceLine(DEFAULT_SPEC)).toMatch(/Kairos/);
  });
});
