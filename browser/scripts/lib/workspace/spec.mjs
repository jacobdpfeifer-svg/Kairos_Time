/**
 * Workspace spec v1 — the frozen contract between the interview, the
 * deterministic compiler, and the renderer.
 *
 * Architecture: docs/handoff/generative-workspace-architecture-2026-10-21.md.
 *
 * The model never writes this shape directly. It writes
 * `workspace/onboarding-draft.json` (see onboarding.mjs); `compileWorkspace`
 * turns that draft into a spec, and only the student can move a spec to
 * `status: "accepted"`. The renderer refuses anything else.
 *
 * Mirrored by app/src/workspace/contracts.ts (reader types) and
 * app/src-tauri/src/workspace.rs (bounds + atomic write + history), the same
 * three-way mirror the briefs schema uses.
 */
import fs from "node:fs";
import path from "node:path";

export {
  WORKSPACE_SCHEMA_VERSION,
  SURFACES,
  SPEC_STATUS,
  SPEC_ORIGINS,
  BLOCK_SIZES,
  DENSITIES,
  PREDICATES,
  INTERRUPT_KINDS,
  PATCH_OPS,
  MAX_BLOCKS_PER_SURFACE,
  MAX_BLOCKS_TOTAL,
  MAX_HISTORY,
  MAX_NAME,
  REQUESTED_STATES,
  validateWorkspaceSpec,
} from "./bounds.mjs";

export function workspaceDir(userRoot) {
  return path.join(userRoot, "workspace");
}
export function acceptedSpecPath(userRoot) {
  return path.join(workspaceDir(userRoot), "workspace.json");
}
export function proposedSpecPath(userRoot) {
  return path.join(workspaceDir(userRoot), "proposed.json");
}
export function usagePath(userRoot) {
  return path.join(workspaceDir(userRoot), "usage.json");
}
export function historyDir(userRoot) {
  return path.join(workspaceDir(userRoot), "history");
}

/** 0600 temp-file + rename, so a crash never leaves a half-written workspace. */
export function writeSpecAtomic(file, spec) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
