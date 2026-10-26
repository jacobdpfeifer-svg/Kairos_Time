/* Reviewer: the only webview path to native commands. Args are validated again in Rust. */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  fixtureAdvisor,
  fixtureCourseMap,
  fixtureEnabled,
  fixtureFreshness,
  fixtureGradeTruth,
  fixtureHealth,
  fixtureSchools,
  fixtureSemester,
  fixtureSkipCosts,
} from "./dev/fixtures";
import type { SkipCosts } from "./consequence";

export type SyncResult = { ok: boolean; error?: string | null };

/** Read-only advisor projection (`advisor.rs`). Requirement facts come only
 * from the student's dated audit copy; `audit.present` is false for an
 * untouched template. */
export type AdvisorSnapshot = {
  mode: "planning" | "stale_audit" | "tier2_dated_audit";
  as_of: string;
  program: string;
  catalog_year: string;
  target_grad_term: string;
  official_url: string | null;
  audit: {
    present: boolean;
    dated: boolean;
    imported_on: string | null;
    stale_days: number | null;
    catalog_year: string | null;
    stale: boolean;
    label: string;
    remaining_credits: number | null;
    complete_count: number;
    in_progress_count: number;
    unmet_count: number;
    in_progress_items: string[];
    unmet_items: string[];
  };
  courses: string[];
  sources: { canvas: string; audit: string; profile: string };
  questions: string[];
};

export const EMPTY_ADVISOR: AdvisorSnapshot = {
  mode: "planning",
  as_of: "",
  program: "",
  catalog_year: "",
  target_grad_term: "",
  official_url: null,
  audit: {
    present: false,
    dated: false,
    imported_on: null,
    stale_days: null,
    catalog_year: null,
    stale: false,
    label: "No degree audit imported yet",
    remaining_credits: null,
    complete_count: 0,
    in_progress_count: 0,
    unmet_count: 0,
    in_progress_items: [],
    unmet_items: [],
  },
  courses: [],
  sources: { canvas: "Canvas not synced yet", audit: "No audit copy", profile: "Not in your profile yet" },
  questions: [],
};

export async function readAdvisorSnapshot(): Promise<AdvisorSnapshot> {
  if (!isTauri()) return fixtureEnabled() ? fixtureAdvisor() : EMPTY_ADVISOR;
  return invoke<AdvisorSnapshot>("read_advisor_snapshot");
}

export type DockMode = "onboarding" | "peek" | "expanded" | "workspace";

/** Native dock commands share this adapter with all other frontend IPC. */
export async function setDockMode(mode: DockMode): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_dock_mode", { mode });
}

/** True when running inside the Tauri webview (not plain Vite browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function syncCanvas(): Promise<SyncResult> {
  if (!isTauri()) return { ok: false, error: "not in tauri" };
  return invoke<SyncResult>("sync_canvas");
}

export type CanvasExportResult = {
  ok: boolean;
  export_dir: string;
  zip: string;
  courses: number;
  grades_included: boolean;
};

export async function exportCanvas(includeGrades = false): Promise<CanvasExportResult> {
  if (!isTauri()) return { ok: false, export_dir: "", zip: "", courses: 0, grades_included: false };
  return invoke<CanvasExportResult>("export_canvas", { includeGrades });
}

export async function openCanvasSso(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_canvas_sso");
}

/** Headless probe: is there already a valid Canvas session in browser/.auth? */
/** A Canvas school from the public Instructure search (docs/architecture/school-personalization.md). */
export type SchoolMatch = { name: string; host: string; account_id: number | null };

/** What onboarding saved to `{user_root}/school/profile.json`. */
export type SchoolProfile = {
  slug: string;
  display_name: string;
  canvas_host: string;
  canvas_base_url: string;
  instructure_account_id: number | null;
  source: "instructure-search" | "manual";
  discovered?: { timezone?: string; term?: { name: string; start_at: string; end_at: string | null }; brand_color?: string };
};

export async function searchSchools(term: string): Promise<SchoolMatch[]> {
  if (!isTauri()) return fixtureEnabled() ? fixtureSchools(term) : [];
  return invoke<SchoolMatch[]>("search_schools", { term });
}

export async function chooseSchool(
  match: { host: string; name: string; account_id?: number | null },
  manual = false
): Promise<SchoolProfile> {
  if (!isTauri()) {
    const host = match.host.trim().toLowerCase();
    const profile: SchoolProfile = {
      slug: host.replace(/\./g, "-"),
      display_name: match.name || host,
      canvas_host: host,
      canvas_base_url: `https://${host}`,
      instructure_account_id: match.account_id ?? null,
      source: manual ? "manual" : "instructure-search",
    };
    localStorage.setItem("pn_school_profile", JSON.stringify(profile));
    return profile;
  }
  return invoke<SchoolProfile>("choose_school", {
    host: match.host,
    name: match.name,
    accountId: match.account_id ?? null,
    manual,
  });
}

export async function readSchoolProfile(): Promise<SchoolProfile | null> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem("pn_school_profile");
      return raw ? (JSON.parse(raw) as SchoolProfile) : null;
    } catch {
      return null;
    }
  }
  return invoke<SchoolProfile | null>("read_school_profile");
}

export async function checkCanvasSession(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("check_canvas_session");
}

export async function saveOnboarding(schoolSlug: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("pn_school", schoolSlug);
    return;
  }
  await invoke("save_onboarding", { schoolSlug });
}

export type LearningProfileAnswers = {
  practiceFormat: "worked_example" | "retrieval";
  autonomy: "directive" | "choices";
  chunkSize: "short" | "long";
  checkDepth: "light" | "thorough";
  ifThen?: string;
};

export type DueReview = {
  id: string;
  course: string;
  claim: string;
  kind: string;
  stability: string;
  start_with_example: boolean;
  checkpoint_due: string | null;
  gap_days: number;
  why?: string;
  rung?: string;
  missing?: string;
  counterfactual?: string;
};

export type ReviewBudget = {
  now: number;
  later: number;
  later_checkpoint: string | null;
  line: string;
};

/** What the Study path reads from `learn_loop --json due` (the core sends more for agents). */
export type DueReviewsPayload = {
  items: DueReview[];
  budget: ReviewBudget;
};

export type ReviewOutcome = "miss" | "partial" | "hit" | "skipped";

export type ScoredReview = DueReview & {
  next_review_at?: string;
  last_outcome?: string | null;
  stability_delta?: string | null;
};

export type AimsInput = {
  career: string[];
  interest: string[];
  worth: string[];
  light: string[];
};

/** Settings "What to weigh". Empty lists leave those sections on disk alone. */
export async function saveAims(aims: AimsInput): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("pn_aims", JSON.stringify(aims));
    return;
  }
  await invoke("save_aims", aims);
}

export async function saveLearningProfile(
  answers: LearningProfileAnswers
): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("pn_learning_profile", JSON.stringify(answers));
    return;
  }
  await invoke("save_learning_profile", {
    practiceFormat: answers.practiceFormat,
    autonomy: answers.autonomy,
    chunkSize: answers.chunkSize,
    checkDepth: answers.checkDepth,
    ifThen: answers.ifThen ?? "",
  });
}

const EMPTY_BUDGET: ReviewBudget = {
  now: 0,
  later: 0,
  later_checkpoint: null,
  line: "",
};

export async function readDueReviews(): Promise<DueReviewsPayload> {
  if (!isTauri()) return { items: [], budget: EMPTY_BUDGET };
  const payload = await invoke<Partial<DueReviewsPayload> | null>("read_due_reviews");
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    budget: payload?.budget ?? EMPTY_BUDGET,
  };
}

export async function recordReviewOutcome(
  itemId: string,
  outcome: ReviewOutcome,
  sameSession = false
): Promise<ScoredReview> {
  if (!isTauri()) {
    throw new Error("not in tauri");
  }
  return invoke<ScoredReview>("record_review_outcome", {
    itemId,
    outcome,
    sameSession,
  });
}

export async function onInboxUpdated(
  handler: () => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauri()) return () => undefined;
  return listen("inbox-updated", () => handler());
}

/** One row of "what changed", as built by browser/scripts/lib/freshness/view.mjs. */
export type FreshnessChange = {
  key: string;
  kind: string;
  label: string;
  title: string;
  course?: string | null;
  at?: string | null;
  detected_at?: string | null;
  url?: string | null;
  detail?: Record<string, unknown>;
};

/** `{user_root}/inbox/freshness/dashboard.json` — also what the Chrome extension shows. */
export type FreshnessDashboard = {
  version: number;
  generated_at: string;
  status?: { signed_in?: boolean | null; last_delta_at?: string | null; last_feed_poll_at?: string | null; feeds_configured?: boolean };
  changes: FreshnessChange[];
  digest?: { announcements_7d: number; with_actions: number };
  /** Logistics the student can approve: work blocks for their own calendar (freshness-dashboard.mjs). */
  agent_can_do?: {
    id: string;
    kind: string;
    label: string;
    why: string;
    suggestion: { key: string; title: string; start: string; end: string; why: string };
  }[];
};

export async function readFreshness(): Promise<FreshnessDashboard | null> {
  if (!isTauri()) return fixtureEnabled() ? fixtureFreshness() : null;
  return invoke<FreshnessDashboard | null>("read_freshness");
}

/** `{user_root}/inbox/freshness/skip-costs.json`: grade if each upcoming item is a zero or full marks. */
export async function readSkipCosts(): Promise<SkipCosts> {
  if (!isTauri()) return fixtureEnabled() ? fixtureSkipCosts() : {};
  return invoke<SkipCosts>("read_skip_costs");
}

export async function onFreshnessUpdated(
  handler: () => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauri()) return () => undefined;
  return listen("freshness-updated", () => handler());
}

export async function onSyncFailed(
  handler: (message: string) => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauri()) return () => undefined;
  return listen<string>("sync-failed", (event) => handler(event.payload));
}

/** Routes from the tray, the extension, and a future macOS URL-scheme handler. */
export async function onDeepLink(handler: (url: string) => void): Promise<UnlistenFn | (() => void)> {
  if (!isTauri()) return () => undefined;
  return listen<string>("deep-link", (event) => handler(event.payload));
}

/** A `kairos://` link that arrived before Kairos was listening (cold start). Taken once. */
export async function takePendingLink(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("take_pending_link");
}

/** When the Kairos Chrome extension first reached this app, or null if it never has. */
export async function readExtensionStatus(): Promise<{ connected_at: string | null }> {
  if (!isTauri()) return { connected_at: null };
  return invoke<{ connected_at: string | null }>("extension_status");
}

/** Native opt-ins from Settings, all off by default (app-prefs.json). */
export type AppPrefs = { keep_running: boolean; notifications: boolean; capture_shortcut: string | null };

export const DEFAULT_APP_PREFS: AppPrefs = { keep_running: false, notifications: false, capture_shortcut: null };

export async function readAppPrefs(): Promise<AppPrefs> {
  if (!isTauri()) {
    try {
      return { ...DEFAULT_APP_PREFS, ...JSON.parse(localStorage.getItem("pn_app_prefs") || "{}") };
    } catch {
      return DEFAULT_APP_PREFS;
    }
  }
  return { ...DEFAULT_APP_PREFS, ...(await invoke<AppPrefs>("read_app_prefs")) };
}

export async function setAppPrefs(prefs: AppPrefs): Promise<AppPrefs> {
  if (!isTauri()) {
    localStorage.setItem("pn_app_prefs", JSON.stringify(prefs));
    return prefs;
  }
  return invoke<AppPrefs>("set_app_prefs", { prefs });
}

/** The menu-bar "Next" row. Empty clears it back to "Open Today". */
export async function setTrayNext(title: string): Promise<void> {
  if (!isTauri()) return;
  const text = title.replace(/\s+/g, " ").trim().slice(0, 80);
  await emit("tray-next", text);
}

export type SemesterTick = {
  id: string;
  course_id: string;
  course_label: string;
  color: string;
  title: string;
  kind: string;
  due_at: string | null;
  points_possible: number | null;
  weight_share: number;
  html_url: string | null;
  completed: boolean;
  description: string;
};

export type SemesterCourse = {
  id: string;
  label: string;
  code: string;
  name: string;
  color: string;
  term: { start_at: string | null; end_at: string | null; source: string };
  ticks: SemesterTick[];
  counts: { assignments: number; quizzes: number; exams: number };
};

export type SemesterSurface = {
  courses: SemesterCourse[];
  range: string;
  window_start: string;
  window_end: string;
  today: string;
};

export async function readSemester(range: string, today: string): Promise<SemesterSurface> {
  if (!isTauri()) {
    if (fixtureEnabled()) return fixtureSemester(range);
    return { courses: [], range, window_start: today, window_end: today, today };
  }
  return invoke<SemesterSurface>("read_semester", { range, today });
}

export type SyncProgressCourse = {
  id: string;
  label: string;
  color?: string;
  assignments?: number;
  quizzes?: number;
  exam_count?: number;
  ok?: boolean;
};

export type SyncProgress = {
  phase: string;
  courses: SyncProgressCourse[];
  error?: string | null;
};

export async function readSyncProgress(): Promise<SyncProgress> {
  if (!isTauri()) return { phase: "idle", courses: [] };
  return invoke<SyncProgress>("read_sync_progress");
}

export async function onStudySyncProgress(
  handler: (progress: SyncProgress) => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauri()) return () => undefined;
  return listen<SyncProgress>("study-sync-progress", (event) => handler(event.payload));
}

export async function syncStudySourcesIpc(): Promise<SyncResult> {
  if (!isTauri()) return { ok: false, error: "Canvas sync needs the desktop app" };
  return invoke<SyncResult>("sync_study_sources");
}

export type CalendarEvent = {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  course_id?: string | null;
  color?: string | null;
  note?: string | null;
};

export type CalendarSuggestion = {
  source_message_id: string;
  title: string;
  start: string;
  end: string;
  confidence: number;
  why: string;
};

export type CalendarSurface = {
  events: CalendarEvent[];
  canvas_events?: CalendarEvent[];
  suggestions: CalendarSuggestion[];
  sync_health?: SyncHealth;
};

export async function readCalendarSurface(): Promise<CalendarSurface> {
  const empty: CalendarSurface = {
    events: [],
    canvas_events: [],
    suggestions: [],
  };
  if (!isTauri()) return empty;
  try {
    const payload = await invoke<CalendarSurface>("read_calendar_surface");
    return {
      events: payload?.events ?? [],
      canvas_events: payload?.canvas_events ?? [],
      suggestions: payload?.suggestions ?? [],
      sync_health: payload?.sync_health,
    };
  } catch {
    return empty;
  }
}

export async function addCalendarEvent(event: Omit<CalendarEvent, "id"> & { id?: string }): Promise<CalendarEvent> {
  if (!isTauri()) {
    const row: CalendarEvent = {
      id: event.id || `cal-${Date.now()}`,
      kind: event.kind,
      title: event.title,
      start: event.start,
      end: event.end,
      course_id: event.course_id,
      color: event.color,
      note: event.note,
    };
    const key = "pn_calendar_local";
    const prev = JSON.parse(localStorage.getItem(key) || "[]") as CalendarEvent[];
    prev.push(row);
    localStorage.setItem(key, JSON.stringify(prev));
    return row;
  }
  return invoke<CalendarEvent>("add_calendar_event", { event });
}

export async function dismissCalendarSuggestion(sourceMessageId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("dismiss_calendar_suggestion", { sourceMessageId });
}

export async function removeCalendarEvent(id: string): Promise<void> {
  if (!isTauri()) {
    const key = "pn_calendar_local";
    const prev = JSON.parse(localStorage.getItem(key) || "[]") as CalendarEvent[];
    localStorage.setItem(key, JSON.stringify(prev.filter((row) => row.id !== id)));
    return;
  }
  await invoke("remove_calendar_event", { id });
}

export async function restoreCalendarSuggestion(sourceMessageId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("restore_calendar_suggestion", { sourceMessageId });
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error('only credential-free http(s) URLs can be opened');
  }
  if (!isTauri()) {
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_external_url", { url });
}

export type SyncHealth = {
  state?: string;
  sync_id?: string | null;
  as_of?: string | null;
  surfaces_enabled?: boolean;
  empty_means?: string;
  inspect_in_canvas?: boolean;
  failed_endpoints?: unknown[];
  named_courses_failed?: string[];
  truncated?: string[];
  timezone?: string;
};

export type WorkItem = {
  id: string;
  course_id: string;
  canvas_id: string;
  title: string;
  effective_due_at?: string | null;
  submission_state?: string;
  html_url?: string | null;
  seen_in?: string[];
  disagreements?: { field: string; values: string[] }[];
  lti?: boolean;
  course_name?: string | null;
  course_code?: string | null;
};

export type CourseMap = {
  sync_id?: string;
  health_state?: string;
  as_of?: string;
  fallback_reason?: string | null;
  course?: { id: string; code?: string; name?: string; label?: string; color?: string; html_url?: string | null };
  start_here?: { kind: string; title: string; html_url?: string | null }[];
  learn?: { id: string; title: string; html_url?: string | null; locked?: boolean; lti?: boolean }[];
  do?: WorkItem[];
  check?: { missing?: WorkItem[]; unsubmitted?: WorkItem[]; grade?: GradeTruth };
};

export type GradeScenario = {
  status: string;
  scenario: string;
  percent: number | null;
  letter?: string | null;
  included_item_ids?: string[];
  excluded_item_ids?: string[];
  warnings?: { code: string; item_ids?: string[] }[];
  as_of?: string;
};

export type GradeTruth = {
  course_id?: string;
  as_of?: string;
  canvas_reported?: GradeScenario;
  graded_only?: GradeScenario;
  risk_adjusted?: GradeScenario;
  what_if?: GradeScenario;
  lead?: {
    canvas_says?: number | null;
    canvas_letter?: string | null;
    unsubmitted_due_count?: number;
    risk?: number | null;
    why?: string;
  };
};

export async function readSyncHealth(): Promise<SyncHealth> {
  if (!isTauri()) return fixtureEnabled() ? fixtureHealth() : { state: "empty_unverified", surfaces_enabled: false };
  return invoke<SyncHealth>("read_sync_health");
}

export async function readCourseMap(courseId: string): Promise<CourseMap> {
  if (!isTauri()) return fixtureEnabled() ? fixtureCourseMap(courseId) : { course: { id: courseId } };
  return invoke<CourseMap>("read_course_map", { courseId });
}

/** Canvas course card colours by course id, e.g. { "101": "#e1ad49" }. Empty outside Tauri or before a sync. */
export async function readCourseColors(): Promise<Record<string, string>> {
  if (!isTauri()) return {};
  const raw = await invoke<Record<string, string> | null>("read_course_colors");
  return raw && typeof raw === "object" ? raw : {};
}

export async function readGradeTruth(courseId: string): Promise<GradeTruth> {
  if (!isTauri()) return fixtureEnabled() ? fixtureGradeTruth(courseId) : { course_id: courseId };
  return invoke<GradeTruth>("read_grade_truth", { courseId });
}

/**
 * The accepted workspace lives in the profile directory, never in localStorage.
 * The webview is shared by every profile (see resolveOnboarded in App.tsx).
 */
export type WorkspaceHistoryEntry = { ts: string; name: string | null };
export type WorkspaceRead = { spec: import("./workspace/contracts").WorkspaceSpec | null; notice: string | null; history: WorkspaceHistoryEntry[] };

export async function readWorkspaceSpec(): Promise<WorkspaceRead> {
  if (!isTauri()) return { spec: null, notice: null, history: [] };
  return invoke<WorkspaceRead>("read_workspace_spec");
}

export async function writeAcceptedSpec(spec: WorkspaceRead["spec"]): Promise<WorkspaceRead["spec"]> {
  if (!spec) return spec;
  if (!isTauri()) return spec;
  return invoke<WorkspaceRead["spec"]>("write_accepted_spec", { spec });
}

export async function listWorkspaceHistory(): Promise<WorkspaceHistoryEntry[]> {
  if (!isTauri()) return [];
  const raw = await invoke<{ entries?: WorkspaceHistoryEntry[] }>("list_workspace_history");
  return raw.entries ?? [];
}

export async function revertWorkspace(ts: string): Promise<WorkspaceRead["spec"]> {
  return invoke<WorkspaceRead["spec"]>("revert_workspace", { ts });
}

export type ProposedWorkspace = import("./workspace/patch").ProposedWorkspace;

/** The studio draft. Outside the desktop app this stays in memory. */
export async function readProposedWorkspace(): Promise<ProposedWorkspace | null> {
  if (!isTauri()) return null;
  const raw = await invoke<ProposedWorkspace | null>("read_proposed_workspace");
  if (!raw || typeof raw !== "object" || !raw.spec) return null;
  return raw;
}

export async function writeProposedWorkspace(doc: ProposedWorkspace): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_proposed_workspace", { doc });
}

export async function discardProposedWorkspace(): Promise<void> {
  if (!isTauri()) return;
  await invoke("discard_proposed_workspace");
}

/** Interview draft only. A file whose status is not draft is refused by the shell. */
export async function readWorkflowDraft(): Promise<unknown | null> {
  if (!isTauri()) return null;
  const raw = await invoke<unknown>("read_workflow_draft");
  return raw && typeof raw === "object" ? raw : null;
}

export async function writeWorkflowDraft(draft: unknown): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_workflow_draft", { draft });
}

export async function startVoiceServer(): Promise<{ ok: true; port: number } | { ok: false; reason: string }> {
  if (!isTauri()) return { ok: false, reason: "Voice isn't available on this Mac. You can type the same answers." };
  try {
    const raw = await invoke<{ ok?: boolean; port?: number; reason?: string }>("start_voice_server");
    if (raw?.ok && raw.port) return { ok: true, port: raw.port };
    return { ok: false, reason: raw?.reason || "Voice didn't start. You can type the same answers." };
  } catch {
    return { ok: false, reason: "Voice didn't start. You can type the same answers." };
  }
}

export type WorkspaceUsageEvent =
  | { event: "open_surface"; surface: string; day: string }
  | { event: "dwell"; surface: string; seconds: number }
  | { event: "expand_block"; block_id: string; day: string };

export async function readWorkspaceUsage(): Promise<unknown> {
  if (!isTauri()) return null;
  return invoke("read_workspace_usage");
}

export async function recordWorkspaceUsage(event: WorkspaceUsageEvent): Promise<void> {
  if (!isTauri()) return;
  await invoke("record_workspace_usage", { event });
}

export async function readWorkspaceAmendments(): Promise<unknown> {
  if (!isTauri()) return null;
  return invoke("read_workspace_amendments");
}

export async function writeWorkspaceAmendments(doc: unknown): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_workspace_amendments", { doc });
}
