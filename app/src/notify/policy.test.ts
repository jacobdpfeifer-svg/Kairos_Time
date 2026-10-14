import { describe, expect, it } from "vitest";
import type { SemesterTick } from "../ipc";
import { DAILY_CAP, EMPTY_NOTIFY_STATE, candidates, decide, isQuiet } from "./policy";

const NOON = new Date(2026, 9, 14, 12, 0);

const tick = (over: Partial<SemesterTick>): SemesterTick => ({
  id: "item-a1",
  course_id: "1300",
  course_label: "MATH 1300",
  color: "#000",
  title: "Project 2",
  kind: "assignment",
  due_at: new Date(2026, 9, 15, 23, 59).toISOString(),
  points_possible: 100,
  weight_share: 0.2,
  html_url: null,
  completed: false,
  description: "",
  ...over,
});

describe("notification policy", () => {
  it("notices only the three triggers", () => {
    const notes = candidates({
      now: NOON,
      health: { state: "blocked", surfaces_enabled: false },
      changes: [
        { key: "d1", kind: "due_changed", label: "Due date moved", title: "Quiz 2", detected_at: new Date(2026, 9, 14, 9).toISOString(), detail: { to: new Date(2026, 9, 17, 10).toISOString() } },
        { key: "a1", kind: "announcement", label: "Announcement", title: "Office hours", detected_at: NOON.toISOString() },
      ],
      ticks: [tick({}), tick({ id: "small", title: "Reading notes", points_possible: 5, weight_share: 0.01 }), tick({ id: "later", due_at: new Date(2026, 9, 20).toISOString() })],
    });
    expect(notes.map((n) => n.key)).toEqual(["sync-blocked:2026-10-14", "moved:d1", "soon:1300:item-a1"]);
    expect(notes[1].title).toBe("Quiz 2 moved");
    expect(notes[2].body).toMatch(/not turned in yet\.$/);
    // MASTER §06: no exclamation marks, no guilt.
    for (const n of notes) expect(`${n.title} ${n.body}`).not.toMatch(/!|don't forget|haven't opened/i);
  });

  it("is quiet at night and during class", () => {
    expect(isQuiet(new Date(2026, 9, 14, 23, 30))).toBe(true);
    expect(isQuiet(new Date(2026, 9, 14, 7, 59))).toBe(true);
    expect(isQuiet(NOON)).toBe(false);
    expect(isQuiet(NOON, [{ start: new Date(2026, 9, 14, 11, 30).toISOString(), end: new Date(2026, 9, 14, 12, 45).toISOString() }])).toBe(true);
  });

  it("sends each note once, at most three a day, and holds the rest for later", () => {
    const notes = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, title: "t", body: "b" }));
    const first = decide(notes, EMPTY_NOTIFY_STATE, NOON);
    expect(first.send).toHaveLength(DAILY_CAP);
    expect(decide(notes, first.state, new Date(2026, 9, 14, 15)).send).toHaveLength(0);
    const tomorrow = decide(notes, first.state, new Date(2026, 9, 15, 9));
    expect(tomorrow.send.map((n) => n.key)).toEqual(["k3", "k4"]);
  });

  it("sends nothing at night but keeps the notes for the morning", () => {
    const notes = [{ key: "k", title: "t", body: "b" }];
    const night = decide(notes, EMPTY_NOTIFY_STATE, new Date(2026, 9, 14, 23, 30));
    expect(night.send).toHaveLength(0);
    expect(decide(notes, night.state, new Date(2026, 9, 15, 8, 5)).send).toHaveLength(1);
  });
});
