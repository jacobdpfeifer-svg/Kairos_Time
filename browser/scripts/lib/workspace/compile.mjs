/**
 * Turn an interview draft into a workspace spec.
 *
 * Pure: no filesystem, no network, no clock, no model, no randomness.
 * The draft may choose a preference, frictions, and which of the three
 * notification kinds to keep. It may not choose a slot, a size, a predicate,
 * or a component. Layout comes from the reviewed catalog only.
 *
 * Architecture: docs/handoff/generative-workspace-architecture-2026-10-21.md §4.
 */
import { INTERRUPT_KINDS, MAX_BLOCKS_PER_SURFACE, MAX_BLOCKS_TOTAL, SURFACES, WORKSPACE_SCHEMA_VERSION, validateWorkspaceSpec } from "./bounds.mjs";
import { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES, WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES } from "./catalog.mjs";
import { suggestTemplates } from "./rank.mjs";
import { integrationRequestState } from "../tool-request-state.mjs";

const ORIENTATION = Object.freeze({
  one_next_step: "one next step",
  weekly_overview: "a weekly overview",
  course_by_course: "course by course",
  study_first: "study first",
  quiet_minimal: "the quietest view",
});

const LEAD = Object.freeze({
  one_next_step: "today.next_action",
  quiet_minimal: "today.next_action",
  weekly_overview: "week.plan",
  course_by_course: "courses.sources",
  study_first: "study.practice",
});

/** Lower catalog weight comes first. Ties break by capability id. Amendments reuse this order. */
export function byCapabilityWeight(a, b, catalog = WORKSPACE_CAPABILITIES) {
  const weight = (id) => {
    const cap = catalog.find((item) => item.id === id);
    return Number.isFinite(cap?.weight) ? cap.weight : 1000;
  };
  return weight(a) - weight(b) || String(a).localeCompare(String(b));
}

const HOME = Object.freeze({
  one_next_step: "today",
  quiet_minimal: "today",
  weekly_overview: "week",
  course_by_course: "courses",
  study_first: "study",
});

/**
 * The tab a stated orientation opens on. The one authored copy: the template
 * pick in app/src/workspace/templates.ts uses it too, so choosing "Weekly
 * planner" at first run lands the same way the interview would.
 */
export function homeForPreference(preference) {
  return HOME[preference] ?? "today";
}

const FRICTION_PHRASE = Object.freeze({
  finding_next_action: "finding what to do next",
  tracking_deadlines: "tracking deadlines",
  starting_work: "starting work",
  planning_time: "planning time",
  remembering_course_context: "remembering course context",
  turning_notes_into_study: "turning notes into study",
  staying_calm: "staying calm",
});

function stamp(now) {
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isFinite(ms)) throw new Error("compileWorkspace: now is required");
    return now.toISOString();
  }
  if (typeof now !== "string" || now.trim() === "") throw new Error("compileWorkspace: now is required");
  return now;
}

function surfaceOf(cap) {
  if (!cap || !Array.isArray(cap.surfaces)) return null;
  return SURFACES.find((name) => cap.surfaces.includes(name)) ?? null;
}

function onSurface(ids, surface, byId) {
  return ids.filter((id) => surfaceOf(byId.get(id)) === surface).length;
}

function canPlace(cap, ids, byId) {
  const surface = surfaceOf(cap);
  if (!surface) return false;
  if (onSurface(ids, surface, byId) >= MAX_BLOCKS_PER_SURFACE) return false;
  if (ids.length >= MAX_BLOCKS_TOTAL) return false;
  const max = cap.max_instances ?? 1;
  if (ids.filter((id) => id === cap.id).length >= max) return false;
  return true;
}

function clipWords(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const space = slice.lastIndexOf(" ");
  if (space <= 0) return text.slice(0, max).trimEnd();
  return slice.slice(0, space).trimEnd();
}

function studentQuote(ideal, constraints) {
  const source = ideal.trim() || constraints.trim();
  if (!source) return "";
  return clipWords(source, 120).replaceAll('"', "'").trim();
}

function frictionPhrase(cap, frictions) {
  const supports = new Set(cap.supports || []);
  const match = WORKFLOW_FRICTIONS.find((item) => item !== "other" && frictions.includes(item) && supports.has(item));
  return match ? FRICTION_PHRASE[match] : "";
}

function sentence(cap, { quote, frictionAdded, preference, frictions }) {
  const label = cap.label || cap.id;
  if (quote) {
    const line = `${label} is here because you said "${quote}"`;
    return /[.!?]$/.test(quote) ? line : `${line}.`;
  }
  if (frictionAdded) {
    const phrase = frictionPhrase(cap, frictions);
    if (phrase) return `${label} is here because you said the hard part is ${phrase}.`;
  }
  return `${label} is here because you asked for ${ORIENTATION[preference]}.`;
}

function integrationNames(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.replace(/\s+/g, " ").trim();
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (names.length === 5) break;
  }
  return names;
}

/**
 * @param {unknown} draft
 * @param {{ catalog?: readonly object[], templates?: readonly object[], now: string | Date }} options
 * @returns {{ spec: object, patches: object[], rationale: Record<string, string> }}
 */
export function compileWorkspace(draft, { catalog = WORKSPACE_CAPABILITIES, templates = WORKSPACE_TEMPLATES, now } = {}) {
  const createdAt = stamp(now);
  const source = draft && typeof draft === "object" ? draft : {};
  const preference = WORKFLOW_PREFERENCES.includes(source.preference) ? source.preference : "one_next_step";
  const frictions = [...new Set((Array.isArray(source.frictions) ? source.frictions : []).filter((item) => WORKFLOW_FRICTIONS.includes(item)))];
  const needs = new Set(frictions.filter((item) => item !== "other"));
  const ideal = typeof source.ideal_workflow === "string" ? source.ideal_workflow : "";
  const constraints = typeof source.constraints === "string" ? source.constraints : "";
  const sessionId = typeof source.session_id === "string" ? source.session_id.trim() : "";
  const quote = studentQuote(ideal, constraints);
  const interruptFor = Array.isArray(source.interrupt_for)
    ? INTERRUPT_KINDS.filter((kind) => source.interrupt_for.includes(kind))
    : [...INTERRUPT_KINDS];

  const byId = new Map(catalog.map((cap) => [cap.id, cap]));
  const [winner] = suggestTemplates({ preference, frictions }, { catalog, templates });
  if (!winner) throw new Error("compileWorkspace: no template");

  const excluded = new Set();
  if (preference === "quiet_minimal") excluded.add("today.changes");

  const chosen = [];
  for (const id of winner.blocks) {
    const cap = byId.get(id);
    if (!cap || cap.availability === "optional_connector" || excluded.has(id)) continue;
    if (!canPlace(cap, chosen, byId)) continue;
    chosen.push(id);
  }

  const candidates = catalog
    .filter((cap) => cap && !chosen.includes(cap.id) && !excluded.has(cap.id) && cap.availability === "available")
    .map((cap) => ({ cap, overlap: (cap.supports || []).filter((need) => needs.has(need)).length }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || byCapabilityWeight(a.cap.id, b.cap.id, catalog));

  const added = new Set();
  for (const { cap } of candidates) {
    if (added.size >= 2) break;
    if (!canPlace(cap, chosen, byId)) continue;
    chosen.push(cap.id);
    added.add(cap.id);
  }

  const resolved = resolveRequires(chosen, { byId, excluded });
  const lead = LEAD[preference];
  const groups = Object.fromEntries(SURFACES.map((name) => [name, []]));
  for (const id of resolved) {
    const surface = surfaceOf(byId.get(id));
    if (surface) groups[surface].push(id);
  }
  for (const name of SURFACES) {
    groups[name].sort((a, b) => {
      const aLead = a === lead ? 0 : 1;
      const bLead = b === lead ? 0 : 1;
      if (aLead !== bLead) return aLead - bLead;
      return byCapabilityWeight(a, b, catalog);
    });
  }

  const home = HOME[preference];
  const blocks = {};
  const surfaces = {};
  const rationale = {};
  for (const name of SURFACES) surfaces[name] = { slots: [] };
  for (const name of SURFACES) {
    for (const id of groups[name]) {
      const cap = byId.get(id);
      const blockId = `b_${id.replaceAll(".", "_")}`;
      const block = {
        capability: id,
        size: cap.sizes[0],
        props: {},
        visible_when: id === "today.changes" ? "has_changes" : "always",
      };
      blocks[blockId] = block;
      surfaces[name].slots.push(blockId);
      rationale[blockId] = sentence(cap, { quote, frictionAdded: added.has(id), preference, frictions });
    }
  }

  const origin = { kind: "interview", template_id: winner.id };
  if (sessionId) origin.draft_session_id = sessionId;

  const spec = {
    schema_version: WORKSPACE_SCHEMA_VERSION,
    status: "proposed",
    spec_id: `ws_${winner.id.replace(/-/g, "_")}`,
    created_at: createdAt,
    origin,
    density: "comfortable",
    home,
    surfaces,
    blocks,
    quiet: { interrupt_for: interruptFor },
    requested_integrations: integrationNames(source.requested_integrations).map((name) => ({
      name,
      state: integrationRequestState(name),
      heard_at: createdAt,
    })),
    entitlement: "local",
  };

  const checked = validateWorkspaceSpec(spec, { capabilities: catalog });
  if (!checked.ok) throw new Error(`compileWorkspace: spec failed validation: ${checked.errors.join("; ")}`);

  const places = [];
  for (const name of SURFACES) {
    for (const blockId of surfaces[name].slots) {
      const block = blocks[blockId];
      places.push({
        op: "place",
        surface: name,
        block_id: blockId,
        index: 0,
        block: { capability: block.capability, size: block.size, props: {}, visible_when: block.visible_when },
        narration: rationale[blockId],
      });
    }
  }

  const patches = [
    { op: "set_density", density: "comfortable" },
    { op: "set_home", home },
    { op: "set_quiet", interrupt_for: interruptFor },
    ...landingOrder(places, { byId, surfaces }),
    { op: "done" },
  ];

  return { spec, patches, rationale };
}

/**
 * The order the live build can land these blocks in, so that every prefix of
 * the stream is itself a valid spec: a block never lands before a companion its
 * capability `requires`. Without a `requires` edge the order is unchanged.
 *
 * Each `index` is then the block's position among the siblings that have already
 * landed, not its final slot number, so replaying any prefix leaves each surface
 * in a subsequence of its final order and the last frame is the spec exactly.
 */
function landingOrder(places, { byId, surfaces }) {
  const remaining = [...places];
  const ordered = [];
  const landed = new Set();
  while (remaining.length > 0) {
    const ready = remaining.findIndex((patch) => (byId.get(patch.block.capability)?.requires ?? []).every((need) => landed.has(need)));
    // A requires cycle can never reach a valid spec. Keep the compiler's order
    // and let validateWorkspaceSpec be the one to say so.
    const [next] = ready >= 0 ? remaining.splice(ready, 1) : remaining.splice(0, 1);
    landed.add(next.block.capability);
    ordered.push(next);
  }
  const placed = Object.fromEntries(SURFACES.map((name) => [name, []]));
  for (const patch of ordered) {
    const finalIndex = surfaces[patch.surface].slots.indexOf(patch.block_id);
    patch.index = placed[patch.surface].filter((at) => at < finalIndex).length;
    placed[patch.surface].push(finalIndex);
  }
  return ordered;
}

function resolveRequires(chosen, { byId, excluded }) {
  const result = [...chosen];
  for (let guard = 0; guard < 32; guard += 1) {
    let changed = false;
    for (const id of [...result]) {
      const cap = byId.get(id);
      if (!cap) continue;
      for (const need of cap.requires ?? []) {
        if (result.includes(need)) continue;
        const companion = byId.get(need);
        if (!companion) continue;
        if (excluded.has(need) || companion.availability === "optional_connector" || !canPlace(companion, result, byId)) {
          const index = result.indexOf(id);
          if (index >= 0) result.splice(index, 1);
          changed = true;
          break;
        }
        result.push(need);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return result;
}
