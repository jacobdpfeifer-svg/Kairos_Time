// Purpose: Settings "What to weigh" submits only the lines the student filled.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  saveAims: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../study/api", () => ({
  advisorWrites: { profileFields: vi.fn() },
  aiStudy: { status: vi.fn().mockResolvedValue(null) },
  listProfiles: vi.fn().mockResolvedValue(null),
  runtimeInfo: vi.fn().mockResolvedValue(null),
  setProfile: vi.fn(),
  study: { status: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../prefs", () => ({
  savePrefs: vi.fn(),
  usePrefs: () => [{ keepRunning: false, notifications: false, captureShortcut: false }, vi.fn()],
}));

vi.mock("../workspace/store", () => ({
  useWorkspace: () => ({ spec: null, reload: vi.fn() }),
}));

import { saveAims } from "../ipc";
import { AimsForm } from "./SettingsView";

describe("AimsForm", () => {
  beforeEach(() => {
    vi.mocked(saveAims).mockClear();
  });

  it("sends filled aims and course lines and skips blanks", async () => {
    const user = userEvent.setup();
    render(<AimsForm />);
    await user.type(screen.getByLabelText("First aim"), "Ship a product");
    await user.type(screen.getByLabelText("Third interest"), "Compilers");
    await user.type(screen.getByLabelText("Courses to put first"), "CSCI 1300{enter}{enter}PHYS 1110");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAims).toHaveBeenCalledWith({
      career: ["Ship a product"],
      interest: ["Compilers"],
      worth: ["CSCI 1300", "PHYS 1110"],
      light: [],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. Your week uses it right away.");
  });

  it("does not save when every line is blank", async () => {
    const user = userEvent.setup();
    render(<AimsForm />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAims).not.toHaveBeenCalled();
  });
});
