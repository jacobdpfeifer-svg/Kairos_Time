import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmSheet } from "./ConfirmSheet";

describe("ConfirmSheet", () => {
  it("keeps a typed confirmation disabled until the name matches", async () => {
    const user = userEvent.setup();
    const onYes = vi.fn();
    render(
      <ConfirmSheet title="Switch to studio?" yes="Switch profile" match="studio" onYes={onYes} onNo={() => undefined}>
        <p>This leaves home and opens studio.</p>
      </ConfirmSheet>
    );
    const yes = screen.getByRole("button", { name: "Switch profile" });
    expect(yes).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Type studio to continue" }), "  studio  ");
    expect(yes).toBeEnabled();
    await user.click(yes);
    expect(onYes).toHaveBeenCalledOnce();
  });
});
