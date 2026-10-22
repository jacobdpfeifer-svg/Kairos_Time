import { describe, expect, it } from "vitest";
import { reduceVoiceMessage } from "./onboardingSession";

describe("onboarding voice messages", () => {
  it("hands the draft to the studio and then ignores model text", () => {
    const saved = reduceVoiceMessage(false, { type: "tool", name: "save_workflow_draft", result: { ok: true } });
    expect(saved).toEqual({ narrating: true, effect: "draft", text: "" });
    const spoken = reduceVoiceMessage(true, { type: "transcript", role: "model", text: "I made you a custom layout." });
    expect(spoken.effect).toBe("none");
    expect(spoken.narrating).toBe(true);
  });

  it("keeps the interview caption until the draft exists", () => {
    const heard = reduceVoiceMessage(false, { type: "transcript", role: "model", text: "What got in the way?" });
    expect(heard.effect).toBe("model");
    expect(heard.text).toBe("What got in the way?");
  });
});
