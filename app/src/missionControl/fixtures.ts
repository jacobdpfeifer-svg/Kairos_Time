import type { AssignmentBrief, AssignmentIsland, BriefKind, BriefState, IslandState, MissionControlSurface, OperationsIsland } from "./contracts";
import { MISSION_CONTROL_SCHEMA_VERSION } from "./contracts";

/*
 * Synthetic Mission Control data for `?fixture` browser preview and view
 * tests: math, paper, exam, sparse/LTI, a stale source, a calendar proposal,
 * Outlook context, and the email-unavailable send state. No real student data.
 */

const H = 3_600_000;

function iso(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * H).toISOString();
}

type Seed = {
  course_id: string;
  assignment_id: string;
  title: string;
  course_label: string;
  course_color: string;
  kind: BriefKind;
  due: number;
  state: BriefState;
  island: IslandState;
  reason: string;
};

const SEEDS: Seed[] = [
  { course_id: "101", assignment_id: "a12", title: "Midterm 2", course_label: "MATH 1300 — Calculus 1", course_color: "#2E86AB", kind: "exam", due: 50, state: "partial", island: "normal", reason: "Exam in 2 days" },
  { course_id: "101", assignment_id: "a11", title: "Problem Set 4: derivatives", course_label: "MATH 1300 — Calculus 1", course_color: "#2E86AB", kind: "math", due: 20, state: "ready", island: "normal", reason: "Due tomorrow" },
  { course_id: "202", assignment_id: "a21", title: "Argument essay draft", course_label: "WRTG 3020 — Writing and Rhetoric", course_color: "#C44569", kind: "writing", due: 70, state: "stale", island: "changed", reason: "Instructions changed in Canvas" },
  { course_id: "303", assignment_id: "a32", title: "WebAssign 7", course_label: "CHEM 1114 — General Chemistry Lab", course_color: "#2A9D8F", kind: "unknown", due: 30, state: "needs_source", island: "normal", reason: "Due tomorrow" },
  { course_id: "404", assignment_id: "a41", title: "Week 8 reading: Chapter 6 on urban heat islands and policy responses across three cities", course_label: "ENVS 2000 — Environment and Society", course_color: "#E09F3E", kind: "reading", due: 96, state: "ready", island: "normal", reason: "Due in 4 days" },
];

function island(s: Seed, now: Date, rank: number): AssignmentIsland {
  return {
    kind: "assignment",
    island_id: `island-${s.course_id}--${s.assignment_id}`,
    assignment_id: s.assignment_id,
    course_id: s.course_id,
    title: s.title,
    course_label: s.course_label,
    course_color: s.course_color,
    due_at: iso(now, s.due),
    assignment_kind: s.kind,
    brief_state: s.state,
    state: s.island,
    priority_reason: s.reason,
    rank,
    source_fingerprint: `fp-${s.assignment_id}`,
    focus: rank === 1 && s.kind === "exam",
  };
}

export function fixtureOperations(now: Date): OperationsIsland[] {
  return [
    {
      kind: "calendar",
      island_id: "ops-calendar",
      title: "Calendar",
      summary: "1 study block ready to review",
      state: "attention",
      action: { id: "review-block", label: "Review block", kind: "calendar_preview", availability: "requires_connection", reason: "Connect Google Calendar in Settings to add blocks" },
      calendar: { suggestion_id: "block:101:11", summary: "Work on Problem Set 4", start: iso(now, 4), end: iso(now, 5.5), why: "Due in the next few days", course_color: "#2E86AB" },
    },
    {
      kind: "email",
      island_id: "ops-email",
      title: "Email",
      summary: "Message may need you",
      state: "attention",
      action: { id: "review-draft", label: "Start a draft", kind: "email_draft", availability: "available" },
      email: {
        context: [{ id: "m1", subject: "MATH 1300: office hours moved to Thursday", from: "instructor@example.edu", received: iso(now, -3) }],
        drafts: [],
        send: { available: false, reason: "Sending is not connected on this device" },
      },
    },
  ];
}

export function fixtureMissionControl(now = new Date()): MissionControlSurface {
  return {
    schema_version: MISSION_CONTROL_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    today: now.toISOString().slice(0, 10),
    assignments: SEEDS.slice(0, 4).map((s, i) => island(s, now, i + 1)),
    operations: fixtureOperations(now),
    rest_count: 3,
    selected_assignment_id: null,
    prepared: true,
  };
}

export function fixtureBrief(courseId: string, assignmentId: string, now = new Date()): AssignmentBrief | null {
  const s = SEEDS.find((x) => x.course_id === courseId && x.assignment_id === assignmentId);
  if (!s) return null;
  const canvas = `https://canvas.example.edu/courses/${s.course_id}/assignments/${s.assignment_id.slice(1)}`;
  const sparse = s.state === "needs_source";
  const exam = s.kind === "exam";
  return {
    schema_version: MISSION_CONTROL_SCHEMA_VERSION,
    id: `${s.course_id}--${s.assignment_id}`,
    assignment_id: s.assignment_id,
    course_id: s.course_id,
    course_label: s.course_label,
    course_color: s.course_color,
    title: s.title,
    kind: s.kind,
    due_at: iso(now, s.due),
    points_possible: 20,
    state: s.state,
    gaps: sparse ? ["Canvas has almost no instructions for this"] : s.state === "stale" ? ["Canvas hasn't synced in over 3 days"] : exam ? ["Coverage not found in Canvas"] : [],
    prepared_at: iso(now, -2),
    expires_at: iso(now, 22),
    source_fingerprint: `fp-${s.assignment_id}`,
    next_step: exam ? "Start a 25-minute practice set in Study" : sparse ? "Open it in Canvas and write down what it asks for (5 min)" : "List the topic each problem uses, then try the first one (20 min)",
    priority_reason: s.reason,
    requirements: sparse ? ["Worth 20 points", "Submitted through an external tool (you open and use it yourself)", "Instructions: not found in Canvas"] : ["Worth 20 points", "Submit online: file upload", "Show your work for every derivative."],
    checklist: [
      { id: "req-0", text: sparse ? "Open the instructions in Canvas and read them through once" : "Check: Show your work for every derivative.", kind: "source_backed", evidence_ids: ["canvas"] },
      { id: "prop-0", text: "List the topic each problem uses", kind: "agent_proposal" },
      { id: "time", text: "Pick a time today or tomorrow to start", kind: "agent_proposal" },
    ],
    why_it_matters: sparse ? "Canvas has no grade weight for this. Work that's done on time usually makes the next exam easier." : "Skipping it would take your MATH 1300 grade from 88% to about 84%, from your Canvas grades.",
    why_is_general: sparse,
    evidence: [
      { id: "canvas", label: `Canvas: ${s.title}`, kind: "canvas", locator: canvas, retrieved_at: iso(now, -2), excerpt: sparse ? null : "Complete problems 1-12 from Section 3.4." },
      ...(sparse ? [] : [{ id: "src-page-chain", label: "Worked examples: chain rule derivatives", kind: "course_source" as const, locator: "https://canvas.example.edu/courses/101/pages/chain", retrieved_at: iso(now, -2), excerpt: "Example 1. Differentiate sin(x^2)…" }]),
    ],
    module: sparse
      ? {
          kind: s.kind,
          title: "What we know",
          sections: [
            { id: "visible", title: "What Canvas shows", body: "- Worth 20 points\n- Done in an external tool you'll open yourself", evidence_ids: ["canvas"] },
            { id: "questions", title: "Questions to resolve", body: "- What exactly is being submitted?\n- How is it graded?" },
          ],
        }
      : {
          kind: s.kind,
          title: exam ? "Exam prep" : "Problem set",
          sections: [
            { id: "concept_map", title: "Topics and notation in the assignment", body: "- section 3.4\n- derivatives", evidence_ids: ["canvas"] },
            { id: "worked_example_link", title: "A worked example from your course", body: "- Worked examples: chain rule derivatives", evidence_ids: ["src-page-chain"] },
            { id: "error_checks", title: "Error checks before you submit", body: "- Units and signs on every answer", proposal: true },
          ],
        },
    actions: exam
      ? [
          { id: "study", label: "Start studying", kind: "study", availability: "available", target: `item-${s.assignment_id}`, primary: true },
          { id: "open-canvas", label: "Open in Canvas", kind: "open_canvas", availability: "available", target: canvas },
          { id: "ask", label: "Ask about this", kind: "ask", availability: "available" },
        ]
      : [
          { id: "open-canvas", label: "Open in Canvas", kind: "open_canvas", availability: "available", target: canvas, primary: true },
          { id: "ask", label: "Ask about this", kind: "ask", availability: "available" },
          { id: "calendar", label: "Propose a study block", kind: "calendar_preview", availability: "available" },
        ],
    section_order: ["next_step", "requirements", "checklist", "why", "module", "materials"],
    enrichment: null,
  };
}
