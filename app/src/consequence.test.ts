// Purpose: tests skip cost sentences
import { describe, expect, it } from "vitest";
import { consequenceSentence, skipCostFor, type SkipCost } from "./consequence";

const cost = (over: Partial<SkipCost> = {}): SkipCost => ({
  course_id: "1300",
  assignment_id: "77",
  current: 84,
  if_zero: 79.2,
  if_full: 86.1,
  swing: 6.9,
  share_of_final: 3,
  status: "ok",
  ...over,
});

describe("consequence sentence", () => {
  it("says what skipping costs and what full marks buy", () => {
    expect(consequenceSentence(cost(), "Calc")).toBe("Skip it: 84% → 79.2% in Calc. Full marks: 86.1%.");
  });

  it("marks estimates and stays silent when it cannot calculate", () => {
    expect(consequenceSentence(cost({ status: "estimate" }))).toMatch(/An estimate\.$/);
    expect(consequenceSentence(cost({ status: "cannot_calculate" }))).toBeNull();
    expect(consequenceSentence(null)).toBeNull();
  });

  it("falls back to share of final grade before any grades exist", () => {
    expect(consequenceSentence(cost({ current: null }), "Calc")).toBe("Worth 3% of your final grade in Calc.");
  });

  it("finds the cost for a semester tick id", () => {
    expect(skipCostFor({ "1300:77": cost() }, { course_id: "1300", id: "item-a77" })?.if_zero).toBe(79.2);
    expect(skipCostFor({ "1300:77": cost() }, { course_id: "1300", id: "item-q5" })).toBeNull();
  });
});
