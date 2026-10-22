import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC, WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES, validateWorkspaceSpec } from "./contracts";
import { specFromTemplate, suggestTemplates } from "./templates";

describe("workspace templates", () => {
  it("ranks the same three a neutral draft would get", () => {
    const ranked = suggestTemplates({ preference: "one_next_step", frictions: [] });
    expect(ranked.map((item) => item.id)).toEqual(["calm-daily", "course-command", "quiet-minimal"]);
  });

  it("keeps every current screen when a template is accepted", () => {
    const [recommended] = suggestTemplates({ preference: "one_next_step", frictions: [] });
    const spec = specFromTemplate(recommended, "2026-10-21T16:00:00.000Z");
    expect(spec.status).toBe("accepted");
    expect(spec.accepted_by).toBe("student");
    expect(spec.origin).toEqual({ kind: "template", template_id: "calm-daily" });
    expect(spec.name).toBe("Calm daily focus");
    for (const surface of ["today", "week", "courses", "study", "advisor"] as const) {
      expect(spec.surfaces[surface]?.slots?.length).toBeGreaterThan(0);
      expect(spec.surfaces[surface]?.slots).toEqual(DEFAULT_SPEC.surfaces[surface]?.slots);
    }
    const ids = new Set(WORKSPACE_CAPABILITIES.map((item) => item.id));
    for (const block of Object.values(spec.blocks)) expect(ids.has(block.capability)).toBe(true);
  });

  it("gives each starting point its own opening tab", () => {
    // One screen per tab leaves no arrangement to tell the five apart, so the
    // choice has to land somewhere. If this collapses to one entry again, the
    // template pick is only renaming the workspace.
    const picked = WORKSPACE_TEMPLATES.map((template) => specFromTemplate(template, "2026-10-21T16:00:00.000Z"));
    expect(picked.map((spec) => [spec.origin?.template_id, spec.home])).toEqual([
      ["calm-daily", "today"],
      ["weekly-planner", "week"],
      ["course-command", "courses"],
      ["study-first", "study"],
      ["quiet-minimal", "today"],
    ]);
    for (const spec of picked) {
      expect(validateWorkspaceSpec(spec, { capabilities: WORKSPACE_CAPABILITIES }).ok).toBe(true);
    }
  });
});
