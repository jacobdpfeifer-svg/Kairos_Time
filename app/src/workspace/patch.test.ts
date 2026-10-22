import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC, type CatalogArg, type WorkspaceSpec } from "./contracts";
import {
  apply,
  assemblePrefix,
  describeSpecDiff,
  emptyHistory,
  emptyShell,
  invert,
  patchesFromSpec,
  proposalFromAccepted,
  pushPatch,
  redoPatch,
  studentEditCount,
  undoPatch,
  type Patch,
} from "./patch";

const caps: CatalogArg["capabilities"] = [
  {
    id: "a",
    surfaces: ["today"],
    sizes: ["full"],
    max_instances: 6,
    requires: [],
    props: { show_reason: { type: "boolean", default: true } },
  },
  { id: "b", surfaces: ["today"], sizes: ["full"], max_instances: 2, requires: ["a"], props: {} },
  { id: "c", surfaces: ["week"], sizes: ["full"], max_instances: 1, requires: [], props: {} },
];

function shell(): WorkspaceSpec {
  return emptyShell({
    ...DEFAULT_SPEC,
    status: "proposed",
    blocks: {},
    surfaces: { today: { slots: [] }, week: { slots: [] }, courses: { slots: [] }, study: { slots: [] }, advisor: { slots: [] } },
  });
}

function block(capability: string) {
  return { capability, size: "full" as const, props: {}, visible_when: "always" };
}

function mulberry32(seed: number) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("workspace patches", () => {
  it("rebuilds a spec from place ops and refuses a seventh block", () => {
    const proposal = proposalFromAccepted(DEFAULT_SPEC);
    const built = assemblePrefix(proposal.baseline, patchesFromSpec(proposal.baseline));
    expect(built.failed).toBe(false);
    expect(built.spec.blocks).toEqual(proposal.baseline.blocks);
    expect(built.spec.surfaces).toEqual(proposal.baseline.surfaces);
    expect(built.spec.status).toBe("proposed");
    expect(built.spec.accepted_by).toBeUndefined();

    let spec = shell();
    for (let n = 0; n < 6; n += 1) {
      const placed = apply(spec, { op: "place", surface: "today", block_id: `b_${n}`, index: n, block: block("a") }, caps);
      if (!placed.ok) throw new Error(placed.error);
      expect(placed.ok).toBe(true);
      if (placed.ok) spec = placed.spec;
    }
    const refused = apply(spec, { op: "place", surface: "today", block_id: "b_6", index: 6, block: block("a") }, caps);
    expect(refused.ok).toBe(false);
    expect(spec.surfaces.today?.slots).toHaveLength(6);
  });

  it("round-trips apply and invert, including generated sequences", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const rand = mulberry32(seed);
      let spec = shell();
      let history = emptyHistory();
      const start = stable(spec);
      for (let step = 0; step < 20; step += 1) {
        const before = spec;
        const patch = candidate(spec, rand);
        const snapshot = JSON.stringify(spec);
        const applied = apply(spec, patch, caps);
        expect(JSON.stringify(spec)).toBe(snapshot);
        if (!applied.ok) continue;
        const inverse = invert(patch, before);
        const back = apply(applied.spec, inverse, caps);
        expect(back.ok).toBe(true);
        if (back.ok) expect(stable(back.spec)).toEqual(stable(before));
        const again = invert(inverse, applied.spec);
        expect(again.op).toBe(patch.op);
        if (patch.op === "rename" && again.op === "rename") expect(again.name).toBe(patch.name.trim() ? patch.name.trim() : "");
        if (patch.op === "reorder" && again.op === "reorder") expect(again.index).toBe(patch.index);
        if (patch.op === "place" && again.op === "place") expect(again.index).toBe(patch.index);
        const pushed = pushPatch(before, history, patch, caps);
        expect(pushed.ok).toBe(true);
        if (pushed.ok) {
          spec = pushed.spec;
          history = pushed.history;
        }
      }
      const end = stable(spec);
      while (history.undo.length) {
        const step = undoPatch(spec, history, caps);
        spec = step.spec;
        history = step.history;
      }
      expect(stable(spec)).toEqual(start);
      expect(studentEditCount(history)).toBe(0);
      while (history.redo.length) {
        const step = redoPatch(spec, history, caps);
        spec = step.spec;
        history = step.history;
      }
      expect(stable(spec)).toEqual(end);
    }
  });

  it("counts reorder, remove, add, and rename, and not density", () => {
    let spec = shell();
    let history = emptyHistory();
    const place = pushPatch(spec, history, { op: "place", surface: "today", block_id: "b_1", index: 0, block: block("a") }, caps);
    expect(place.ok).toBe(true);
    if (!place.ok) return;
    spec = place.spec;
    history = place.history;
    const density = pushPatch(spec, history, { op: "set_density", density: "compact" }, caps);
    expect(density.ok).toBe(true);
    if (!density.ok) return;
    spec = density.spec;
    history = density.history;
    expect(studentEditCount(history)).toBe(1);
    const named = pushPatch(spec, history, { op: "rename", name: "Morning desk" }, caps);
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(studentEditCount(named.history)).toBe(2);
    const undone = undoPatch(named.spec, named.history, caps);
    expect(undone.spec.name).toBe("Kairos");
    expect(studentEditCount(undone.history)).toBe(1);
    const redone = redoPatch(undone.spec, undone.history, caps);
    expect(redone.spec.name).toBe("Morning desk");
    expect(studentEditCount(redone.history)).toBe(2);
  });

  it("round-trips a home change and refuses a wider interrupt list", () => {
    const moved = apply(DEFAULT_SPEC, { op: "set_home", home: "week" });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.spec.home).toBe("week");
    const back = apply(moved.spec, invert({ op: "set_home", home: "week" }, DEFAULT_SPEC));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.spec.home).toBeUndefined();

    const quiet = apply(DEFAULT_SPEC, { op: "set_quiet", interrupt_for: ["high_stakes_48h", "sync_broken"] });
    expect(quiet.ok).toBe(true);
    if (!quiet.ok) return;
    expect(quiet.spec.quiet?.interrupt_for).toEqual(["high_stakes_48h", "sync_broken"]);
    expect(invert({ op: "set_quiet", interrupt_for: ["high_stakes_48h", "sync_broken"] }, DEFAULT_SPEC)).toMatchObject({
      op: "set_quiet",
      interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
    });
    const wider = apply(quiet.spec, { op: "set_quiet", interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"] });
    expect(wider.ok).toBe(false);
  });

  it("describes gains, losses, and a new order", () => {
    const base = shell();
    base.blocks = { b1: block("today.next_action"), b2: block("week.plan") };
    base.surfaces.today = { slots: ["b1"] };
    const added = shell();
    added.blocks = { b1: block("today.next_action"), b2: block("week.plan") };
    added.surfaces.today = { slots: ["b1", "b2"] };
    expect(describeSpecDiff(base, added)).toEqual(["Today gains Weekly time plan."]);
    expect(describeSpecDiff(added, base)).toEqual(["Today loses Weekly time plan."]);
    const swapped = shell();
    swapped.blocks = { b1: block("today.next_action"), b2: block("week.plan") };
    swapped.surfaces.today = { slots: ["b2", "b1"] };
    expect(describeSpecDiff(added, swapped)).toEqual(["Today is in a different order."]);
    const replaced = shell();
    replaced.blocks = { b2: block("week.plan") };
    replaced.surfaces.today = { slots: ["b2"] };
    expect(describeSpecDiff(base, replaced)).toEqual(["Today gains Weekly time plan, loses One clear next action."]);
  });
});

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function candidate(spec: WorkspaceSpec, rand: () => number): Patch {
  const today = spec.surfaces.today?.slots ?? [];
  const roll = rand();
  if (roll < 0.12) return { op: "place", surface: "today", block_id: "b_bad", index: 0, block: block("missing") };
  if (roll < 0.28) {
    const id = `b_${today.length + 1}`;
    return { op: "place", surface: "today", block_id: id, index: today.length, block: block(rand() < 0.5 ? "a" : "b") };
  }
  if (roll < 0.4 && today.length) return { op: "remove", surface: "today", block_id: today[Math.floor(rand() * today.length)] };
  if (roll < 0.55 && today.length > 1) {
    const from = Math.floor(rand() * today.length);
    const index = Math.min(today.length - 1, from + 1);
    return { op: "reorder", surface: "today", block_id: today[from], index };
  }
  if (roll < 0.7) return { op: "rename", name: rand() < 0.2 ? "" : `Desk ${Math.floor(rand() * 5)}` };
  if (roll < 0.82) return { op: "set_density", density: rand() < 0.5 ? "compact" : "comfortable" };
  if (roll < 0.9) return { op: "set_home", home: rand() < 0.2 ? null : rand() < 0.5 ? "week" : "today" };
  if (roll < 0.96) return { op: "set_quiet", interrupt_for: ["due_moved", "nope"] };
  if (today[0] && spec.blocks[today[0]]?.capability === "a") {
    return { op: "set_props", block_id: today[0], props: { show_reason: rand() < 0.5 } };
  }
  return { op: "done" };
}
