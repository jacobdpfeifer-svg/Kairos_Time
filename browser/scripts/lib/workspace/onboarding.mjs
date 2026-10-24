/**
 * Local contracts for the personalized-workspace onboarding.
 *
 * The model may only save a *draft*. It cannot change the application shell,
 * turn on a connector, or install code. A later, student-operated Workspace
 * Studio renders this draft against the same catalog and writes an accepted
 * workspace configuration after preview.
 */
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_CAPABILITIES } from "./catalog.mjs";
import { normalizeWorkflowDraft } from "./draft.mjs";
import { suggestTemplates } from "./rank.mjs";

export { normalizeWorkflowDraft } from "./draft.mjs";
export { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES, WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES } from "./catalog.mjs";
export { suggestTemplates } from "./rank.mjs";

export function workspaceDraftPath(userRoot) {
  return path.join(userRoot, "workspace", "onboarding-draft.json");
}

export function writeWorkflowDraft(file, draft) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
