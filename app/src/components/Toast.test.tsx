import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { advanceToast, offerToast, Toast } from "./Toast";
import { EXIT_FALLBACK_MS, useExit } from "../motion";

/**
 * An inline transition-duration is the one thing jsdom resolves, so the exit
 * state machine can be driven for real here rather than short-circuited.
 */
function ExitHarness({ body, onClosed }: { body: string; onClosed: () => void }) {
  const exit = useExit(onClosed);
  return (
    <div
      ref={(el) => {
        exit.node.current = el;
      }}
      data-testid="sheet"
      data-phase={exit.phase}
      style={{ transitionDuration: "200ms" }}
      onTransitionEnd={exit.onTransitionEnd}
    >
      {body}
      <button type="button" onClick={exit.requestClose}>
        close
      </button>
      <button type="button" onClick={exit.reopen}>
        reopen
      </button>
    </div>
  );
}

/** jsdom's TransitionEvent drops propertyName, which useExit filters on. */
function endTransition(el: HTMLElement, propertyName: string) {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(el, event);
}

describe("useExit", () => {
  it("keeps the node mounted through its exit, and reports it once", async () => {
    const user = userEvent.setup();
    let closed = 0;
    render(<ExitHarness body="first" onClosed={() => closed++} />);
    const sheet = screen.getByTestId("sheet");
    expect(sheet.dataset.phase).toBe("open");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(sheet.dataset.phase).toBe("closed");
    expect(closed).toBe(0);
    endTransition(sheet, "opacity");
    expect(closed).toBe(1);
    // A second end event for the same exit is not a second close.
    endTransition(sheet, "transform");
    expect(closed).toBe(1);
  });

  it("re-opens for the next thing to say, and can still close after that", async () => {
    const user = userEvent.setup();
    let closed = 0;
    render(<ExitHarness body="first" onClosed={() => closed++} />);
    const sheet = screen.getByTestId("sheet");
    // The first one leaves completely.
    await user.click(screen.getByRole("button", { name: "close" }));
    endTransition(sheet, "opacity");
    expect(closed).toBe(1);
    // The same node now carries the next one.
    await user.click(screen.getByRole("button", { name: "reopen" }));
    expect(sheet.dataset.phase).toBe("open");
    // And it has to be able to leave too: one that cannot close again would sit
    // on the page for the rest of the session.
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(sheet.dataset.phase).toBe("closed");
    endTransition(sheet, "opacity");
    expect(closed).toBe(2);
  });

  it("closes on its own if the transition never ends", async () => {
    vi.useFakeTimers();
    try {
      let closed = 0;
      render(<ExitHarness body="first" onClosed={() => closed++} />);
      fireEvent.click(screen.getByRole("button", { name: "close" }));
      expect(closed).toBe(0);
      act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS + 1));
      expect(closed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("offerToast", () => {
  const undo = () => undefined;
  it("keeps a live undo and lets the next toast wait", () => {
    const first = offerToast({ current: null, waiting: null }, { message: "Marked done.", undo, id: 1 });
    const held = offerToast(first, { message: "Moved.", undo, id: 2 });
    expect(held.current?.id).toBe(1);
    expect(held.waiting?.id).toBe(2);
    const next = advanceToast(held);
    expect(next.current?.id).toBe(2);
    expect(next.waiting).toBeNull();
  });

  it("replaces a toast that has no undo", () => {
    const first = offerToast({ current: null, waiting: null }, { message: "Syncing with Canvas…" });
    const next = offerToast(first, { message: "Synced with Canvas." });
    expect(next.current?.message).toBe("Synced with Canvas.");
    expect(next.waiting).toBeNull();
  });

  it("does not replace a waiting undo", () => {
    const live = { current: { message: "Marked done.", undo, id: 1 }, waiting: { message: "Moved.", undo, id: 2 } };
    const held = offerToast(live, { message: "Synced with Canvas.", id: 3 });
    expect(held.waiting?.id).toBe(2);
  });
});

describe("Toast", () => {
  it("runs undo once and then leaves", async () => {
    const user = userEvent.setup();
    let undone = 0;
    let done = 0;
    render(<Toast toast={{ message: "Moved.", undo: () => void undone++, id: 3 }} onDone={() => done++} />);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undone).toBe(1);
    expect(done).toBe(1);
  });
});
