// Purpose: tests theme and study chrome
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LetterFlip } from "../components/LetterFlip";
import { applyTheme, useTheme } from "../theme";
import { transport } from "../study/api";
import { makeFakeStudy } from "../test/fakeStudy";
import { StudyView } from "../views/StudyView";

function ThemeHarness() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("paper")}>
      Paper
    </button>
  );
}

describe("Spatial Instrument chrome", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.dataset.theme = "night";
    document.documentElement.dataset.motion = "auto";
  });

  it("keeps Continue a disabled primary until a school is found and the terms are accepted", async () => {
    const { FirstRun } = await import("../components/FirstRun");
    render(<FirstRun onDone={() => undefined} />);
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();
    expect(continueBtn).toHaveClass("primary");
  });

  it("lets 5 / 10 min segmented change session length", async () => {
    const fake = makeFakeStudy();
    vi.spyOn(transport, "send").mockImplementation(fake.send);
    const user = userEvent.setup();
    render(<StudyView onGoToSources={() => undefined} />);
    await screen.findByRole("heading", { name: "One check" });
    await user.click(screen.getByLabelText("10 min"));
    expect((screen.getByLabelText("10 min") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Answer now" }));
    expect(fake.calls.find((c) => c.cmd === "start")?.params.minutes).toBe(10);
  });

  it("applies theme data attributes", async () => {
    const user = userEvent.setup();
    render(<ThemeHarness />);
    await user.click(screen.getByRole("button", { name: "Paper" }));
    expect(document.documentElement.dataset.theme).toBe("paper");
    applyTheme("forest", "auto");
    expect(document.documentElement.dataset.theme).toBe("forest");
  });

  it("renders an outcome as still text", () => {
    applyTheme("night", "reduced");
    const { container } = render(<LetterFlip text="Study" />);
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(container.querySelector("[data-letter-flip]")).toHaveTextContent("Study");
    expect(container.querySelectorAll(".letter-flip-char")).toHaveLength(0);
  });

  it("shows now-playing during an attempt", async () => {
    const fake = makeFakeStudy();
    vi.spyOn(transport, "send").mockImplementation(fake.send);
    const user = userEvent.setup();
    render(<StudyView onGoToSources={() => undefined} />);
    await screen.findByRole("heading", { name: "One check" });
    await user.click(screen.getByRole("button", { name: "Answer now" }));
    expect(await screen.findByLabelText("Stop")).toBeInTheDocument();
    expect(document.querySelector("[data-now-playing]")).toBeTruthy();
  });
});
