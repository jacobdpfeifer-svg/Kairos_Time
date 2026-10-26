import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SemesterSurface, WorkStateRead } from "../ipc";
import { WorkStateNote, mergeMovedChanges, overlaySurface, parityRow, workStateNote } from "./snapshot";

type WorkItem = NonNullable<WorkStateRead["state"]>["work_items"][number];

const item: WorkItem = {
  id: "canvas:cu-boulder:1300:assignment:101",
  course_id: "canvas:course:cu-boulder:1300",
  kind: "assignment",
  title: "Homework 1",
  due_at: "2026-10-26T16:00:00Z",
  canvas: { url: "https://canvas.example/courses/1300/assignments/101", submission_state: "submitted", completed: true },
  change: { kind: "due_moved", seen_at: "2026-10-22T00:00:00Z", source_key: "snap-due:1300:101:2026-10-26" },
  student: { status: "deferred", estimate_minutes: 45, planned_day: "2026-10-26", order: 0, plan_id: "item-a101" },
};

function read(partial: Partial<WorkStateRead> = {}, items: WorkItem[] = [item]): WorkStateRead {
  return {
    ok: true,
    reason: null,
    fell_back: false,
    health: { schema_version: 1 },
    state: {
      schema_version: 1,
      coverage: { canvas: "ok", freshness: "ok", plan: "ok", study: "unavailable" },
      work_items: items,
    },
    ...partial,
  };
}

function tick(over: Partial<SemesterSurface["courses"][number]["ticks"][number]> = {}) {
  return {
    id: "item-a101",
    course_id: "1300",
    course_label: "MATH",
    color: "#000",
    title: "Old title",
    kind: "assignment",
    due_at: "2026-10-25T06:00:00Z",
    points_possible: 10,
    weight_share: 0,
    html_url: null,
    completed: false,
    description: "",
    ...over,
  };
}

function surface(ticks = [tick()]): SemesterSurface {
  return {
    range: "1m",
    window_start: "2026-10-01T00:00:00Z",
    window_end: "2026-11-01T00:00:00Z",
    today: "2026-10-23T00:00:00Z",
    courses: [
      {
        id: "1300",
        label: "MATH",
        code: "MATH",
        name: "Calc",
        color: "#000",
        term: { start_at: null, end_at: null, source: "canvas" },
        counts: { assignments: ticks.length, quizzes: 0, exams: 0 },
        ticks,
      },
    ],
  };
}

describe("work-state snapshot", () => {
  it("overlays the canonical title, due instant, link, and completion", () => {
    expect(parityRow(item)).toEqual({
      id: "item-a101",
      due_at: "2026-10-26T16:00:00Z",
      completed: true,
      planned_day: "2026-10-26",
      order: 0,
      moved: true,
    });
    expect(overlaySurface(surface(), read()).courses[0].ticks[0]).toMatchObject({
      id: "item-a101",
      title: "Homework 1",
      due_at: "2026-10-26T16:00:00Z",
      completed: true,
    });
  });

  it("never blanks a dated row because work state has no date", () => {
    const undated = { ...item, due_at: null };
    const out = overlaySurface(surface(), read({}, [undated]));
    expect(out.courses[0].ticks[0].due_at).toBe("2026-10-25T06:00:00Z");
  });

  it("does not resurrect finished work when submission_state looks unsubmitted", () => {
    // A teacher-entered grade that is not posted yet.
    const paper = { ...item, canvas: { url: null, submission_state: "unsubmitted", completed: true } };
    const out = overlaySurface(surface([tick({ completed: true })]), read({}, [paper]));
    expect(out.courses[0].ticks[0].completed).toBe(true);
  });

  it("re-sorts and re-windows rows after an overlaid date moves them", () => {
    const second: WorkItem = { ...item, id: "canvas:cu-boulder:1300:assignment:102", due_at: "2026-10-24T16:00:00Z", student: { ...item.student, plan_id: "item-a102" } };
    const moved: WorkItem = { ...item, due_at: "2026-12-20T16:00:00Z" };
    const out = overlaySurface(surface([tick(), tick({ id: "item-a102", due_at: "2026-10-28T06:00:00Z" })]), read({}, [moved, second]));
    // a101 moved out of the window and a102 now sorts first.
    expect(out.courses[0].ticks.map((t) => t.id)).toEqual(["item-a102"]);
  });

  it("drops an unparseable due and sorts a missing date after a real one", () => {
    const dropped = overlaySurface(surface([tick()]), read({}, [{ ...item, due_at: "not-a-date" }]));
    expect(dropped.courses[0].ticks).toHaveLength(0);
    const undated = tick({ id: "item-a102", due_at: null, title: "Undated" });
    const dated = tick({ id: "item-a103", due_at: "2026-10-21T16:00:00Z", title: "Dated" });
    const later: WorkItem = {
      ...item,
      id: "canvas:cu-boulder:1300:assignment:102",
      title: "Undated",
      due_at: null,
      student: { ...item.student, plan_id: "item-a102" },
    };
    const earlier: WorkItem = {
      ...item,
      id: "canvas:cu-boulder:1300:assignment:103",
      title: "Dated",
      due_at: "2026-10-21T16:00:00Z",
      student: { ...item.student, plan_id: "item-a103" },
    };
    const ordered = overlaySurface(surface([undated, dated]), read({}, [later, earlier]));
    expect(ordered.courses[0].ticks.map((row) => row.id)).toEqual(["item-a103", "item-a102"]);
  });

  it("will not overlay when two rows claim the same plan key", () => {
    const twin: WorkItem = { ...item, id: "canvas:other:1300:assignment:101", title: "Wrong course" };
    const out = overlaySurface(surface(), read({}, [item, twin]));
    expect(out.courses[0].ticks[0].title).toBe("Old title");
  });

  describe("moved-date rows", () => {
    it("recognises the same move the dashboard already has, by key", () => {
      const merged = mergeMovedChanges(
        [{ key: "snap-due:1300:101:2026-10-26", kind: "due_changed", label: "Due date moved", title: "Homework 1", url: null }],
        read(),
      );
      expect(merged).toHaveLength(1);
    });

    it("recognises it by url when the key is absent", () => {
      const keyless = { ...item, change: { kind: "due_moved", seen_at: null, source_key: null } };
      const merged = mergeMovedChanges(
        [{ key: "other", kind: "due_changed", label: "Due date moved", title: "Homework 1", url: item.canvas!.url }],
        read({}, [keyless]),
      );
      expect(merged).toHaveLength(1);
    });

    it("is not hidden by an unrelated change on the same url", () => {
      const merged = mergeMovedChanges(
        [{ key: "k", kind: "points_changed", label: "Points changed", title: "Homework 1", url: item.canvas!.url }],
        read(),
      );
      expect(merged).toHaveLength(2);
      expect(merged.some((c) => c.label === "Due date moved")).toBe(true);
    });

    it("adds the row when the dashboard has nothing", () => {
      const added = mergeMovedChanges([], read());
      expect(added).toHaveLength(1);
      expect(added[0].kind).toBe("due_changed");
    });
  });

  it("keeps the legacy surface when the snapshot is missing or malformed", () => {
    const missing = read({ ok: false, reason: "missing", state: null, health: null });
    const base = surface();
    expect(overlaySurface(base, missing)).toBe(base);
    expect(workStateNote(missing)).toBeNull();
    const malformed = read({ ok: false, reason: "malformed", state: null, health: null });
    expect(overlaySurface(surface(), malformed).courses[0].ticks[0].title).toBe("Old title");
    render(<WorkStateNote read={malformed} />);
    expect(screen.getByRole("status").textContent).toMatch(/could not be read/);
  });

  it("says when canvas coverage is partial without clearing rows", () => {
    const partial = read({
      state: {
        schema_version: 1,
        coverage: { canvas: "partial", freshness: "ok", plan: "ok", study: "unavailable" },
        work_items: [item],
      },
    });
    render(<WorkStateNote read={partial} />);
    expect(screen.getByRole("status").textContent).toMatch(/partial/);
    expect(overlaySurface(surface(), partial).courses[0].ticks).toHaveLength(1);
  });
});
