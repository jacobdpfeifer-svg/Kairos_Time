/**
 * One patch path for the live build, student edits, and later amendments.
 * Ops match PATCH_OPS in browser/scripts/lib/workspace/spec.mjs.
 * A patch that fails a bound is refused. Nothing is repaired.
 */
import {
  INTERRUPT_KINDS,
  SURFACES,
  WORKSPACE_CAPABILITIES,
  validateWorkspaceSpec,
  type CatalogArg,
  type Surface,
  type WorkspaceBlock,
  type WorkspaceSpec,
} from "./contracts";
import type { WorkspaceCapability } from "./catalog";

export const PATCH_OPS = ["place", "remove", "reorder", "set_props", "set_density", "rename", "set_home", "set_quiet", "done"] as const;
export type PatchOp = (typeof PATCH_OPS)[number];

export const REPLAY_MS = 220;

type Narration = { narration?: string };

export type Patch =
  | ({ op: "place"; surface: Surface; block_id: string; index: number; block: WorkspaceBlock } & Narration)
  | ({ op: "remove"; surface: Surface; block_id: string } & Narration)
  | ({ op: "reorder"; surface: Surface; block_id: string; index: number } & Narration)
  | ({ op: "set_props"; block_id: string; props: Record<string, unknown> } & Narration)
  | ({ op: "set_density"; density: "comfortable" | "compact" } & Narration)
  | ({ op: "rename"; name: string } & Narration)
  | ({ op: "set_home"; home: Surface | null } & Narration)
  | ({ op: "set_quiet"; interrupt_for: string[] } & Narration)
  | ({ op: "done" } & Narration);

export type ApplyResult = { ok: true; spec: WorkspaceSpec } | { ok: false; error: string };

export type PatchHistory = { undo: Patch[]; redo: Patch[] };

export type ProposedWorkspace = {
  spec: WorkspaceSpec;
  /** The proposal before this session's edits. Start over returns here. */
  baseline: WorkspaceSpec;
  patches: Patch[];
  rationale: Record<string, string>;
  nudge_shown: boolean;
};

export const SURFACE_LABEL: Record<Surface, string> = {
  today: "Today",
  week: "Week",
  courses: "Courses",
  study: "Study",
  advisor: "Advisor",
};

const OWNERSHIP: ReadonlySet<string> = new Set(["place", "remove", "reorder", "rename"]);

export function cloneSpec<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emptyHistory(): PatchHistory {
  return { undo: [], redo: [] };
}

/** Ownership still on the undo stack. Density and replay patches are not counted. */
export function studentEditCount(history: PatchHistory): number {
  return history.undo.filter((patch) => OWNERSHIP.has(patch.op)).length;
}

export function emptyShell(spec: WorkspaceSpec): WorkspaceSpec {
  const next = cloneSpec(spec);
  next.status = "proposed";
  delete next.accepted_by;
  delete next.accepted_at;
  next.blocks = {};
  next.surfaces = {
    today: { slots: [] },
    week: { slots: [] },
    courses: { slots: [] },
    study: { slots: [] },
    advisor: { slots: [] },
  };
  return next;
}

/** Place ops that rebuild `spec` from an empty shell, then `done`. */
export function patchesFromSpec(spec: WorkspaceSpec): Patch[] {
  const patches: Patch[] = [];
  for (const surface of SURFACES) {
    const slots = spec.surfaces[surface]?.slots ?? [];
    slots.forEach((id, index) => {
      const block = spec.blocks[id];
      if (!block) return;
      patches.push({ op: "place", surface, block_id: id, index, block: cloneSpec(block) });
    });
  }
  patches.push({ op: "done" });
  return patches;
}

export function proposalFromAccepted(spec: WorkspaceSpec): ProposedWorkspace {
  const baseline = cloneSpec(spec);
  baseline.status = "proposed";
  delete baseline.accepted_by;
  delete baseline.accepted_at;
  return {
    spec: cloneSpec(baseline),
    baseline,
    patches: patchesFromSpec(baseline),
    rationale: {},
    nudge_shown: false,
  };
}

export function normalizeProposal(raw: Partial<ProposedWorkspace> & { spec: WorkspaceSpec }): ProposedWorkspace {
  const baseline = raw.baseline ?? raw.spec;
  const patches = raw.patches && raw.patches.length ? raw.patches : patchesFromSpec(baseline);
  return {
    spec: raw.spec,
    baseline,
    patches,
    rationale: raw.rationale ?? {},
    nudge_shown: Boolean(raw.nudge_shown),
  };
}

function narrate<T extends Patch>(patch: T, narration?: string): T {
  return narration ? { ...patch, narration } : patch;
}

function slotsOf(spec: WorkspaceSpec, surface: Surface): string[] {
  return [...(spec.surfaces[surface]?.slots ?? [])];
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/**
 * Apply one op. `spec` is not mutated. The result is the validated spec,
 * with unknown prop keys dropped the same way the reader drops them.
 */
export function apply(spec: WorkspaceSpec, patch: Patch, capabilities: CatalogArg["capabilities"] = WORKSPACE_CAPABILITIES): ApplyResult {
  const next = cloneSpec(spec);
  const problem = mutate(next, patch);
  if (problem) return fail(problem);
  const checked = validateWorkspaceSpec(next, { capabilities });
  if (!checked.ok || !checked.spec) return fail(checked.errors[0] ?? "That change doesn't fit this workspace.");
  return { ok: true, spec: checked.spec };
}

function mutate(spec: WorkspaceSpec, patch: Patch): string | null {
  if (patch.op === "done") return null;
  if (patch.op === "rename") {
    const name = patch.name.trim();
    if (name) spec.name = name;
    else delete spec.name;
    return null;
  }
  if (patch.op === "set_density") {
    spec.density = patch.density;
    return null;
  }
  if (patch.op === "set_home") {
    if (patch.home === null) delete spec.home;
    else if (!SURFACES.includes(patch.home)) return "That isn't a screen.";
    else spec.home = patch.home;
    return null;
  }
  if (patch.op === "set_quiet") {
    const requested = patch.interrupt_for;
    if (requested.some((kind, index) => !INTERRUPT_KINDS.includes(kind as (typeof INTERRUPT_KINDS)[number]) || requested.indexOf(kind) !== index)) {
      return "That isn't an allowed interruption.";
    }
    const current = spec.quiet?.interrupt_for ?? [...INTERRUPT_KINDS];
    // A narrower list cannot be undone by widening it again. Revert restores the
    // snapshotted spec, which is the copy from before the student said yes.
    if (requested.some((kind) => !current.includes(kind))) return "An amendment can't add a notification.";
    spec.quiet = { ...(spec.quiet ?? {}), interrupt_for: INTERRUPT_KINDS.filter((kind) => requested.includes(kind)) };
    return null;
  }
  if (patch.op === "set_props") {
    const block = spec.blocks[patch.block_id];
    if (!block) return "That block isn't on the workspace.";
    block.props = cloneSpec(patch.props);
    return null;
  }
  if (patch.op === "place") {
    if (spec.blocks[patch.block_id]) return "That block is already on the workspace.";
    spec.blocks[patch.block_id] = cloneSpec(patch.block);
    const slots = slotsOf(spec, patch.surface);
    const index = Math.max(0, Math.min(patch.index, slots.length));
    slots.splice(index, 0, patch.block_id);
    spec.surfaces[patch.surface] = { slots };
    return null;
  }
  if (patch.op === "remove") {
    if (!spec.blocks[patch.block_id]) return "That block isn't on the workspace.";
    const slots = slotsOf(spec, patch.surface).filter((id) => id !== patch.block_id);
    if (slots.length === slotsOf(spec, patch.surface).length) return "That block isn't on this screen.";
    delete spec.blocks[patch.block_id];
    spec.surfaces[patch.surface] = { slots };
    return null;
  }
  const slots = slotsOf(spec, patch.surface);
  const from = slots.indexOf(patch.block_id);
  if (from < 0) return "That block isn't on this screen.";
  slots.splice(from, 1);
  const index = Math.max(0, Math.min(patch.index, slots.length));
  slots.splice(index, 0, patch.block_id);
  spec.surfaces[patch.surface] = { slots };
  return null;
}

/** The inverse of `patch`, read from the spec before `patch` was applied. */
export function invert(patch: Patch, specBefore: WorkspaceSpec): Patch {
  const narration = patch.narration;
  if (patch.op === "done") return narrate({ op: "done" }, narration);
  if (patch.op === "rename") return narrate({ op: "rename", name: specBefore.name ?? "" }, narration);
  if (patch.op === "set_density") return narrate({ op: "set_density", density: specBefore.density ?? "comfortable" }, narration);
  if (patch.op === "set_home") return narrate({ op: "set_home", home: specBefore.home ?? null }, narration);
  if (patch.op === "set_quiet") return narrate({ op: "set_quiet", interrupt_for: [...(specBefore.quiet?.interrupt_for ?? INTERRUPT_KINDS)] }, narration);
  if (patch.op === "set_props") {
    const props = specBefore.blocks[patch.block_id]?.props ?? {};
    return narrate({ op: "set_props", block_id: patch.block_id, props: cloneSpec(props) }, narration);
  }
  if (patch.op === "place") return narrate({ op: "remove", surface: patch.surface, block_id: patch.block_id }, narration);
  if (patch.op === "remove") {
    const slots = slotsOf(specBefore, patch.surface);
    const index = slots.indexOf(patch.block_id);
    const block = specBefore.blocks[patch.block_id];
    if (index < 0 || !block) throw new Error("cannot invert remove");
    return narrate({ op: "place", surface: patch.surface, block_id: patch.block_id, index, block: cloneSpec(block) }, narration);
  }
  const index = slotsOf(specBefore, patch.surface).indexOf(patch.block_id);
  if (index < 0) throw new Error("cannot invert reorder");
  return narrate({ op: "reorder", surface: patch.surface, block_id: patch.block_id, index }, narration);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const entries = Object.keys(value as object)
      .sort()
      .map((key) => [key, stable((value as Record<string, unknown>)[key])]);
    return Object.fromEntries(entries);
  }
  return value;
}

function sameSpec(a: WorkspaceSpec, b: WorkspaceSpec): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function pushPatch(
  spec: WorkspaceSpec,
  history: PatchHistory,
  patch: Patch,
  capabilities: CatalogArg["capabilities"] = WORKSPACE_CAPABILITIES,
): { ok: true; spec: WorkspaceSpec; history: PatchHistory } | { ok: false; error: string } {
  const applied = apply(spec, patch, capabilities);
  if (!applied.ok) return applied;
  if (sameSpec(applied.spec, spec)) return { ok: true, spec: applied.spec, history };
  return {
    ok: true,
    spec: applied.spec,
    history: { undo: [...history.undo, invert(patch, spec)], redo: [] },
  };
}

export function undoPatch(
  spec: WorkspaceSpec,
  history: PatchHistory,
  capabilities: CatalogArg["capabilities"] = WORKSPACE_CAPABILITIES,
): { spec: WorkspaceSpec; history: PatchHistory } {
  const inverse = history.undo[history.undo.length - 1];
  if (!inverse) return { spec, history };
  const forward = invert(inverse, spec);
  const applied = apply(spec, inverse, capabilities);
  if (!applied.ok) return { spec, history };
  return { spec: applied.spec, history: { undo: history.undo.slice(0, -1), redo: [...history.redo, forward] } };
}

export function redoPatch(
  spec: WorkspaceSpec,
  history: PatchHistory,
  capabilities: CatalogArg["capabilities"] = WORKSPACE_CAPABILITIES,
): { spec: WorkspaceSpec; history: PatchHistory } {
  const forward = history.redo[history.redo.length - 1];
  if (!forward) return { spec, history };
  const inverse = invert(forward, spec);
  const applied = apply(spec, forward, capabilities);
  if (!applied.ok) return { spec, history };
  return { spec: applied.spec, history: { undo: [...history.undo, inverse], redo: history.redo.slice(0, -1) } };
}

/** Apply a prefix of the stream. A patch that does not fit returns the baseline. */
export function assemblePrefix(
  baseline: WorkspaceSpec,
  patches: Patch[],
  capabilities: CatalogArg["capabilities"] = WORKSPACE_CAPABILITIES,
): { spec: WorkspaceSpec; failed: boolean } {
  let spec = emptyShell(baseline);
  for (const patch of patches) {
    if (patch.op === "done") continue;
    const applied = apply(spec, patch, capabilities);
    if (!applied.ok) return { spec: cloneSpec(baseline), failed: true };
    spec = applied.spec;
  }
  return { spec, failed: false };
}

export function nextBlockId(spec: WorkspaceSpec): string {
  for (let n = 1; n < 1000; n += 1) {
    const id = `b_${n}`;
    if (!spec.blocks[id]) return id;
  }
  return "b_block";
}

function capabilityIds(spec: WorkspaceSpec, surface: Surface): string[] {
  return (spec.surfaces[surface]?.slots ?? []).map((id) => spec.blocks[id]?.capability).filter((id): id is string => Boolean(id));
}

function unmatched(source: string[], other: string[]): string[] {
  const left = [...other];
  const out: string[] = [];
  for (const id of source) {
    const at = left.indexOf(id);
    if (at >= 0) left.splice(at, 1);
    else out.push(id);
  }
  return out;
}

function englishList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function labelFor(id: string, capabilities: readonly { id: string; label: string }[]): string {
  return capabilities.find((item) => item.id === id)?.label ?? id;
}

/** One sentence per surface that gained, lost, or reordered blocks. */
export function describeSpecDiff(
  accepted: WorkspaceSpec,
  working: WorkspaceSpec,
  capabilities: readonly { id: string; label: string }[] = WORKSPACE_CAPABILITIES,
): string[] {
  const lines: string[] = [];
  for (const surface of SURFACES) {
    const before = capabilityIds(accepted, surface);
    const after = capabilityIds(working, surface);
    const gained = unmatched(after, before).map((id) => labelFor(id, capabilities));
    const lost = unmatched(before, after).map((id) => labelFor(id, capabilities));
    const name = SURFACE_LABEL[surface];
    if (gained.length || lost.length) {
      const parts = [];
      if (gained.length) parts.push(`gains ${englishList(gained)}`);
      if (lost.length) parts.push(`loses ${englishList(lost)}`);
      lines.push(`${name} ${parts.join(", ")}.`);
      continue;
    }
    const sameOrder = before.length === after.length && before.every((id, index) => id === after[index]);
    if (!sameOrder) lines.push(`${name} is in a different order.`);
  }
  return lines;
}

export type { WorkspaceCapability };
