/** Wire types for the study core (Python `canvas_mcp.core.study`, CONTRACTS C-02..C-05). */

export type Outcome = "correct" | "partial" | "incorrect" | "skipped" | "interrupted" | "uncertain";
export type Grader = "pending" | "deterministic" | "model_proposed" | "student_self" | "abstained";
export type Mode = "learn" | "review" | "practice";
export type Evidence =
  | "delayed_independent_retrieval"
  | "delayed_check"
  | "baseline_response"
  | "immediate_practice"
  | "acquisition_only"
  | "assisted_response"
  | "exposed_response"
  | "unknown_assistance"
  | "unverified_response"
  | "clock_uncertain"
  | "no_evidence"
  | "invalidated";

export type StudyError = { code: string; message: string };
export type Envelope<T> = ({ ok: true } & T) | { ok: false; error: StudyError };

export type ItemField = {
  id: string;
  label: string;
  kind: string;
  options: string[];
  scored: boolean;
};

export type ItemState = {
  item_id: string;
  objective_id: string;
  due: string | null;
  anchor: string | null;
  gap_days: number;
  hits: number;
  stability: "fragile" | "holding" | "durable";
  cooldown: string | null;
  validity: string;
  schedule_status: string;
  encountered: boolean;
  last_evidence: Evidence | null;
  last_outcome: Outcome | null;
  effective_due?: string | null;
  independent_check_no_earlier_than?: string | null;
  exam?: ExamView | null;
};

export type PublicItem = {
  id: string;
  packet_id: string;
  packet_version: number;
  course: string;
  objective_id: string;
  objective_label: string;
  kind: string;
  stem: string;
  neutral_locator: string;
  fields: ItemField[];
  has_example: boolean;
  has_hint: boolean;
  modes: Mode[];
  predicted_seconds: number;
  provenance: string;
  state?: ItemState | null;
};

export type TimelineBlock = { label: string; seconds: number };

export type Attempt = {
  attempt_id: string;
  item_id: string;
  objective_id: string;
  mode: Mode;
  started_at: string;
  clock_status: string;
  status: "open" | "submitted" | "assessed" | "interrupted";
  draft: string;
  draft_revision: number;
  draft_saved_at: string | null;
  response: string;
  fields: Record<string, string>;
  submitted_at: string | null;
  hints: number;
  exposures: { kind: string; solution_bearing: string; at: string }[];
  assistance: string;
  outcome: Outcome | null;
  grader: Grader | null;
  scope: string | null;
  evidence: Evidence | null;
  revealed: boolean;
};

export type Offer = {
  kind: "offer" | "no_review_needed" | "no_eligible_item" | "missing_source" | "needs_exam_date" | "no_pre_exam_slot";
  item: PublicItem | null;
  mode: Mode | null;
  why: string;
  next_at: string | null;
  reason: string;
  action: string;
  state: ItemState | null;
  eligibility_note: string;
  alternatives: { item_id: string; mode: Mode; label: string }[];
  minutes: number;
  timeline: TimelineBlock[];
  resume?: Attempt | null;
  session: { id: string; visited: string[] };
};

export type Example = { title?: string; text: string; faded_step?: string };

export type Started = {
  resumed: boolean;
  attempt: Attempt;
  item: PublicItem;
  timeline: TimelineBlock[];
  example?: Example;
};

export type Source = { id: string; locator: string; text: string; hash: string; stale?: boolean };

export type KeyView = Record<string, unknown> & {
  explanation?: string;
  support_refs?: string[];
  provenance_label: string;
  reference?: string;
  historical_version?: number;
};

export type CheckerField = { field_id: string; label: string; passed: boolean; scored: boolean; note: string };

export type Assessed = {
  duplicate: boolean;
  attempt: Attempt;
  assessment: {
    outcome: Outcome;
    grader: Grader;
    scope: string;
    evidence: Evidence;
    copy: string;
    checker: { fields: CheckerField[] } | null;
  };
  feedback: string;
  key: KeyView;
  sources: Source[];
  state: ItemState;
  next: { due: string | null; independent_after: string | null; lines: string[] };
};

export type Revealed = { sources: Source[]; key: KeyView; attempt: Attempt };

export type ExamView = {
  id: string;
  course: string;
  objective_scope: string[];
  value: "known_instant" | "date_only" | "window" | "unknown" | "cancelled";
  at: string;
  starts_at: string;
  ends_at: string;
  date: string;
  zone: string;
  source: string;
  confidence: "high" | "medium" | "low" | "unknown";
  label: string;
  cutoff_at: string | null;
  is_past: boolean;
};

export type PacketSummary = {
  packet_id: string;
  title: string;
  course: string;
  provenance: string;
  version: number;
  sources: { id: string; locator: string; hash: string; stale: boolean; chars: number }[];
  objectives: { id: string; label: string }[];
  items: PublicItem[];
  exams: ExamView[];
};

export type Status = {
  now: string;
  zone: string;
  clock: { status: string; note: string; anomalies: number };
  packets: { packet_id: string; title: string; course: string; provenance: string; version: number; sources: number; items: number; stale_sources: string[] }[];
  courses: string[];
  exams: ExamView[];
  items: { active: number; due_now: number; next_due: string | null; stability: Record<string, number> };
  open_attempts: Attempt[];
  pending_assessments: Attempt[];
  log: { events: number; partial_tail: boolean };
};

export type Template = { packet_id: string; title: string; course: string; provenance: string; items: number; path: string };

export type AskAction = {
  title: string;
  why_now: string;
  value: string;
  urgency: string;
  consequence: string | number;
  estimated_effort: string;
  dependencies: string[];
  risk: string;
  can_prepare_privately: boolean;
  student_confirmation_needed: boolean;
  source_refs: string[];
};

export type AskResponse = {
  question_type: string;
  context_chip: string;
  one_sentence: string;
  explanation: string;
  assumptions: string;
  check_status: "checked" | "abstained" | "blocked" | string;
  next_action: AskAction;
  modes: string[];
  prose: string;
  /** Why the answer is local-only, when it is. Older stored asks have no value. */
  relay?: "not_needed" | "not_connected" | "unavailable" | "used";
  response_mode: string;
};

export type AskEnvelope = {
  input_id?: string;
  status?: string;
  ask: { input_id: string; content: string; session_goal: string; status: string } | null;
  classification?: { job: string; boundary: string; signals: string[]; blocked_reason?: string | null };
  context?: {
    chip?: string;
    course_label?: string;
    assignment_label?: string;
    due?: string;
    conflicts?: { field: string; canvas?: string; note?: string }[];
  };
  response?: AskResponse;
  promoted_from?: string;
};

export type AskRank = {
  recommendation: { id?: string; title: string; why_now?: string; due_at?: string } | null;
  alternatives: { id?: string; title: string; why_now?: string }[];
};

export type RuntimeInfo = {
  mode: "bundled" | "dev" | "broken";
  core_dir: string;
  python: string;
  node: string | null;
  profile_id: string;
  user_root: string;
  diagnostics: string[];
};
