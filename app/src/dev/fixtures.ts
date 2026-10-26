import type { AdvisorSnapshot, CourseMap, FreshnessDashboard, GradeTruth, SemesterSurface, SyncHealth } from "../ipc";
import type { SkipCosts } from "../consequence";

/**
 * Browser-only preview data. Active only in a Vite DEV build, outside Tauri,
 * when the page URL carries `?fixture=1`. Never reachable from the shipped app.
 */
export function fixtureEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("fixture");
}

// Anchored to the real day so Today and Week read as they would for a student this week.
const TODAY = (() => {
  const d = new Date();
  d.setUTCHours(16, 0, 0, 0);
  return d.toISOString();
})();

function iso(daysFromToday: number, hour = 16): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function fixtureSemester(range: string): SemesterSurface {
  const spanDays = range === "full" ? 120 : range === "3m" ? 90 : range === "2m" ? 60 : 30;
  const tick = (
    id: string,
    course_id: string,
    course_label: string,
    color: string,
    title: string,
    kind: string,
    day: number,
    points: number,
    weight: number,
    completed = false
  ) => ({
    id,
    course_id,
    course_label,
    color,
    title,
    kind,
    due_at: iso(day),
    points_possible: points,
    weight_share: weight,
    html_url: `https://canvas.example/${id}`,
    completed,
    description: `${title}. Covers the last two weeks of lecture.`,
  });
  const term = { start_at: iso(-30), end_at: iso(90), source: "canvas" };
  return {
    range,
    window_start: iso(-7),
    window_end: iso(spanDays - 7),
    today: TODAY,
    courses: [
      {
        id: "1300",
        label: "MATH 1300",
        code: "MATH 1300",
        name: "Calculus 1",
        color: "#2E86AB",
        term,
        counts: { assignments: 3, quizzes: 1, exams: 1 },
        ticks: [
          tick("m-hw3", "1300", "MATH 1300", "#2E86AB", "Homework 3", "assignment", -3, 10, 0.03, true),
          tick("m-hw4", "1300", "MATH 1300", "#2E86AB", "Homework 4: chain rule", "assignment", 2, 10, 0.03),
          tick("m-q2", "1300", "MATH 1300", "#2E86AB", "Quiz 2", "quiz", 6, 20, 0.05),
          tick("m-mid", "1300", "MATH 1300", "#2E86AB", "Midterm 1", "exam", 23, 100, 0.25),
        ],
      },
      {
        id: "1300c",
        label: "CSCI 1300",
        code: "CSCI 1300",
        name: "Starting Computing",
        color: "#E1AD49",
        term,
        counts: { assignments: 2, quizzes: 0, exams: 1 },
        ticks: [
          tick("c-p2", "1300c", "CSCI 1300", "#E1AD49", "Project 2: recursion", "assignment", 4, 50, 0.1),
          tick("c-lab", "1300c", "CSCI 1300", "#E1AD49", "Lab 5", "assignment", 9, 10, 0.02),
          tick("c-ex", "1300c", "CSCI 1300", "#E1AD49", "Exam 1", "exam", 30, 100, 0.2),
        ],
      },
      {
        id: "1010",
        label: "WRTG 1150",
        code: "WRTG 1150",
        name: "First-Year Writing",
        color: "#FF604D",
        term: { ...term, source: "inferred" },
        counts: { assignments: 1, quizzes: 0, exams: 0 },
        ticks: [tick("w-d1", "1010", "WRTG 1150", "#FF604D", "Draft 1: position essay", "assignment", 12, 100, 0.2)],
      },
    ],
  };
}

export function fixtureSkipCosts(): SkipCosts {
  const row = (course_id: string, assignment_id: string, current: number, if_zero: number, if_full: number) => ({
    course_id,
    assignment_id,
    current,
    if_zero,
    if_full,
    swing: Math.round((if_full - if_zero) * 10) / 10,
    share_of_final: null,
    status: "ok" as const,
  });
  return {
    "1300:m-hw4": row("1300", "m-hw4", 88.4, 85.1, 88.9),
    "1300c:c-p2": row("1300c", "c-p2", 91.2, 79.6, 92.4),
    "1010:w-d1": row("1010", "w-d1", 86, 66.8, 88.8),
  };
}

export function fixtureFreshness(): FreshnessDashboard {
  return {
    version: 1,
    generated_at: TODAY,
    changes: [
      { key: "due:m-q2", kind: "due_changed", label: "Due date moved", title: "Quiz 2", course: "MATH 1300", at: iso(-0.2), detected_at: iso(-0.2), url: "https://canvas.example/m-q2", detail: { from: iso(5), to: iso(6) } },
      { key: "ann:c-1", kind: "announcement", label: "Announcement", title: "Project 2 office hours moved to Thursday", course: "CSCI 1300", at: iso(-1), detected_at: iso(-1), url: "https://canvas.example/ann" },
      { key: "grade:w-0", kind: "grade_posted", label: "Grade posted", title: "Reading response 3", course: "WRTG 1150", at: iso(-2), detected_at: iso(-2), url: null },
    ],
    digest: { announcements_7d: 4, with_actions: 1 },
    agent_can_do: [
      {
        id: "block:c-p2",
        kind: "calendar_block",
        label: "Block 90 min for Project 2: recursion",
        why: "Due in the next few days",
        suggestion: { key: "1300c:c-p2", title: "Work on Project 2: recursion", start: iso(2, 20), end: iso(2, 21.5), why: "Due Sat" },
      },
    ],
  };
}

const GRADES: Record<string, [number, string, number, number]> = {
  "1300": [88.4, "B+", 1, 85.1],
  "1300c": [91.2, "A-", 0, 91.2],
  "1010": [86, "B", 1, 80.5],
};

export function fixtureGradeTruth(courseId: string): GradeTruth {
  const g = GRADES[courseId];
  if (!g) return { course_id: courseId };
  return {
    course_id: courseId,
    lead: {
      canvas_says: g[0],
      canvas_letter: g[1],
      unsubmitted_due_count: g[2],
      risk: g[3],
      why: "Canvas counts graded work only. The second number counts work that's due and not turned in as zero.",
    },
  };
}

export function fixtureCourseMap(courseId: string): CourseMap {
  const learn: Record<string, string[]> = {
    "1300": ["Limits and continuity", "Derivative rules", "Chain rule", "Implicit differentiation", "Related rates"],
    "1300c": ["Loops", "Functions", "Recursion", "Arrays"],
    "1010": ["Rhetorical situation", "Position arguments", "Using sources"],
  };
  return {
    course: { id: courseId, html_url: `https://canvas.example/courses/${courseId}` },
    start_here: [{ kind: "syllabus", title: "Syllabus", html_url: `https://canvas.example/courses/${courseId}/syllabus` }],
    learn: (learn[courseId] ?? []).map((title, i) => ({ id: `${courseId}-m${i}`, title })),
    do: [],
  };
}

export function fixtureHealth(): SyncHealth {
  return { state: "fresh_complete", surfaces_enabled: true, sync_id: "fixture", as_of: TODAY };
}

/** Shaped like `advisor.rs` output for a dated, in-window audit copy. */
export function fixtureAdvisor(): AdvisorSnapshot {
  return {
    mode: "tier2_dated_audit",
    as_of: "2026-10-12T16:00:00-06:00",
    program: "Aerospace Engineering Sciences",
    catalog_year: "2025-2026",
    target_grad_term: "Spring 2029",
    official_url: "https://canvas.colorado.edu",
    audit: {
      present: true,
      dated: true,
      imported_on: "2026-10-01",
      stale_days: 12,
      catalog_year: "2025-2026",
      stale: false,
      label: "Audit copied on 2026-10-01",
      remaining_credits: 42,
      complete_count: 7,
      in_progress_count: 3,
      unmet_count: 2,
      in_progress_items: ["APPM 2360", "ASEN 2401", "ASEN 2501"],
      unmet_items: ["Upper-division humanities or social science elective", "ASEN senior design sequence"],
    },
    courses: ["APPM 2360", "ASEN 2401", "ASEN 2501", "WRTG 1150"],
    work_course_ids: [],
    sources: { canvas: "Observed in Canvas", audit: "Your dated audit copy", profile: "Your profile" },
    questions: [
      'What is the best way to finish "Upper-division humanities or social science elective", and when is it offered?',
      'What is the best way to finish "ASEN senior design sequence", and when is it offered?',
      "Is Spring 2029 still realistic with 42 credits left?",
      "Do any transfer, AP, or prior credits apply that are not showing yet?",
      "If registration is tight, which next-term course should I protect first?",
    ],
  };
}

/** Browser-preview stand-in for the public Instructure school search. */
export function fixtureSchools(term: string): { name: string; host: string; account_id: number | null }[] {
  const all = [
    { name: "Ohio State – CarmenCanvas", host: "osu.instructure.com", account_id: 132008 },
    { name: "University of Michigan - Ann Arbor", host: "m.canvas.umich.edu", account_id: 133948 },
    { name: "University of Colorado Boulder - CU Boulder", host: "canvas.colorado.edu", account_id: 128826 },
    { name: "University of Texas at Austin", host: "utexas.instructure.com", account_id: null },
  ];
  const q = term.trim().toLowerCase();
  return q.length < 2 ? [] : all.filter((s) => s.name.toLowerCase().includes(q) || s.host.includes(q));
}
