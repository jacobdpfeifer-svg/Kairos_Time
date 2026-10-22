import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPEC } from "./contracts";
import { WorkspaceAmendment } from "./WorkspaceAmendment";

const sendNotification = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  sendNotification: (...args: unknown[]) => sendNotification(...args),
}));

vi.mock("../ipc", () => ({
  isTauri: () => true,
  readWorkspaceUsage: vi.fn().mockResolvedValue(null),
  readWorkspaceAmendments: vi.fn(),
  writeWorkspaceAmendments: vi.fn(async () => undefined),
  writeAcceptedSpec: vi.fn(async (spec: unknown) => spec),
  recordWorkspaceUsage: vi.fn(),
}));

vi.mock("./store", () => ({
  loadWorkspace: vi.fn(async () => undefined),
}));

import { writeAcceptedSpec, writeWorkspaceAmendments } from "../ipc";

const pending = {
  kind: "home" as const,
  fingerprint: "home:week",
  rationale: "You've opened Week first 9 of the last 10 days. Make Week your home screen?",
  surface: "week" as const,
  proposed_on: "2026-10-21",
  patches: [{ op: "set_home" as const, home: "week" as const }],
};

const ledger = {
  schema_version: 1 as const,
  pending,
  last_proposed_on: "2026-10-21",
  dismissed: [] as string[],
  stopped_kinds: [] as string[],
};

describe("workspace amendment row", () => {
  beforeEach(() => {
    sendNotification.mockClear();
    vi.mocked(writeAcceptedSpec).mockClear();
    vi.mocked(writeWorkspaceAmendments).mockClear();
    vi.mocked(writeWorkspaceAmendments).mockResolvedValue(undefined);
  });

  it("writes the accepted spec on yes and does not notify", async () => {
    const user = userEvent.setup();
    const { readWorkspaceAmendments } = await import("../ipc");
    vi.mocked(readWorkspaceAmendments).mockResolvedValue(ledger);
    render(<WorkspaceAmendment spec={DEFAULT_SPEC} surface="week" />);
    expect(await screen.findByRole("group", { name: "Workspace suggestion" })).toHaveTextContent("Make Week your home screen?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(writeAcceptedSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        home: "week",
        status: "accepted",
        accepted_by: "student",
        origin: expect.objectContaining({ kind: "amendment" }),
      }),
    );
    expect(writeWorkspaceAmendments).toHaveBeenCalledWith(expect.objectContaining({ pending: null, dismissed: [], stopped_kinds: [] }));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Workspace suggestion" })).not.toBeInTheDocument();
  });

  it("remembers a no, and a stop, without writing the workspace", async () => {
    const user = userEvent.setup();
    const { readWorkspaceAmendments } = await import("../ipc");
    vi.mocked(readWorkspaceAmendments).mockResolvedValue(ledger);
    const { unmount } = render(<WorkspaceAmendment spec={DEFAULT_SPEC} surface="week" />);
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(writeAcceptedSpec).not.toHaveBeenCalled();
    expect(writeWorkspaceAmendments).toHaveBeenCalledWith(expect.objectContaining({ pending: null, dismissed: ["home:week"] }));
    unmount();

    vi.mocked(writeWorkspaceAmendments).mockClear();
    vi.mocked(readWorkspaceAmendments).mockResolvedValue(ledger);
    render(<WorkspaceAmendment spec={DEFAULT_SPEC} surface="week" />);
    await user.click(await screen.findByRole("button", { name: "Stop suggesting this" }));
    expect(writeAcceptedSpec).not.toHaveBeenCalled();
    expect(writeWorkspaceAmendments).toHaveBeenCalledWith(expect.objectContaining({ pending: null, stopped_kinds: ["home"] }));
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
