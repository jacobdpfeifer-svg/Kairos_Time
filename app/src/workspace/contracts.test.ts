import { describe, expect, it } from "vitest";
import { WORKSPACE_CAPABILITIES } from "./catalog";
import { WORKSPACE_COMPONENTS } from "./components";
import { DEFAULT_SPEC, MAX_NAME, validateWorkspaceSpec, type CatalogArg } from "./contracts";

const catalog: CatalogArg = { capabilities: WORKSPACE_CAPABILITIES };

function block(capability: string) {
  return { capability, size: "full" as const, props: {}, visible_when: "always" };
}

describe("workspace spec reader", () => {
  it("registers one React component for every catalog component", () => {
    const names = [...new Set(WORKSPACE_CAPABILITIES.map((item) => item.component))].sort();
    expect(Object.keys(WORKSPACE_COMPONENTS).sort()).toEqual(names);
    expect(names).toEqual(["AdvisorView", "CoursesView", "StudyPathView", "TodayView", "WeekView"]);
  });
  it("accepts the default shell", () => {
    const result = validateWorkspaceSpec(DEFAULT_SPEC, catalog);
    expect(result.ok).toBe(true);
    expect(result.spec?.surfaces.today?.slots).toEqual(["b_today"]);
  });

  it("rejects the same bounds the node validator rejects", () => {
    const unknown = structuredClone(DEFAULT_SPEC);
    unknown.blocks.b_today.capability = "nope";
    expect(validateWorkspaceSpec(unknown, catalog).errors.join(" ")).toMatch(/not in the catalog/);

    const predicate = structuredClone(DEFAULT_SPEC);
    predicate.blocks.b_today.visible_when = "whenever";
    expect(validateWorkspaceSpec(predicate, catalog).errors.join(" ")).toMatch(/unknown predicate/);

    const duplicate = structuredClone(DEFAULT_SPEC);
    duplicate.surfaces.week = { slots: ["b_today"] };
    expect(validateWorkspaceSpec(duplicate, catalog).errors.join(" ")).toMatch(/more than one surface/);

    const slots = ["b0", "b1", "b2", "b3", "b4", "b5", "b6"];
    const wide = structuredClone(DEFAULT_SPEC);
    wide.surfaces.today = { slots };
    for (const id of slots) wide.blocks[id] = block("today.next_action");
    expect(validateWorkspaceSpec(wide, catalog).errors.join(" ")).toMatch(/more than 6/);

    const unaccepted = structuredClone(DEFAULT_SPEC);
    unaccepted.accepted_by = "model";
    expect(validateWorkspaceSpec(unaccepted, catalog).errors.join(" ")).toMatch(/accepted_by student/);
  });

  it("drops unknown prop keys and rejects a wrong type", () => {
    const demo: CatalogArg = {
      capabilities: [{ id: "demo", surfaces: ["today"], sizes: ["full"], max_instances: 1, requires: [], props: { show: { type: "boolean", default: true } } }],
    };
    const spec = {
      schema_version: 1,
      status: "accepted" as const,
      accepted_by: "student",
      surfaces: { today: { slots: ["b1"] } },
      blocks: { b1: { capability: "demo", size: "full" as const, props: { extra: 1 } as Record<string, unknown>, visible_when: "always" } },
    };
    const ok = validateWorkspaceSpec(spec, demo);
    expect(ok.ok).toBe(true);
    expect(ok.spec?.blocks.b1.props).toEqual({ show: true });

    const bad = structuredClone(spec);
    bad.blocks.b1.props = { show: "no" };
    expect(validateWorkspaceSpec(bad, demo).ok).toBe(false);
  });

  it("bounds the student-authored name", () => {
    const long = { ...DEFAULT_SPEC, name: "x".repeat(MAX_NAME + 1) };
    expect(validateWorkspaceSpec(long, catalog).errors.join(" ")).toMatch(/name must be text/);

    const wrong = { ...DEFAULT_SPEC, name: { nested: true } as unknown as string };
    expect(validateWorkspaceSpec(wrong, catalog).errors.join(" ")).toMatch(/name must be text/);

    expect(validateWorkspaceSpec({ ...DEFAULT_SPEC, name: "x".repeat(MAX_NAME) }, catalog).ok).toBe(true);
  });
});
