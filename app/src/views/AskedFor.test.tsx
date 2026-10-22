import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskedFor } from "./AskedFor";
import type { WorkspaceSpec } from "../workspace/contracts";

vi.mock("../ipc", () => ({
  readWorkspaceSpec: vi.fn(),
  readWorkflowDraft: vi.fn(),
  writeAcceptedSpec: vi.fn(async (spec: unknown) => spec),
  writeWorkflowDraft: vi.fn(async () => undefined),
}));

import { readWorkflowDraft, readWorkspaceSpec, writeAcceptedSpec, writeWorkflowDraft } from "../ipc";

const spec: WorkspaceSpec = {
  schema_version: 1,
  status: "accepted" as const,
  accepted_by: "student" as const,
  surfaces: {},
  blocks: {},
  requested_integrations: [
    { name: "Notion", state: "requested" },
    { name: "Google Calendar", state: "requested" },
  ],
};

describe("AskedFor", () => {
  beforeEach(() => {
    vi.mocked(readWorkspaceSpec).mockReset();
    vi.mocked(readWorkflowDraft).mockReset();
    vi.mocked(writeAcceptedSpec).mockClear();
    vi.mocked(writeWorkflowDraft).mockClear();
  });

  it("lists a request and a refusal, with no connect affordance", async () => {
    vi.mocked(readWorkspaceSpec).mockResolvedValue({ spec, notice: null, history: [] });
    vi.mocked(readWorkflowDraft).mockResolvedValue({
      status: "draft",
      requested_integrations: ["WebAssign", "Notion", "CampusGroups"],
    });
    render(<AskedFor />);
    expect(await screen.findByRole("heading", { name: "Asked for" })).toBeInTheDocument();
    expect(screen.getByText("Notion")).toBeInTheDocument();
    expect(screen.getAllByText("Requested")).toHaveLength(3);
    expect(screen.getByText("It would exist only if a maintainer reviews it and ships a connector in an update.")).toBeInTheDocument();
    expect(screen.getByText("WebAssign")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByText("Kairos will not add a connector for this. You use it yourself in the browser.")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar is already in the list above. This note does not start a new connection.")).toBeInTheDocument();
    expect(screen.getByText("CampusGroups")).toBeInTheDocument();
    expect(screen.getByText("A reviewed connector for this already ships with Kairos. This list does not start a connection.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/oauth/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("removes a name from the draft and the accepted spec", async () => {
    vi.mocked(readWorkspaceSpec).mockResolvedValue({ spec, notice: null, history: [] });
    vi.mocked(readWorkflowDraft).mockResolvedValue({
      status: "draft",
      ideal_workflow: "notes",
      requested_integrations: ["Notion", "WebAssign"],
    });
    const user = userEvent.setup();
    render(<AskedFor />);
    await user.click(await screen.findByRole("button", { name: "Remove Notion" }));
    expect(writeWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        requested_integrations: ["WebAssign"],
      }),
    );
    expect(writeAcceptedSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        requested_integrations: [{ name: "Google Calendar", state: "requested" }],
      }),
    );
  });

  it("stays quiet when nothing has been asked for", async () => {
    vi.mocked(readWorkspaceSpec).mockResolvedValue({ spec: null, notice: null, history: [] });
    vi.mocked(readWorkflowDraft).mockResolvedValue(null);
    const { container } = render(<AskedFor />);
    await vi.waitFor(() => expect(readWorkspaceSpec).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading", { name: "Asked for" })).not.toBeInTheDocument();
  });
});
