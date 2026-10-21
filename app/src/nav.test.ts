// Purpose: tests kairos link routing
import { describe, expect, it } from "vitest";
import { routeFromUrl } from "./nav";

describe("routeFromUrl", () => {
  it("maps the tray and kairos links onto the same route object", () => {
    expect(routeFromUrl("kairos://today")).toEqual({ tab: "today" });
    expect(routeFromUrl("kairos://week")).toEqual({ tab: "week" });
    expect(routeFromUrl("kairos://course/1300")).toEqual({ tab: "courses", courseId: "1300" });
    expect(routeFromUrl("kairos://item/1300/hw-4")).toEqual({ tab: "today", courseId: "1300", itemId: "hw-4" });
    expect(routeFromUrl("kairos://study/exam/midterm")).toEqual({ tab: "study", examId: "midterm" });
    expect(routeFromUrl("kairos://advisor")).toEqual({ tab: "advisor" });
    expect(routeFromUrl("kairos://settings/canvas")).toEqual({ tab: "settings", group: "canvas" });
    expect(routeFromUrl("kairos://capture")).toEqual({ tab: "today", capture: true });
    expect(routeFromUrl("kairos://ask")).toEqual({ tab: "today", ask: true });
  });

  it("ignores a link it does not know", () => {
    expect(routeFromUrl("https://example.com")).toBeNull();
    expect(routeFromUrl("kairos://nope")).toBeNull();
  });

  it("returns null instead of throwing on a malformed escape", () => {
    expect(routeFromUrl("kairos://course/%E0%A4")).toBeNull();
  });

  it("refuses ids an outside link could use to reach a file path", () => {
    expect(routeFromUrl("kairos://course/..%2F..%2F..%2Fetc")).toBeNull();
    expect(routeFromUrl("kairos://course/%2e%2e")).toBeNull();
    expect(routeFromUrl("kairos://item/1300/..%2Fx")).toBeNull();
    expect(routeFromUrl("kairos://study/exam/%00")).toBeNull();
    expect(routeFromUrl("kairos://settings/%3Cscript%3E")).toBeNull();
    expect(routeFromUrl(`kairos://course/${"1".repeat(600)}`)).toBeNull();
    expect(routeFromUrl("kairos://item/1/t|1|assignment|9")).toEqual({ tab: "today", courseId: "1", itemId: "t|1|assignment|9" });
  });
});
