import { describe, expect, it } from "vitest";
import { draftFromAnswers, draftFromStored, emptyAnswers, toolNames } from "./interview";
import { proposalFromDraft } from "./fromDraft";

describe("typed workspace interview", () => {
  it("turns the answers into a draft and a proposed spec", () => {
    const answers = emptyAnswers();
    answers.frictions = ["tracking_deadlines", "planning_time", "finding_next_action", "staying_calm"];
    answers.ideal = "I want the week in front of me.";
    answers.preference = "weekly_overview";
    answers.tools = "Notion, a paper planner";
    answers.interrupt_for = ["due_moved"];
    const draft = draftFromAnswers(answers, "2026-10-21T18:00:00.000Z");
    expect(draft.status).toBe("draft");
    expect(draft.frictions).toEqual(["tracking_deadlines", "planning_time", "finding_next_action"]);
    expect(draft.requested_integrations).toEqual(["Notion", "a paper planner"]);
    expect(draft.interrupt_for).toEqual(["due_moved"]);
    expect(draft).not.toHaveProperty("blocks");
    const proposal = proposalFromDraft(draft);
    expect(proposal.spec.status).toBe("proposed");
    expect(proposal.spec.accepted_by).toBeUndefined();
    expect(proposal.patches.some((patch) => patch.op === "place" && patch.narration)).toBe(true);
    expect(proposal.spec.requested_integrations?.[0]?.state).toBe("requested");
  });

  it("refuses a stored file that is already accepted", () => {
    expect(draftFromStored({ status: "accepted", accepted_by: "student", ideal_workflow: "x" })).toBeNull();
    expect(draftFromStored(null)).toBeNull();
  });

  it("splits tool names without inventing a connection", () => {
    expect(toolNames("Notion;\nObsidian")).toEqual(["Notion", "Obsidian"]);
  });
});
