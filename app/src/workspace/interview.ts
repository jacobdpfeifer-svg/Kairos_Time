/**
 * Typed workspace interview. Same questions as the voice onboarding guide.
 * Answers become a draft only after normalizeWorkflowDraft. No model, no key.
 */
import { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES } from "../../../browser/scripts/lib/workspace/catalog.mjs";
import { normalizeWorkflowDraft } from "../../../browser/scripts/lib/workspace/draft.mjs";
import { suggestTemplates } from "../../../browser/scripts/lib/workspace/rank.mjs";

export { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES };

export const FRICTION_LABEL: Record<string, string> = {
  finding_next_action: "Finding what to do next",
  tracking_deadlines: "Tracking deadlines",
  starting_work: "Starting the work",
  planning_time: "Planning the time",
  remembering_course_context: "Remembering a course",
  turning_notes_into_study: "Turning notes into study",
  staying_calm: "Staying calm",
  other: "Something else",
};

export const PREFERENCE_LABEL: Record<string, string> = {
  one_next_step: "One next step",
  weekly_overview: "A weekly overview",
  course_by_course: "Course by course",
  study_first: "Study first",
  quiet_minimal: "The quietest view",
};

export const INTERRUPT_LABEL: Record<string, string> = {
  due_moved: "A due date moves",
  high_stakes_48h: "Something high stakes is due within 48 hours",
  sync_broken: "Canvas sign-in breaks",
};

export const INTERRUPT_KINDS = ["due_moved", "high_stakes_48h", "sync_broken"] as const;

export type InterviewAnswers = {
  frictions: string[];
  between: string;
  canvas: string;
  postpone: string;
  ideal: string;
  preference: string;
  /** Null when the interruption question was skipped, so the compiler keeps the usual three. */
  interrupt_for: string[] | null;
  tools: string;
  constraints: string;
};

export function emptyAnswers(): InterviewAnswers {
  return {
    frictions: [],
    between: "",
    canvas: "",
    postpone: "",
    ideal: "",
    preference: "",
    interrupt_for: null,
    tools: "",
    constraints: "",
  };
}

export function toolNames(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** A stored file is usable only as a draft. Layout fields never come from it. */
export function draftFromStored(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as { status?: unknown }).status !== "draft") return null;
  return normalizeWorkflowDraft(raw);
}

export function draftFromAnswers(answers: InterviewAnswers, now = new Date().toISOString()) {
  const frictions = answers.frictions.filter((id) => (WORKFLOW_FRICTIONS as readonly string[]).includes(id)).slice(0, 3);
  const preference = (WORKFLOW_PREFERENCES as readonly string[]).includes(answers.preference) ? answers.preference : "one_next_step";
  const ideal = [answers.between, answers.canvas, answers.postpone, answers.ideal]
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const ranked = suggestTemplates({ preference, frictions });
  const input: Record<string, unknown> = {
    ideal_workflow: ideal,
    frictions,
    preference,
    constraints: answers.constraints,
    proposed_template: ranked[0]?.id ?? "calm-daily",
    requested_integrations: toolNames(answers.tools),
  };
  if (answers.interrupt_for) input.interrupt_for = answers.interrupt_for;
  return normalizeWorkflowDraft(input, { now });
}
