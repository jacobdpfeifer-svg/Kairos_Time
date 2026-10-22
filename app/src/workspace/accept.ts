import { writeAcceptedSpec } from "../ipc";
import { apply, cloneSpec, type Patch } from "./patch";
import { loadWorkspace } from "./store";
import type { WorkspaceSpec } from "./contracts";

/** The spec a yes would save. Null when a patch does not fit. Nothing is written. */
export function specAfterAmendment(spec: WorkspaceSpec, patches: Patch[], nowIso: string): WorkspaceSpec | null {
  let next = cloneSpec(spec);
  for (const patch of patches) {
    const applied = apply(next, patch);
    if (!applied.ok) return null;
    next = applied.spec;
  }
  return {
    ...next,
    status: "accepted",
    accepted_by: "student",
    accepted_at: nowIso,
    origin: { ...(next.origin ?? { kind: "amendment" }), kind: "amendment" },
    authorship: {
      student_edits: (next.authorship?.student_edits ?? 0) + 1,
      renamed: Boolean(next.authorship?.renamed),
      last_edited_at: nowIso,
    },
  };
}

/** Studio accept and amendment yes share this write. History is snapshotted in Rust. */
export async function commitAccepted(spec: WorkspaceSpec): Promise<WorkspaceSpec | null> {
  const saved = await writeAcceptedSpec(spec);
  await loadWorkspace();
  return saved ?? spec;
}
