/**
 * Pure workspace bounds. No filesystem, so the compiler and the app can import
 * this without pulling in node:fs. spec.mjs re-exports it and adds the writers.
 *
 * Architecture: docs/handoff/generative-workspace-architecture-2026-10-21.md.
 */
export const WORKSPACE_SCHEMA_VERSION = 1;

/** The five student tabs. A spec may not invent a surface. */
export const SURFACES = Object.freeze(["today", "week", "courses", "study", "advisor"]);

export const SPEC_STATUS = Object.freeze(["draft", "proposed", "accepted"]);
export const SPEC_ORIGINS = Object.freeze(["interview", "template", "edit", "amendment"]);
export const BLOCK_SIZES = Object.freeze(["full", "half"]);
export const DENSITIES = Object.freeze(["comfortable", "compact"]);

/**
 * `visible_when` is an enum, never an expression. Each one resolves in
 * app/src/workspace/predicates.ts from data the app has already loaded; a
 * predicate may never trigger a fetch, and an unknown one resolves to true so
 * a stale spec hides nothing the student built.
 */
export const PREDICATES = Object.freeze([
  "always",
  "has_changes",
  "due_within_48h",
  "has_exam_within_7d",
  "has_unread_announcements",
  "missing_course_sources",
  "weekend",
  "weekday",
]);

/** The only notification kinds policy allows (app/src/notify/policy.ts). */
export const INTERRUPT_KINDS = Object.freeze(["due_moved", "high_stakes_48h", "sync_broken"]);

/** Closed op set: the live build, student edits, and amendments share one path. */
export const PATCH_OPS = Object.freeze([
  "place",
  "remove",
  "reorder",
  "set_props",
  "set_density",
  "rename",
  "set_home",
  "set_quiet",
  "done",
]);

export const MAX_BLOCKS_PER_SURFACE = 6;
export const MAX_BLOCKS_TOTAL = 24;
export const MAX_HISTORY = 10;
/** The student types the name; Settings renders it back. Bounded, not trusted. */
export const MAX_NAME = 80;

export const REQUESTED_STATES = Object.freeze(["requested", "not_available"]);

const BLOCK_ID = /^[a-z][a-z0-9_]{0,31}$/;

const PROP_TYPES = Object.freeze({ boolean: "boolean", string: "string", number: "number" });

/**
 * A prop whose type the capability does not declare is an error, the same as in
 * app/src/workspace/contracts.ts and app/src-tauri/src/workspace.rs. An unknown
 * key is not: both writers drop it, and this validator has no spec to hand back.
 */
function failBadProps(id, props, schema, fail) {
  if (!props || !schema) return;
  for (const [key, value] of Object.entries(props)) {
    const want = PROP_TYPES[schema[key]?.type];
    if (!want || typeof value === want) continue;
    fail(`block ${id} prop ${key} is not a ${want}`);
  }
}

/**
 * Validate a spec against the catalog. Never repairs: a spec that fails is
 * rejected whole, and the caller falls back to the previous accepted spec or
 * the default. Returns `{ ok, errors }` with plain, loggable reasons.
 *
 * @param {unknown} spec
 * @param {{ capabilities: readonly { id: string, surfaces: readonly string[], sizes: readonly string[], max_instances?: number, requires?: readonly string[] }[] }} catalog
 */
export function validateWorkspaceSpec(spec, { capabilities }) {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  const byId = new Map(capabilities.map((c) => [c.id, c]));

  if (!spec || typeof spec !== "object") return { ok: false, errors: ["spec is not an object"] };
  if (spec.schema_version !== WORKSPACE_SCHEMA_VERSION) fail(`schema_version must be ${WORKSPACE_SCHEMA_VERSION}`);
  if (!SPEC_STATUS.includes(spec.status)) fail("status must be draft, proposed, or accepted");
  if (spec.status === "accepted" && spec.accepted_by !== "student") fail("an accepted spec must be accepted_by student");
  if (spec.density !== undefined && !DENSITIES.includes(spec.density)) fail("density is not a known density");
  if (spec.origin && !SPEC_ORIGINS.includes(spec.origin.kind)) fail("origin.kind is not a known origin");
  if (spec.home !== undefined && !SURFACES.includes(spec.home)) fail("home is not a surface");
  if (spec.name !== undefined && spec.name !== null && (typeof spec.name !== "string" || [...spec.name].length > MAX_NAME))
    fail(`name must be text of at most ${MAX_NAME} characters`);

  const blocks = spec.blocks && typeof spec.blocks === "object" ? spec.blocks : null;
  const surfaces = spec.surfaces && typeof spec.surfaces === "object" ? spec.surfaces : null;
  if (!blocks) fail("blocks is missing");
  if (!surfaces) fail("surfaces is missing");
  if (!blocks || !surfaces) return { ok: false, errors };

  const ids = Object.keys(blocks);
  if (ids.length > MAX_BLOCKS_TOTAL) fail(`more than ${MAX_BLOCKS_TOTAL} blocks`);
  const instances = new Map();
  for (const id of ids) {
    const block = blocks[id];
    if (!BLOCK_ID.test(id)) fail(`block id ${id} is not a safe id`);
    const cap = byId.get(block?.capability);
    if (!cap) {
      fail(`block ${id} names a capability that is not in the catalog`);
      continue;
    }
    if (!BLOCK_SIZES.includes(block.size) || !cap.sizes.includes(block.size)) fail(`block ${id} has a size ${cap.id} does not offer`);
    if (block.visible_when !== undefined && !PREDICATES.includes(block.visible_when)) fail(`block ${id} has an unknown predicate`);
    if (block.props !== undefined && (typeof block.props !== "object" || block.props === null || Array.isArray(block.props))) fail(`block ${id} props is not an object`);
    else failBadProps(id, block.props, cap.props, fail);
    instances.set(cap.id, (instances.get(cap.id) || 0) + 1);
  }
  for (const [capId, n] of instances) {
    const max = byId.get(capId)?.max_instances ?? 1;
    if (n > max) fail(`${capId} appears ${n} times but allows ${max}`);
  }

  for (const key of Object.keys(surfaces)) {
    if (!SURFACES.includes(key)) fail(`${key} is not a surface`);
  }
  const placed = new Set();
  for (const name of SURFACES) {
    const slots = surfaces[name]?.slots;
    if (slots === undefined) continue;
    if (!Array.isArray(slots)) {
      fail(`${name}.slots is not a list`);
      continue;
    }
    if (slots.length > MAX_BLOCKS_PER_SURFACE) fail(`${name} holds more than ${MAX_BLOCKS_PER_SURFACE} blocks`);
    for (const id of slots) {
      if (!Object.hasOwn(blocks, id)) {
        fail(`${name} references unknown block ${String(id).slice(0, 40)}`);
        continue;
      }
      if (placed.has(id)) fail(`block ${id} is placed on more than one surface`);
      placed.add(id);
      const cap = byId.get(blocks[id].capability);
      if (cap && !cap.surfaces.includes(name)) fail(`${cap.id} may not be placed on ${name}`);
    }
  }
  for (const id of ids) {
    if (!placed.has(id)) fail(`block ${id} is defined but never placed`);
  }
  for (const id of placed) {
    for (const need of byId.get(blocks[id].capability)?.requires ?? []) {
      if (![...placed].some((other) => blocks[other].capability === need)) fail(`${blocks[id].capability} requires ${need}`);
    }
  }

  const interrupts = spec.quiet?.interrupt_for;
  if (interrupts !== undefined) {
    if (!Array.isArray(interrupts)) fail("quiet.interrupt_for is not a list");
    else for (const kind of interrupts) if (!INTERRUPT_KINDS.includes(kind)) fail(`${String(kind).slice(0, 40)} is not an allowed interruption`);
  }

  const requested = spec.requested_integrations;
  if (requested !== undefined) {
    if (!Array.isArray(requested)) fail("requested_integrations is not a list");
    else for (const entry of requested) if (entry?.state !== undefined && !REQUESTED_STATES.includes(entry.state)) fail("a requested integration claims a state other than requested/not_available");
  }

  return { ok: errors.length === 0, errors };
}
