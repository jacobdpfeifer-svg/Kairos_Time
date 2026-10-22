/**
 * Template ranking matches browser/scripts/lib/workspace/onboarding.mjs.
 * Accepting a template keeps every current screen. A block the shell cannot
 * mount, or one that would mount the same screen twice, is skipped.
 *
 * With one screen per tab there is no block arrangement left to tell the five
 * starting points apart, so the choice is carried by `home` — the tab the app
 * opens on — from the same preference mapping the compiler uses. Without it,
 * picking "Weekly planner" would only change the workspace's name.
 */
import { homeForPreference } from "./compile";
import {
  DEFAULT_SPEC,
  WORKSPACE_CAPABILITIES,
  WORKSPACE_TEMPLATES,
  type Surface,
  type WorkspaceSpec,
  type WorkspaceTemplate,
} from "./contracts";

export type RankedTemplate = WorkspaceTemplate & { score: number };

export function suggestTemplates(draft: { preference?: string; frictions?: string[] } | null | undefined): RankedTemplate[] {
  const needs = new Set(draft?.frictions || []);
  return WORKSPACE_TEMPLATES.map((template) => ({
    ...template,
    score:
      (template.preference === draft?.preference ? 3 : 0) +
      template.blocks.reduce((n, block) => {
        const capability = WORKSPACE_CAPABILITIES.find((item) => item.id === block);
        return n + (capability?.supports.some((need) => needs.has(need)) ? 1 : 0);
      }, 0),
  }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function cloneSpec(spec: WorkspaceSpec): WorkspaceSpec {
  return JSON.parse(JSON.stringify(spec)) as WorkspaceSpec;
}

export function specFromTemplate(template: WorkspaceTemplate, now = new Date().toISOString()): WorkspaceSpec {
  const spec = cloneSpec(DEFAULT_SPEC);
  spec.spec_id = `ws_${template.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  spec.name = template.label;
  spec.created_at = now;
  spec.accepted_at = now;
  spec.status = "accepted";
  spec.accepted_by = "student";
  spec.origin = { kind: "template", template_id: template.id };
  spec.home = homeForPreference(template.preference);
  spec.authorship = { student_edits: 0, renamed: false, last_edited_at: now };

  const byId = new Map(WORKSPACE_CAPABILITIES.map((item) => [item.id, item]));
  const mounted = new Map<Surface, Set<string>>();
  for (const [name, surface] of Object.entries(spec.surfaces) as [Surface, { slots?: string[] }][]) {
    const components = new Set<string>();
    for (const id of surface.slots ?? []) {
      const cap = byId.get(spec.blocks[id]?.capability);
      if (cap) components.add(cap.component);
    }
    mounted.set(name, components);
  }

  let added = 0;
  for (const capId of template.blocks) {
    const cap = byId.get(capId);
    const surface = cap?.surfaces[0] as Surface | undefined;
    if (!cap || !surface) continue;
    const used = mounted.get(surface) ?? new Set<string>();
    if (used.has(cap.component)) continue;
    const already = Object.values(spec.blocks).filter((block) => block.capability === cap.id).length;
    if (already >= (cap.max_instances ?? 1)) continue;
    added += 1;
    const id = `b_extra_${added}`;
    spec.blocks[id] = { capability: cap.id, size: (cap.sizes[0] as "full" | "half") || "full", props: {}, visible_when: "always" };
    const slots = spec.surfaces[surface]?.slots ?? [];
    spec.surfaces[surface] = { slots: [...slots, id] };
    used.add(cap.component);
    mounted.set(surface, used);
  }
  return spec;
}
