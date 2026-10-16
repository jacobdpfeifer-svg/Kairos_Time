/**
 * Writer-side mirror of app/src/missionControl/contracts.ts. Every brief and
 * index is validated here before it is written; a failure is a bug in the
 * assembler, never something to paper over in the renderer.
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_ISLANDS = 4;
export const MAX_ISLANDS = 6;

export const LIMITS = { title: 300, body: 4000, excerpt: 600, line: 400, evidence: 12, checklistMin: 3, checklistMax: 7, requirements: 12 };

export const BRIEF_STATES = ["ready", "partial", "needs_source", "stale"];
export const BRIEF_KINDS = ["exam", "quiz", "math", "writing", "project", "lab", "reading", "discussion", "assignment", "unknown"];
export const EVIDENCE_KINDS = ["canvas", "course_source", "library", "student", "connector", "general_recommendation"];
export const CHECKLIST_KINDS = ["source_backed", "student_setting", "agent_proposal"];
export const ISLAND_STATES = ["normal", "changed", "stale", "needs_attention"];
/** No Canvas submit/comment/discussion-post kind exists, by construction. */
export const ACTION_KINDS = ["study", "open_canvas", "open_source", "ask", "calendar_preview", "email_draft"];
export const AVAILABILITY = ["available", "unavailable", "requires_connection"];
export const FRAME_SECTIONS = ["next_step", "requirements", "checklist", "why", "module", "materials"];

/** Ids become file names: `{course_id}--{assignment_id}.json`. Same rule as canvas.rs valid_course_id. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function clipText(value, max) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fail(path, why) {
  throw new Error(`brief schema: ${path} ${why}`);
}

function str(v, path, max, { nullable = false } = {}) {
  if (v == null && nullable) return;
  if (typeof v !== "string") fail(path, "must be a string");
  if (v.length > max) fail(path, `exceeds ${max} characters`);
}

function oneOf(v, list, path) {
  if (!list.includes(v)) fail(path, `must be one of ${list.join("|")}`);
}

function isoOrNull(v, path) {
  if (v == null) return;
  str(v, path, 64);
  if (!Number.isFinite(Date.parse(v))) fail(path, "must be an ISO timestamp");
}

function color(v, path) {
  str(v, path, 32);
  if (!/^#[0-9A-Fa-f]{6}$/.test(v)) fail(path, "must be #RRGGBB");
}

function action(a, path) {
  str(a.id, `${path}.id`, 128);
  str(a.label, `${path}.label`, 120);
  oneOf(a.kind, ACTION_KINDS, `${path}.kind`);
  oneOf(a.availability, AVAILABILITY, `${path}.availability`);
  str(a.reason, `${path}.reason`, LIMITS.line, { nullable: true });
  str(a.target, `${path}.target`, 2048, { nullable: true });
  if (a.target && a.kind !== "study" && !/^https:\/\//.test(a.target)) fail(`${path}.target`, "must be https");
}

function section(s, path) {
  str(s.id, `${path}.id`, 64);
  str(s.title, `${path}.title`, 120);
  str(s.body, `${path}.body`, LIMITS.body);
  if (s.proposal != null && typeof s.proposal !== "boolean") fail(`${path}.proposal`, "must be boolean");
}

export function validateBrief(b) {
  if (!b || typeof b !== "object") fail("brief", "must be an object");
  if (b.schema_version !== SCHEMA_VERSION) fail("schema_version", `must be ${SCHEMA_VERSION}`);
  for (const k of ["assignment_id", "course_id"]) if (!ID_RE.test(String(b[k]))) fail(k, "is not a safe id");
  if (b.id !== `${b.course_id}--${b.assignment_id}`) fail("id", "must be course_id--assignment_id");
  str(b.title, "title", LIMITS.title);
  str(b.course_label, "course_label", 200);
  color(b.course_color, "course_color");
  oneOf(b.kind, BRIEF_KINDS, "kind");
  oneOf(b.state, BRIEF_STATES, "state");
  isoOrNull(b.due_at, "due_at");
  isoOrNull(b.prepared_at, "prepared_at");
  isoOrNull(b.expires_at, "expires_at");
  str(b.source_fingerprint, "source_fingerprint", 128);
  str(b.next_step, "next_step", LIMITS.line);
  str(b.priority_reason, "priority_reason", 160);
  if (!Array.isArray(b.requirements) || b.requirements.length > LIMITS.requirements) fail("requirements", "bad length");
  b.requirements.forEach((r, i) => str(r, `requirements[${i}]`, LIMITS.line));
  if (!Array.isArray(b.checklist) || b.checklist.length < LIMITS.checklistMin || b.checklist.length > LIMITS.checklistMax)
    fail("checklist", `must have ${LIMITS.checklistMin}–${LIMITS.checklistMax} items`);
  b.checklist.forEach((c, i) => {
    str(c.id, `checklist[${i}].id`, 64);
    str(c.text, `checklist[${i}].text`, LIMITS.line);
    oneOf(c.kind, CHECKLIST_KINDS, `checklist[${i}].kind`);
  });
  str(b.why_it_matters, "why_it_matters", LIMITS.body, { nullable: true });
  if (!Array.isArray(b.evidence) || b.evidence.length > LIMITS.evidence) fail("evidence", "bad length");
  const evidenceIds = new Set();
  b.evidence.forEach((e, i) => {
    str(e.id, `evidence[${i}].id`, 128);
    str(e.label, `evidence[${i}].label`, LIMITS.title);
    oneOf(e.kind, EVIDENCE_KINDS, `evidence[${i}].kind`);
    str(e.locator, `evidence[${i}].locator`, 2048, { nullable: true });
    str(e.excerpt, `evidence[${i}].excerpt`, LIMITS.excerpt, { nullable: true });
    isoOrNull(e.retrieved_at, `evidence[${i}].retrieved_at`);
    evidenceIds.add(e.id);
  });
  const refs = (ids, path) => (ids || []).forEach((id) => evidenceIds.has(id) || fail(path, `cites unknown evidence ${id}`));
  b.checklist.forEach((c, i) => refs(c.evidence_ids, `checklist[${i}]`));
  if (!b.module || typeof b.module !== "object") fail("module", "missing");
  oneOf(b.module.kind, BRIEF_KINDS, "module.kind");
  str(b.module.title, "module.title", 120);
  b.module.sections.forEach((s, i) => {
    section(s, `module.sections[${i}]`);
    refs(s.evidence_ids, `module.sections[${i}]`);
  });
  if (!Array.isArray(b.actions) || !b.actions.length) fail("actions", "must not be empty");
  b.actions.forEach((a, i) => action(a, `actions[${i}]`));
  if (b.actions.filter((a) => a.primary).length !== 1) fail("actions", "must have exactly one primary");
  if (!Array.isArray(b.section_order)) fail("section_order", "missing");
  b.section_order.forEach((s, i) => oneOf(s, FRAME_SECTIONS, `section_order[${i}]`));
  return b;
}

export function validateIsland(island, path = "island") {
  if (island.kind !== "assignment") fail(`${path}.kind`, "must be assignment");
  for (const k of ["assignment_id", "course_id"]) if (!ID_RE.test(String(island[k]))) fail(`${path}.${k}`, "is not a safe id");
  str(island.island_id, `${path}.island_id`, 140);
  str(island.title, `${path}.title`, LIMITS.title);
  color(island.course_color, `${path}.course_color`);
  oneOf(island.assignment_kind, BRIEF_KINDS, `${path}.assignment_kind`);
  oneOf(island.brief_state, BRIEF_STATES, `${path}.brief_state`);
  oneOf(island.state, ISLAND_STATES, `${path}.state`);
  str(island.priority_reason, `${path}.priority_reason`, 160);
  isoOrNull(island.due_at, `${path}.due_at`);
}

export function validateIndex(index) {
  if (index.schema_version !== SCHEMA_VERSION) fail("index.schema_version", `must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(index.assignments) || index.assignments.length > MAX_ISLANDS) fail("index.assignments", `at most ${MAX_ISLANDS}`);
  index.assignments.forEach((a, i) => validateIsland(a, `index.assignments[${i}]`));
  if (!Number.isInteger(index.rest_count) || index.rest_count < 0) fail("index.rest_count", "must be a non-negative integer");
  return index;
}
