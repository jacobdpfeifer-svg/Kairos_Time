// Purpose: tests study time formatting
import { describe, expect, it } from "vitest";
import { fmtWhen } from "./format";

describe("fmtWhen", () => {
  it("includes a local timezone label", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const text = fmtWhen("2026-09-22T16:00:00Z", new Date("2026-09-22T16:00:00Z"));
    const short = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date("2026-09-22T16:00:00Z"))
      .find((part) => part.type === "timeZoneName")?.value;
    expect(text).toContain(zone);
    expect(text).toContain(short);
  });
});
