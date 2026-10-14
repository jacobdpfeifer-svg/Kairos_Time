import { describe, expect, it } from "vitest";
import { rankOpenWork } from "./rank";

describe("rankOpenWork", () => {
  it("drops completed rows and keeps one recommendation plus two alternatives", () => {
    const ranked = rankOpenWork([
      { id: "done", title: "Already in", due_at: "2026-09-18T12:00:00Z", points: 100, completed: true },
      { id: "small", title: "Tiny", due_at: "2026-09-18T13:00:00Z", points: 5, completed: false },
      { id: "soon", title: "Homework 1", due_at: "2026-09-19T12:00:00Z", points: 20, completed: false },
      { id: "later", title: "Midterm", due_at: "2026-10-01T12:00:00Z", points: 100, completed: false },
      { id: "last", title: "Final", due_at: "2026-12-01T12:00:00Z", points: 40, completed: false },
    ]);
    expect(ranked.recommendation?.title).toBe("Homework 1");
    expect(ranked.alternatives.map((item) => item.title)).toEqual(["Midterm", "Final"]);
  });
});
