import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDue } from "../../app/extension-chrome/lib/format.js";

describe("formatDue", () => {
  it("names the short zone and never the IANA id (MASTER §02)", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const when = new Date("2026-09-22T16:00:00Z");
    const text = formatDue(when.toISOString());
    const short = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(when)
      .find((part) => part.type === "timeZoneName")?.value;
    assert.doesNotMatch(text, new RegExp(zone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, new RegExp(String(short).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
