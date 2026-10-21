// Purpose: tests the voice session sheet
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VoiceSheet } from "./VoiceSheet";
import { voicePresence, withCourseColors } from "../voice/presence";

beforeAll(() => {
  // jsdom has no canvas; the ink ring must cope with a null context
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  act(() => voicePresence.reset());
  voicePresence.onStop(null);
  delete document.documentElement.dataset.motion;
});

describe("VoiceSheet", () => {
  it("stays hidden until the voice model starts a session", () => {
    render(<VoiceSheet />);
    expect(screen.queryByRole("complementary", { name: "Voice" })).toBeNull();
    act(() => voicePresence.set({ state: "listening", transcript: "What's due Friday?" }));
    expect(screen.getByRole("complementary", { name: "Voice" })).toBeInTheDocument();
    expect(screen.getByText("Listening…")).toBeInTheDocument();
    expect(screen.getByText("What's due Friday?")).toBeInTheDocument();
  });

  it("names the work while thinking and offers Stop only when the voice model can stop", async () => {
    const user = userEvent.setup();
    render(<VoiceSheet />);
    act(() => voicePresence.set({ state: "thinking", status: "Checking your week" }));
    expect(screen.getByText("Checking your week")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();

    const stop = vi.fn();
    voicePresence.onStop(stop);
    act(() => voicePresence.set({ state: "listening" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(voicePresence.get().state).toBe("idle");
  });

  it("gives screen readers every answer line in full", () => {
    render(<VoiceSheet />);
    act(() =>
      voicePresence.set({
        state: "speaking",
        reply: "Two things.",
        items: [
          { title: "CSCI 2270 lab 4", due: "Thu 11:59 pm" },
          { title: "PHYS 1110 set 5", due: "Fri 9:00 am" },
        ],
      }),
    );
    const list = screen.getByRole("list", { name: "Answer" });
    expect(list).toHaveTextContent("CSCI 2270 lab 4, Thu 11:59 pm");
    expect(list).toHaveTextContent("PHYS 1110 set 5, Fri 9:00 am");
  });

  it("reduced motion shows the whole answer at once", () => {
    document.documentElement.dataset.motion = "reduced";
    render(<VoiceSheet />);
    act(() => voicePresence.set({ state: "speaking", items: [{ title: "Read ch. 3" }] }));
    const line = document.querySelector(".voice-line");
    expect(line?.textContent).toBe("Read ch. 3");
  });

  it("stays open after the session ends until the student closes it", async () => {
    const user = userEvent.setup();
    render(<VoiceSheet />);
    act(() => voicePresence.set({ state: "error", error: "The microphone was disconnected." }));
    expect(screen.getByText("The microphone was disconnected.")).toBeInTheDocument();
    act(() => voicePresence.set({ state: "idle" }));
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Voice" })).toBeNull();
  });

  it("shows the ink ring as decoration only, never a character to poke", () => {
    render(<VoiceSheet />);
    act(() => voicePresence.set({ state: "listening" }));
    expect(document.querySelector(".ink-ring")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: /Blot/ })).toBeNull();
  });
});

describe("voice presence", () => {
  it("a new turn clears the last answer", () => {
    voicePresence.set({ state: "speaking", reply: "x", items: [{ title: "a" }] });
    voicePresence.set({ state: "listening" });
    expect(voicePresence.get()).toMatchObject({ reply: "", items: [], transcript: "" });
  });

  it("clamps the level", () => {
    voicePresence.setLevel(4);
    expect(voicePresence.level).toBe(1);
    voicePresence.setLevel(Number.NaN);
    expect(voicePresence.level).toBe(0);
  });

  it("fills item colours from Canvas course colours without overriding explicit ones", () => {
    const out = withCourseColors(
      [{ title: "a", courseId: "101" }, { title: "b", courseId: "202", color: "#000000" }, { title: "c" }],
      { "101": "#e1ad49", "202": "#ff604d" },
    );
    expect(out.map((i) => i.color)).toEqual(["#e1ad49", "#000000", undefined]);
  });
});
