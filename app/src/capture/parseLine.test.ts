// Purpose: tests quick capture parsing
import { describe, expect, it } from "vitest";
import { parseLine } from "./parseLine";

// Local calendar dates, so the assertions do not depend on the machine's zone.
const now = new Date(2026, 9, 13, 10, 0, 0);

describe("parseLine", () => {
  it("shows a weekday date preview and removes the date token", () => {
    const line = parseLine("read ch 5 thu", [], now);
    expect(line.title).toBe("read ch 5");
    expect(line.day).toBe("2026-10-15");
    expect(line.preview).toMatch(/Thu/);
  });

  it("understands a full weekday and drops the preposition in front of it", () => {
    const line = parseLine("read ch 5 on thursday", [], now);
    expect(line.title).toBe("read ch 5");
    expect(line.day).toBe("2026-10-15");
  });

  it("keeps the local calendar day when the capture is made in the evening", () => {
    const evening = new Date(2026, 9, 13, 22, 30, 0);
    const line = parseLine("read ch 5 thu", [], evening);
    expect(line.day).toBe("2026-10-15");
  });

  it("matches a course by its name, and stores the course label", () => {
    const line = parseLine("finish the computer science lab tomorrow", [{ id: "1", label: "CSCI 1300", name: "Computer Science" }], now);
    expect(line.title).toBe("finish the lab");
    expect(line.course).toBe("CSCI 1300");
    expect(line.day).toBe("2026-10-14");
  });

  it("drops a trailing for when the course name came off the end", () => {
    const line = parseLine("finish lab for CSCI 1300 tomorrow", [{ id: "1", label: "CSCI 1300", name: "Computer Science" }], now);
    expect(line.title).toBe("finish lab");
    expect(line.course).toBe("CSCI 1300");
  });

  it("does not invent a date, and does not read sat or sun as weekdays", () => {
    expect(parseLine("call advisor").dueAt).toBeNull();
    const sat = parseLine("I sat with the reading", [], now);
    expect(sat.dueAt).toBeNull();
    expect(sat.title).toBe("I sat with the reading");
    expect(parseLine("notes in the sun", [], now).dueAt).toBeNull();
    expect(parseLine("problem set on sat", [], now).day).toBe("2026-10-17");
  });
});
