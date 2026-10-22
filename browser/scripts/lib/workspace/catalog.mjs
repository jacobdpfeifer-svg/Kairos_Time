/**
 * Reviewed workspace capabilities. This is the only authored copy.
 *
 * tools/emit-workspace-catalog.mjs writes app/src/workspace/catalog.json for the
 * React shell and the Rust writer. onboarding.mjs imports this module.
 * A capability is listed only when the desktop app can mount it today.
 * Friction and preference enums live here too: they are the only words a draft
 * may use, and tools/emit-workspace-catalog.mjs does not copy them into the app.
 *
 * `optional_connector` is legal only when the capability id or `connector`
 * field is a CONNECTOR_REGISTRY id or slug. The shell still must not offer
 * a connect button for it.
 *
 * Not listed, and why:
 *   today.changes    rendered inside Today, not as its own screen
 *   capture.quick    the command bar, opened with the shortcut
 *   voice.checkin    the voice sheet; it is not a resident surface
 *   calendar.read    Settings connectors, and it is not connected from here
 *   outlook.read     Settings connectors, and it is not connected from here
 */
import { isReviewedConnector } from "../connector-registry-data.mjs";

export const WORKFLOW_FRICTIONS = Object.freeze([
  "finding_next_action",
  "tracking_deadlines",
  "starting_work",
  "planning_time",
  "remembering_course_context",
  "turning_notes_into_study",
  "staying_calm",
  "other",
]);

export const WORKFLOW_PREFERENCES = Object.freeze([
  "one_next_step",
  "weekly_overview",
  "course_by_course",
  "study_first",
  "quiet_minimal",
]);

export const WORKSPACE_CAPABILITIES = Object.freeze([
  {
    id: "today.next_action",
    label: "One clear next action",
    blurb: "Today, with the next thing to start and what changed in Canvas.",
    surfaces: ["today"],
    component: "TodayView",
    sizes: ["full"],
    props: {},
    supports: ["finding_next_action", "starting_work", "staying_calm"],
    requires: [],
    max_instances: 1,
    availability: "available",
    tier: "local",
    weight: 10,
  },
  {
    id: "week.plan",
    label: "Weekly time plan",
    blurb: "The week, with what needs you and a plan you can accept.",
    surfaces: ["week"],
    component: "WeekView",
    sizes: ["full"],
    props: {},
    supports: ["planning_time", "tracking_deadlines", "starting_work"],
    requires: [],
    max_instances: 1,
    availability: "available",
    tier: "local",
    weight: 20,
  },
  {
    id: "courses.sources",
    label: "Course files and source context",
    blurb: "Your courses, with grades, open work, and files.",
    surfaces: ["courses"],
    component: "CoursesView",
    sizes: ["full"],
    props: {},
    supports: ["remembering_course_context"],
    requires: [],
    max_instances: 1,
    availability: "available",
    tier: "local",
    weight: 30,
  },
  {
    id: "study.practice",
    label: "Practice and study sessions",
    blurb: "Study, with exam tracks and practice.",
    surfaces: ["study"],
    component: "StudyPathView",
    sizes: ["full"],
    props: {},
    supports: ["turning_notes_into_study", "starting_work"],
    requires: [],
    max_instances: 1,
    availability: "available",
    tier: "local",
    weight: 40,
  },
  {
    id: "advisor.plan",
    label: "Academic planning and advising",
    blurb: "A snapshot for planning and advising.",
    surfaces: ["advisor"],
    component: "AdvisorView",
    sizes: ["full"],
    props: {},
    supports: ["planning_time"],
    requires: [],
    max_instances: 1,
    availability: "available",
    tier: "local",
    weight: 50,
  },
]);

/** Reviewed starting points. Block ids may name capabilities the shell cannot mount yet; the shell skips those. */
export const WORKSPACE_TEMPLATES = Object.freeze([
  { id: "calm-daily", label: "Calm daily focus", preference: "one_next_step", blocks: ["today.next_action", "today.changes", "capture.quick"] },
  { id: "weekly-planner", label: "Weekly planner", preference: "weekly_overview", blocks: ["week.plan", "today.next_action", "today.changes"] },
  { id: "course-command", label: "Course command center", preference: "course_by_course", blocks: ["courses.sources", "today.next_action", "capture.quick"] },
  { id: "study-first", label: "Study-first", preference: "study_first", blocks: ["study.practice", "courses.sources", "today.next_action"] },
  { id: "quiet-minimal", label: "Quiet minimal", preference: "quiet_minimal", blocks: ["today.next_action", "capture.quick"] },
]);

/** Throws when a capability claims optional_connector without a reviewed registry id. */
export function assertOptionalConnectorsReviewed(catalog) {
  for (const cap of catalog) {
    if (cap?.availability !== "optional_connector") continue;
    if (isReviewedConnector(cap.id) || isReviewedConnector(cap.connector)) continue;
    throw new Error(`capability ${cap.id} is optional_connector but is not in CONNECTOR_REGISTRY`);
  }
}

assertOptionalConnectorsReviewed(WORKSPACE_CAPABILITIES);
