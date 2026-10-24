/**
 * Read-only renderer contract for Mission Control.
 *
 * The native/core layer owns projection assembly and validation. React never
 * derives a brief by scraping Canvas or constructs an actuator authorization.
 * See docs/handoff/mission-control-assignment-briefs-architecture-2026-10-15.md.
 *
 * Mirrored by browser/scripts/lib/briefs/schema.mjs (writer-side validation)
 * and app/src-tauri/src/briefs.rs (reader-side bounds).
 */

export const MISSION_CONTROL_SCHEMA_VERSION = 1 as const;

/** Four by default, six at most; the long tail lives in Week. */
export const DEFAULT_ISLANDS = 4;
export const MAX_ISLANDS = 6;

export type BriefState = "ready" | "partial" | "needs_source" | "stale";
export type BriefKind = "exam" | "quiz" | "math" | "writing" | "project" | "lab" | "reading" | "discussion" | "assignment" | "unknown";
export type EvidenceKind = "canvas" | "course_source" | "library" | "student" | "connector" | "general_recommendation";
export type ChecklistKind = "source_backed" | "student_setting" | "agent_proposal";
export type IslandState = "normal" | "changed" | "stale" | "needs_attention";

/** The only things a brief can offer. There is no Canvas submit, comment, or post kind — ever. */
export const BRIEF_ACTION_KINDS = ["study", "open_canvas", "open_source", "ask", "calendar_preview", "email_draft"] as const;
export type BriefActionKind = (typeof BRIEF_ACTION_KINDS)[number];

/** Frame sections the student's ordering preference may reorder. Requirements and sources always render. */
export type FrameSection = "next_step" | "requirements" | "checklist" | "why" | "module" | "materials";

export type BriefEvidence = {
  id: string;
  label: string;
  kind: EvidenceKind;
  locator?: string | null;
  retrieved_at?: string | null;
  excerpt?: string | null;
  fingerprint?: string | null;
};

export type BriefChecklistItem = {
  id: string;
  text: string;
  kind: ChecklistKind;
  done?: boolean;
  evidence_ids?: string[];
};

export type BriefAction = {
  id: string;
  label: string;
  kind: BriefActionKind;
  primary?: boolean;
  /** Presentation hint only. The executor still applies its own guard. */
  availability: "available" | "unavailable" | "requires_connection";
  reason?: string;
  /** Where the action goes: a Canvas/source https URL, or an exam id for Study. */
  target?: string | null;
};

export type BriefModuleSection = {
  id: string;
  title: string;
  body: string;
  evidence_ids?: string[];
  /** Agent-proposed (an outline, a practice path): editable, never the instructor's answer. */
  proposal?: boolean;
};

export type BriefModule = {
  kind: BriefKind;
  title: string;
  sections: BriefModuleSection[];
};

export type AssignmentBrief = {
  schema_version: typeof MISSION_CONTROL_SCHEMA_VERSION;
  id: string;
  assignment_id: string;
  course_id: string;
  /** Canvas work-state id when the projection has this assignment. Ranking does not use it. */
  work_item_id?: string;
  course_label: string;
  course_color: string;
  title: string;
  kind: BriefKind;
  due_at: string | null;
  points_possible?: number | null;
  state: BriefState;
  /** Plain-language gaps when state is partial / needs_source / stale. */
  gaps?: string[];
  prepared_at: string;
  expires_at: string | null;
  source_fingerprint: string;
  next_step: string;
  priority_reason: string;
  requirements: string[];
  checklist: BriefChecklistItem[];
  why_it_matters?: string | null;
  /** True when why_it_matters is a general recommendation rather than course evidence. */
  why_is_general?: boolean;
  evidence: BriefEvidence[];
  module: BriefModule;
  actions: BriefAction[];
  /** Presentation order chosen from the student's brief preferences. */
  section_order: FrameSection[];
  /** Explicitly requested AI enrichment, kept separate from deterministic truth. */
  enrichment?: BriefEnrichment | null;
};

export type BriefEnrichment = {
  prepared_at: string;
  source_fingerprint: string;
  state: "partial" | "ready";
  sections: BriefModuleSection[];
  gaps: string[];
};

export type AssignmentIsland = {
  kind: "assignment";
  island_id: string;
  assignment_id: string;
  course_id: string;
  title: string;
  course_label: string;
  course_color: string;
  due_at: string | null;
  assignment_kind: BriefKind;
  brief_state: BriefState;
  state: IslandState;
  priority_reason: string;
  rank: number;
  /** Fingerprint of the brief on disk; a mismatch with an open brief means "updated since prepared". */
  source_fingerprint: string;
  /** Exam-week reduction: when set, other islands render compact. */
  focus?: boolean;
};

export type CalendarProposal = {
  suggestion_id: string;
  summary: string;
  start: string;
  end: string;
  why: string;
  course_color: string | null;
};

export type EmailContext = { id: string; subject: string; from: string; received: string | null };

export type EmailDraftSummary = {
  draft_id: string;
  to: string;
  subject: string;
  updated_at: string;
  status: "draft" | "reviewed";
};

export type SendCapability = { available: boolean; reason: string };

export type OperationsIsland = {
  kind: "calendar" | "email";
  island_id: string;
  title: string;
  summary: string;
  state: "ready" | "attention" | "unavailable";
  action: BriefAction;
  calendar?: CalendarProposal | null;
  email?: { context: EmailContext[]; drafts: EmailDraftSummary[]; send: SendCapability } | null;
};

export type MissionControlSurface = {
  schema_version: typeof MISSION_CONTROL_SCHEMA_VERSION;
  generated_at: string;
  today: string;
  assignments: AssignmentIsland[];
  operations: OperationsIsland[];
  /** Open work not shown here; "See the rest in Week". */
  rest_count: number;
  /** The student selection, persisted only for the current local day. */
  selected_assignment_id: string | null;
  /** False until a brief projection exists (first sync not yet run). */
  prepared: boolean;
  /** Set when the last rebuild failed. The previous projection, if any, is still shown. */
  briefs_error?: string | null;
};

export type BriefPreferences = {
  schema_version: 1;
  paper_first: "outline" | "requirements" | "next_step";
  problem_set_first: "concept_map" | "worked_example_link" | "next_step";
  default_order: "next_step_first" | "requirements_first";
  /** Consenting beta testers only; random, local. */
  beta_opt_in?: boolean;
  beta_arm?: "next_step_first" | "requirements_first" | null;
  /** The optional post-sync calibration was answered or skipped. */
  calibrated?: boolean;
  updated_at: string;
};

export const DEFAULT_BRIEF_PREFERENCES: BriefPreferences = {
  schema_version: 1,
  paper_first: "requirements",
  problem_set_first: "next_step",
  default_order: "next_step_first",
  beta_opt_in: false,
  beta_arm: null,
  calibrated: false,
  updated_at: "",
};

export type BriefFeedbackOutcome = "helpful" | "not_specific_enough" | "wrong_context";
