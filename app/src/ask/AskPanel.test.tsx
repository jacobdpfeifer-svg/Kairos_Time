// Purpose: tests ask mode switching
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { transport } from "../study/api";
import { AskPanel } from "./AskPanel";

describe("AskPanel", () => {
  it("switches modes without re-entering the question", async () => {
    const user = userEvent.setup();
    vi.spyOn(transport, "send").mockImplementation(async (cmd, params) => {
      const mode = cmd === "ask-mode" ? String(params.session_goal) : "answer_now";
      return {
        ok: true,
        input_id: "ask-1",
        ask: { input_id: "ask-1", content: String(params.content ?? ""), session_goal: mode, status: "answered" },
        response: {
          question_type: "solve",
          context_chip: "MATH 1300 · open homework",
          one_sentence: mode === "walkthrough" ? "Use the power rule." : "The derivative is 2x.",
          explanation: "Local plan.",
          assumptions: "Synthetic.",
          check_status: "checked",
          next_action: {
            title: "Use this result",
            why_now: "now",
            value: "",
            urgency: "now",
            consequence: "",
            estimated_effort: "a few minutes",
            dependencies: [],
            risk: "low",
            can_prepare_privately: true,
            student_confirmation_needed: false,
            source_refs: [],
          },
          modes: ["answer_now", "walkthrough", "mastery", "make_handle"],
          prose: "not_generated",
          response_mode: mode,
        },
      };
    });
    render(<AskPanel />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.type(screen.getByRole("textbox"), "Find the derivative of x^2");
    await user.click(screen.getByRole("button", { name: "Get a next step" }));
    expect(await screen.findByRole("heading", { name: "The derivative is 2x." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Walk me through it" }));
    expect(await screen.findByRole("heading", { name: "Use the power rule." })).toBeInTheDocument();
    const create = vi.mocked(transport.send).mock.calls.filter(([cmd]) => cmd === "ask-create");
    expect(create).toHaveLength(1);
    expect(screen.getByText("Prose was not generated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask" })).not.toBeInTheDocument();
  });

  it("sends a session-scoped chip correction", async () => {
    const user = userEvent.setup();
    vi.spyOn(transport, "send").mockImplementation(async (cmd, params) => {
      const course = cmd === "ask-correct" ? String(params.course ?? "") : "MATH 1300";
      return {
        ok: true,
        input_id: "ask-1",
        ask: { input_id: "ask-1", content: "Find the derivative of x^2", session_goal: "answer_now", status: "answered" },
        classification: { job: "solve", boundary: "open_homework", signals: [] },
        context: { course_label: course, assignment_label: "Homework 1", due: "", conflicts: [] },
        response: {
          question_type: "solve",
          context_chip: course ? `${course} · open homework` : "open homework",
          one_sentence: "The derivative is 2x.",
          explanation: "Local plan.",
          assumptions: "Synthetic.",
          check_status: "checked",
          next_action: {
            title: "Use this result",
            why_now: "now",
            value: "",
            urgency: "now",
            consequence: "",
            estimated_effort: "a few minutes",
            dependencies: [],
            risk: "low",
            can_prepare_privately: true,
            student_confirmation_needed: false,
            source_refs: [],
          },
          modes: ["answer_now", "walkthrough", "mastery", "make_handle"],
          prose: "not_generated",
          response_mode: "answer_now",
        },
      };
    });
    render(<AskPanel />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.type(screen.getByRole("textbox"), "Find the derivative of x^2");
    await user.click(screen.getByRole("button", { name: "Get a next step" }));
    const course = await screen.findByLabelText("Course");
    await user.clear(course);
    await user.type(course, "HIST 1010");
    await user.click(screen.getByRole("button", { name: "Use these" }));
    const correct = vi.mocked(transport.send).mock.calls.filter(([cmd]) => cmd === "ask-correct");
    expect(correct).toHaveLength(1);
    expect(correct[0][1]).toMatchObject({ input_id: "ask-1", course: "HIST 1010", boundary: "open_homework" });
    expect(await screen.findByText(/HIST 1010/)).toBeInTheDocument();
  });
});
