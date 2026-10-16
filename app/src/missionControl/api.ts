import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc";
import { fixtureEnabled } from "../dev/fixtures";
import { dayKey } from "../week/plan";
import type { AssignmentBrief, BriefFeedbackOutcome, BriefKind, BriefPreferences, MissionControlSurface } from "./contracts";
import { DEFAULT_BRIEF_PREFERENCES, MISSION_CONTROL_SCHEMA_VERSION } from "./contracts";
import { fixtureBrief, fixtureMissionControl } from "./fixtures";

/*
 * Mission Control IPC. Read-only over the local brief projection; the only
 * writes are the student's own selection, preferences, and one-tap feedback
 * under {user_root}/calibration. Nothing here reaches Canvas or a mailbox.
 */

const EMPTY_SURFACE = (today: string): MissionControlSurface => ({
  schema_version: MISSION_CONTROL_SCHEMA_VERSION,
  generated_at: "",
  today,
  assignments: [],
  operations: [],
  rest_count: 0,
  selected_assignment_id: null,
  prepared: false,
});

// Browser preview only: the selection and prefs live in memory.
let previewSelection: string | null = null;
let previewPrefs: BriefPreferences = { ...DEFAULT_BRIEF_PREFERENCES };

export async function readMissionControl(now = new Date()): Promise<MissionControlSurface> {
  const today = dayKey(now);
  if (!isTauri()) {
    if (!fixtureEnabled()) return EMPTY_SURFACE(today);
    return { ...fixtureMissionControl(now), selected_assignment_id: previewSelection };
  }
  return invoke<MissionControlSurface>("read_mission_control_surface", { today });
}

export type BriefRead = AssignmentBrief | { error: string };

export async function readAssignmentBrief(courseId: string, assignmentId: string): Promise<BriefRead> {
  if (!isTauri()) return fixtureEnabled() ? (fixtureBrief(courseId, assignmentId) ?? { error: "not_found" }) : { error: "not_found" };
  return invoke<BriefRead>("read_assignment_brief", { courseId, assignmentId });
}

export async function setMissionControlSelection(assignmentId: string | null, now = new Date()): Promise<void> {
  if (!isTauri()) {
    previewSelection = assignmentId;
    return;
  }
  await invoke("set_mission_control_selection", { today: dayKey(now), assignmentId });
}

export async function readBriefPrefs(): Promise<BriefPreferences> {
  if (!isTauri()) return previewPrefs;
  return invoke<BriefPreferences>("read_brief_prefs");
}

export async function writeBriefPrefs(prefs: BriefPreferences): Promise<BriefPreferences> {
  const now = new Date().toISOString();
  if (!isTauri()) {
    previewPrefs = { ...prefs, updated_at: now, beta_arm: prefs.beta_opt_in ? (previewPrefs.beta_arm ?? "next_step_first") : null };
    return previewPrefs;
  }
  return invoke<BriefPreferences>("write_brief_prefs", { prefs, now });
}

export async function recordBriefFeedback(kind: BriefKind, outcome: BriefFeedbackOutcome, now = new Date()): Promise<void> {
  if (!isTauri()) return;
  await invoke("record_brief_feedback", { kind, outcome, day: dayKey(now) });
}

export async function exportBriefFeedback(): Promise<unknown> {
  if (!isTauri()) return { schema_version: 1, kind: "kairos-brief-feedback", rows: [] };
  return invoke<unknown>("export_brief_feedback");
}

export function isBrief(r: BriefRead | null | undefined): r is AssignmentBrief {
  return Boolean(r && !("error" in r));
}
