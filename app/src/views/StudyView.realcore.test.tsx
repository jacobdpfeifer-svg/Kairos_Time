// Purpose: study view against python core
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transport } from "../study/api";
import { makeRealCore, pythonPath } from "../test/realCore";
import { StudyView } from "./StudyView";

const python = pythonPath();

describe.skipIf(!python)("StudyView against the real Python core", () => {
  let core: ReturnType<typeof makeRealCore>;
  beforeEach(() => {
    core = makeRealCore(python!);
    vi.spyOn(transport, "send").mockImplementation(core.send);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    core.cleanup();
  });

  it("imports a bundled packet, answers, and persists a resumable draft across remounts", async () => {
    const user = userEvent.setup();
    const imported = await core.send("import-template", { packet_id: "Q" });
    expect(imported.ok).toBe(true);
    const view = render(<StudyView onGoToSources={() => undefined} />);
    await screen.findByRole("heading", { name: "One check" });
    await user.click(screen.getByRole("button", { name: "Answer now" }));
    await user.type(await screen.findByLabelText("Inner function"), "sin x");
    await waitFor(() => expect(screen.getByText(/^Saved/)).toBeInTheDocument(), { timeout: 5000 });
    view.unmount();
    render(<StudyView onGoToSources={() => undefined} />);
    expect(await screen.findByText(/A saved draft from/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Answer now" }));
    expect(await screen.findByLabelText("Inner function")).toHaveValue("sin x");
    await user.type(screen.getByLabelText("Derivative y′"), "4sin^3x cosx");
    await user.click(screen.getByRole("button", { name: "Check my answer" }));
    await screen.findByRole("heading", { name: /Correct/ });
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    const status = await core.send("status", {});
    expect((status as unknown as { items: { active: number } }).items.active).toBe(2);
    const events = await core.send("history", { item_id: "Q-1" });
    const attempts = (events as unknown as { attempts: { status: string; evidence: string }[] }).attempts;
    expect(attempts[0].status).toBe("assessed");
    expect(attempts[0].evidence).toBe("baseline_response");
  }, 30000);
});
