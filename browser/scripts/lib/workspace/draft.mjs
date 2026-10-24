/* Reviewer: pure normalization for untrusted workspace-interview output. It
 * deliberately excludes filesystem access so Node and the desktop webview share one boundary. */
import { INTERRUPT_KINDS } from "./bounds.mjs";
import { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES, WORKSPACE_TEMPLATES } from "./catalog.mjs";

function clean(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Validate untrusted model output before it becomes local durable data. */
export function normalizeWorkflowDraft(input, { now = new Date().toISOString(), sessionId = "" } = {}) {
  const friction = Array.isArray(input?.frictions)
    ? [...new Set(input.frictions.map((x) => oneOf(String(x), WORKFLOW_FRICTIONS, "other")))]
    : [];
  const requested = Array.isArray(input?.requested_integrations)
    ? [...new Set(input.requested_integrations.map((x) => clean(x, 120)).filter(Boolean))].slice(0, 5)
    : [];
  const alternatives = Array.isArray(input?.alternatives)
    ? input.alternatives
        .map((x) => ({ title: clean(x?.title, 100), reason: clean(x?.reason, 240) }))
        .filter((x) => x.title && x.reason)
        .slice(0, 3)
    : [];
  const draft = {
    version: 1,
    status: "draft",
    created_at: now,
    session_id: clean(sessionId, 80),
    ideal_workflow: clean(input?.ideal_workflow, 600),
    frictions: friction,
    preference: oneOf(String(input?.preference), WORKFLOW_PREFERENCES, "one_next_step"),
    constraints: clean(input?.constraints, 500),
    requested_integrations: requested,
    alternatives,
    proposed_template: oneOf(String(input?.proposed_template), WORKSPACE_TEMPLATES.map((x) => x.id), "calm-daily"),
  };
  if (Array.isArray(input?.interrupt_for)) {
    draft.interrupt_for = INTERRUPT_KINDS.filter((kind) => input.interrupt_for.includes(kind));
  }
  return draft;
}
