// Purpose: tests command bar search
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBar, score, type Command } from "./CommandBar";

const make = (over: Partial<Command> & { id: string; label: string }): Command => ({ group: "Do", run: vi.fn(), ...over });

describe("CommandBar", () => {
  beforeEach(() => localStorage.clear());

  it("shows actions with their keys, and ? lists only shortcuts", async () => {
    const user = userEvent.setup();
    const cmds = [make({ id: "a", label: "Ask Kairos", keys: "⌘J" }), make({ id: "s", label: "Sync Canvas now" })];
    render(<CommandBar commands={cmds} onClose={() => undefined} onAsk={() => undefined} />);
    expect(screen.getByRole("option", { name: /Ask Kairos ⌘J/ })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox"), "?");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("runs the highlighted row with arrows and Enter, and remembers it as recent", async () => {
    const user = userEvent.setup();
    const sync = make({ id: "s", label: "Sync Canvas now" });
    const onClose = vi.fn();
    const { unmount } = render(<CommandBar commands={[make({ id: "a", label: "Ask Kairos" }), sync]} onClose={onClose} onAsk={() => undefined} />);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(sync.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    unmount();
    render(<CommandBar commands={[make({ id: "a", label: "Ask Kairos" }), sync]} onClose={() => undefined} onAsk={() => undefined} />);
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Sync Canvas now");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandBar commands={[]} onClose={onClose} onAsk={() => undefined} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("groups more than 30 items by course", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 32 }, (_, i) =>
      make({ id: `i${i}`, group: "Go to", label: `Homework ${i}`, course: i % 2 ? "MATH 1300" : "CSCI 1300" })
    );
    render(<CommandBar commands={items} onClose={() => undefined} onAsk={() => undefined} />);
    await user.type(screen.getByRole("combobox"), "homework");
    expect(screen.getByRole("group", { name: "MATH 1300" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "CSCI 1300" })).toBeInTheDocument();
  });
});

describe("score", () => {
  it("prefers a prefix, then a word start, then letters in order", () => {
    expect(score("sync", "Sync Canvas now")).toBeGreaterThan(score("canvas", "Sync Canvas now"));
    expect(score("canvas", "Sync Canvas now")).toBeGreaterThan(score("scn", "Sync Canvas now"));
    expect(score("zzz", "Sync Canvas now")).toBe(0);
  });
});
