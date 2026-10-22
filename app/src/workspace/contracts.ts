/**
 * Reader-side workspace spec. Meaning matches browser/scripts/lib/workspace/spec.mjs.
 * Prop schemas are checked here and in the Rust writer; spec.mjs only checks that
 * props is an object. Unknown prop keys are dropped. A wrong type rejects the spec.
 */
import type { PropSchema } from "./catalog";

export { WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES } from "./catalog";
export type { PropSchema, WorkspaceCapability, WorkspaceTemplate } from "./catalog";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export const SURFACES = ["today", "week", "courses", "study", "advisor"] as const;
export type Surface = (typeof SURFACES)[number];

export const SPEC_STATUS = ["draft", "proposed", "accepted"] as const;
export const SPEC_ORIGINS = ["interview", "template", "edit", "amendment"] as const;
export const BLOCK_SIZES = ["full", "half"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const PREDICATES = [
  "always",
  "has_changes",
  "due_within_48h",
  "has_exam_within_7d",
  "has_unread_announcements",
  "missing_course_sources",
  "weekend",
  "weekday",
] as const;
export const INTERRUPT_KINDS = ["due_moved", "high_stakes_48h", "sync_broken"] as const;
export const REQUESTED_STATES = ["requested", "not_available"] as const;

export const MAX_BLOCKS_PER_SURFACE = 6;
export const MAX_BLOCKS_TOTAL = 24;
/** The student types the name; Settings renders it back. Bounded, not trusted. */
export const MAX_NAME = 80;

export const FALLBACK_NOTICE = "Kairos kept your previous workspace because the new one didn't check out.";

const BLOCK_ID = /^[a-z][a-z0-9_]{0,31}$/;

export type WorkspaceBlock = {
  capability: string;
  size: (typeof BLOCK_SIZES)[number];
  props?: Record<string, unknown>;
  visible_when?: string;
};

export type WorkspaceSpec = {
  schema_version: typeof WORKSPACE_SCHEMA_VERSION;
  status: (typeof SPEC_STATUS)[number];
  spec_id?: string;
  name?: string;
  created_at?: string;
  accepted_at?: string;
  accepted_by?: string;
  origin?: { kind: (typeof SPEC_ORIGINS)[number]; template_id?: string; draft_session_id?: string };
  authorship?: { student_edits?: number; renamed?: boolean; last_edited_at?: string };
  density?: (typeof DENSITIES)[number];
  surfaces: { [K in Surface]?: { slots?: string[] } };
  blocks: Record<string, WorkspaceBlock>;
  /** Absent means Today. Set only when the student accepts a home-screen amendment. */
  home?: Surface;
  quiet?: { interrupt_for?: string[] };
  requested_integrations?: { name?: string; state?: string; heard_at?: string }[];
  entitlement?: "local" | "premium";
};

export type CatalogArg = {
  capabilities: readonly { id: string; surfaces: readonly string[]; sizes: readonly string[]; max_instances?: number; requires?: readonly string[]; props?: PropSchema }[];
};

function includes(list: readonly string[], value: unknown): value is string {
  return typeof value === "string" && list.includes(value);
}

/** Drop unknown prop keys and fill defaults. A wrong type is an error, not a repair. */
export function applyPropSchema(props: unknown, schema: PropSchema | undefined): { ok: true; props: Record<string, unknown> } | { ok: false; error: string } {
  const source = props === undefined ? {} : props;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return { ok: false, error: "props is not an object" };
  const fields = schema ?? {};
  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.default !== undefined) next[key] = field.default;
  }
  for (const [key, value] of Object.entries(source)) {
    const field = fields[key];
    if (!field) continue;
    if (field.type === "boolean" && typeof value !== "boolean") return { ok: false, error: `${key} is not a boolean` };
    if (field.type === "string" && typeof value !== "string") return { ok: false, error: `${key} is not a string` };
    if (field.type === "number" && typeof value !== "number") return { ok: false, error: `${key} is not a number` };
    next[key] = value;
  }
  return { ok: true, props: next };
}

export function validateWorkspaceSpec(spec: unknown, { capabilities }: CatalogArg): { ok: boolean; errors: string[]; spec?: WorkspaceSpec } {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);
  const byId = new Map(capabilities.map((c) => [c.id, c]));

  if (!spec || typeof spec !== "object") return { ok: false, errors: ["spec is not an object"] };
  const raw = spec as Record<string, unknown>;
  if (raw.schema_version !== WORKSPACE_SCHEMA_VERSION) fail(`schema_version must be ${WORKSPACE_SCHEMA_VERSION}`);
  if (!includes(SPEC_STATUS, raw.status)) fail("status must be draft, proposed, or accepted");
  if (raw.status === "accepted" && raw.accepted_by !== "student") fail("an accepted spec must be accepted_by student");
  if (raw.density !== undefined && !includes(DENSITIES, raw.density)) fail("density is not a known density");
  const origin = raw.origin as { kind?: unknown } | undefined;
  if (origin && !includes(SPEC_ORIGINS, origin.kind)) fail("origin.kind is not a known origin");
  if (raw.home !== undefined && !includes(SURFACES, raw.home)) fail("home is not a surface");
  if (raw.name !== undefined && raw.name !== null && (typeof raw.name !== "string" || [...raw.name].length > MAX_NAME))
    fail(`name must be text of at most ${MAX_NAME} characters`);

  const blocks = raw.blocks && typeof raw.blocks === "object" && !Array.isArray(raw.blocks) ? (raw.blocks as Record<string, { capability?: string; size?: string; visible_when?: string; props?: unknown }>) : null;
  const surfaces = raw.surfaces && typeof raw.surfaces === "object" && !Array.isArray(raw.surfaces) ? (raw.surfaces as Record<string, { slots?: unknown }>) : null;
  if (!blocks) fail("blocks is missing");
  if (!surfaces) fail("surfaces is missing");
  if (!blocks || !surfaces) return { ok: false, errors };

  const ids = Object.keys(blocks);
  if (ids.length > MAX_BLOCKS_TOTAL) fail(`more than ${MAX_BLOCKS_TOTAL} blocks`);
  const cleaned = new Map<string, Record<string, unknown>>();
  const instances = new Map<string, number>();
  for (const id of ids) {
    const block = blocks[id];
    if (!BLOCK_ID.test(id)) fail(`block id ${id} is not a safe id`);
    const cap = byId.get(block?.capability ?? "");
    if (!cap) {
      fail(`block ${id} names a capability that is not in the catalog`);
      continue;
    }
    if (!includes(BLOCK_SIZES, block.size) || !cap.sizes.includes(block.size)) fail(`block ${id} has a size ${cap.id} does not offer`);
    if (block.visible_when !== undefined && !includes(PREDICATES, block.visible_when)) fail(`block ${id} has an unknown predicate`);
    if (block.props !== undefined && (typeof block.props !== "object" || block.props === null || Array.isArray(block.props))) fail(`block ${id} props is not an object`);
    else {
      const applied = applyPropSchema(block.props, cap.props);
      if (!applied.ok) fail(`block ${id} prop ${applied.error}`);
      else cleaned.set(id, applied.props);
    }
    instances.set(cap.id, (instances.get(cap.id) || 0) + 1);
  }
  for (const [capId, n] of instances) {
    const max = byId.get(capId)?.max_instances ?? 1;
    if (n > max) fail(`${capId} appears ${n} times but allows ${max}`);
  }

  for (const key of Object.keys(surfaces)) {
    if (!includes(SURFACES, key)) fail(`${key} is not a surface`);
  }
  const placed = new Set<string>();
  for (const name of SURFACES) {
    const slots = surfaces[name]?.slots;
    if (slots === undefined) continue;
    if (!Array.isArray(slots)) {
      fail(`${name}.slots is not a list`);
      continue;
    }
    if (slots.length > MAX_BLOCKS_PER_SURFACE) fail(`${name} holds more than ${MAX_BLOCKS_PER_SURFACE} blocks`);
    for (const id of slots) {
      if (typeof id !== "string" || !Object.hasOwn(blocks, id)) {
        fail(`${name} references unknown block ${String(id).slice(0, 40)}`);
        continue;
      }
      if (placed.has(id)) fail(`block ${id} is placed on more than one surface`);
      placed.add(id);
      const cap = byId.get(blocks[id].capability ?? "");
      if (cap && !cap.surfaces.includes(name)) fail(`${cap.id} may not be placed on ${name}`);
    }
  }
  for (const id of ids) {
    if (!placed.has(id)) fail(`block ${id} is defined but never placed`);
  }
  for (const id of placed) {
    for (const need of byId.get(blocks[id].capability ?? "")?.requires ?? []) {
      if (![...placed].some((other) => blocks[other].capability === need)) fail(`${blocks[id].capability} requires ${need}`);
    }
  }

  const quiet = raw.quiet as { interrupt_for?: unknown } | undefined;
  const interrupts = quiet?.interrupt_for;
  if (interrupts !== undefined) {
    if (!Array.isArray(interrupts)) fail("quiet.interrupt_for is not a list");
    else for (const kind of interrupts) if (!includes(INTERRUPT_KINDS, kind)) fail(`${String(kind).slice(0, 40)} is not an allowed interruption`);
  }

  const requested = raw.requested_integrations;
  if (requested !== undefined) {
    if (!Array.isArray(requested)) fail("requested_integrations is not a list");
    else for (const entry of requested) {
      const state = (entry as { state?: unknown })?.state;
      if (state !== undefined && !includes(REQUESTED_STATES, state)) fail("a requested integration claims a state other than requested/not_available");
    }
  }

  if (errors.length) return { ok: false, errors };
  const specOut = JSON.parse(JSON.stringify(raw)) as WorkspaceSpec;
  for (const [id, props] of cleaned) specOut.blocks[id].props = props;
  return { ok: true, errors, spec: specOut };
}

const block = (capability: string): WorkspaceBlock => ({ capability, size: "full", props: {}, visible_when: "always" });

/** The current shell: one existing screen on each tab. */
export const DEFAULT_SPEC: WorkspaceSpec = {
  schema_version: WORKSPACE_SCHEMA_VERSION,
  status: "accepted",
  spec_id: "ws_default",
  name: "Kairos",
  created_at: "2026-10-21T00:00:00.000Z",
  accepted_at: "2026-10-21T00:00:00.000Z",
  accepted_by: "student",
  density: "comfortable",
  surfaces: {
    today: { slots: ["b_today"] },
    week: { slots: ["b_week"] },
    courses: { slots: ["b_courses"] },
    study: { slots: ["b_study"] },
    advisor: { slots: ["b_advisor"] },
  },
  blocks: {
    b_today: block("today.next_action"),
    b_week: block("week.plan"),
    b_courses: block("courses.sources"),
    b_study: block("study.practice"),
    b_advisor: block("advisor.plan"),
  },
  quiet: { interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"] },
  requested_integrations: [],
  entitlement: "local",
};

export function isSurface(tab: string): tab is Surface {
  return (SURFACES as readonly string[]).includes(tab);
}
