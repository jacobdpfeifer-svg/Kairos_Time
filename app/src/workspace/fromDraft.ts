/**
 * The compiler's proposal, ready for WorkspaceStudio. The draft is intent.
 * The spec, patches, and narration come from compileWorkspace.
 */
import { compileWorkspace } from "./compile";
import type { WorkspaceSpec } from "./contracts";
import { cloneSpec, type Patch, type ProposedWorkspace } from "./patch";

export function proposalFromDraft(draft: { created_at?: string }, now?: string): ProposedWorkspace {
  const stamp = now || draft.created_at;
  if (!stamp) throw new Error("compileWorkspace: now is required");
  const compiled = compileWorkspace(draft, { now: stamp });
  const baseline = cloneSpec(compiled.spec as WorkspaceSpec);
  baseline.status = "proposed";
  delete baseline.accepted_by;
  delete baseline.accepted_at;
  return {
    spec: cloneSpec(baseline),
    baseline,
    patches: compiled.patches as Patch[],
    rationale: compiled.rationale,
    nudge_shown: false,
  };
}
