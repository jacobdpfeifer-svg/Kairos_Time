/**
 * Template ranking. Same scores onboarding has always used: +3 when the
 * preference matches, +1 for each template block whose capability supports a
 * stated friction, then label order. No filesystem.
 */
import { WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES } from "./catalog.mjs";

/**
 * @param {{ preference?: string, frictions?: string[] } | null | undefined} draft
 * @param {{ catalog?: readonly { id: string, supports?: readonly string[] }[], templates?: readonly { id: string, label: string, preference: string, blocks: readonly string[] }[] }} [options]
 */
export function suggestTemplates(draft, { catalog = WORKSPACE_CAPABILITIES, templates = WORKSPACE_TEMPLATES } = {}) {
  const needs = new Set(draft?.frictions || []);
  return templates
    .map((template) => ({
      ...template,
      score:
        (template.preference === draft?.preference ? 3 : 0) +
        template.blocks.reduce((n, block) => {
          const capability = catalog.find((item) => item.id === block);
          return n + (capability?.supports?.some((need) => needs.has(need)) ? 1 : 0);
        }, 0),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3);
}
