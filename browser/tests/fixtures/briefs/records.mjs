/**
 * Synthetic study-sources records for the Mission Control brief tests: one
 * of each shape the handoff names (math, paper, exam, sparse/LTI, stale).
 * No real student data. NOW is a fixed Wednesday morning in Denver.
 */
export const NOW = Date.parse("2026-10-15T15:00:00Z");
export const TZ = "America/Denver";
export const FETCHED = "2026-10-15T14:00:00Z";

const hours = (h) => new Date(NOW + h * 3_600_000).toISOString();

export function mathRecord() {
  return {
    schema: 2,
    course: { id: "101", name: "Calculus 1", code: "MATH 1300", label: "MATH 1300 — Calculus 1", color: "#2E86AB" },
    fetched_at: FETCHED,
    sources: [
      { id: "page-chain-rule", kind: "page", title: "Worked examples: chain rule derivatives", url: "https://canvas.example.edu/courses/101/pages/chain", text: "Example 1. Differentiate sin(x^2)...", updated_at: FETCHED },
      { id: "page-ps4-solutions", kind: "page", title: "Problem Set 4 derivatives solutions", url: "https://canvas.example.edu/courses/101/pages/ps4-sol", text: "1. 2x cos(x^2)", updated_at: FETCHED },
      { id: "module_page-review", kind: "module_page", title: "Midterm 2 review", url: null, text: "Chain rule, implicit differentiation", exam_relevant: true },
    ],
    items: [
      {
        id: "item-a11", canvas_id: "11", course_id: "101", title: "Problem Set 4: derivatives", kind: "assignment", points_possible: 20, weight_share: 0.04,
        due_at: hours(30), html_url: "https://canvas.example.edu/courses/101/assignments/11", submission_types: ["online_upload"], completed: false,
        description: "Complete problems 1-12 from Section 3.4 and Section 3.5.\nShow your work for every derivative.\nSubmit a single PDF.",
      },
      {
        id: "item-a12", canvas_id: "12", course_id: "101", title: "Midterm 2", kind: "exam", points_possible: 100, weight_share: 0.2,
        due_at: hours(60), html_url: "https://canvas.example.edu/courses/101/assignments/12", submission_types: ["on_paper"], completed: false, description: "In class. Covers chapter 3.",
      },
      { id: "item-a13", canvas_id: "13", course_id: "101", title: "Problem Set 3", kind: "assignment", points_possible: 20, due_at: hours(-100), completed: true, description: "done" },
    ],
    exams: [{ id: "canvas-exam-101-a12", label: "Midterm 2", due_at: hours(60), kind: "assignment", inferred: true, confidence: "low" }],
  };
}

export function paperRecord() {
  return {
    schema: 2,
    course: { id: "202", name: "Writing and Rhetoric", code: "WRTG 3020", label: "WRTG 3020 — Writing and Rhetoric", color: "#C44569" },
    fetched_at: FETCHED,
    sources: [{ id: "page-toulmin", kind: "page", title: "Argument structure: Toulmin model", url: "https://canvas.example.edu/courses/202/pages/toulmin", text: "Claim, grounds, warrant." }],
    items: [
      {
        id: "item-a21", canvas_id: "21", course_id: "202", title: "Argument essay draft", kind: "assignment", points_possible: 50, weight_share: 0.1,
        due_at: hours(80), html_url: "https://canvas.example.edu/courses/202/assignments/21", submission_types: ["online_upload"], completed: false,
        description: "Write a 1500-2000 words argument essay on a campus policy.\nUse MLA format, double-spaced.\nCite at least three scholarly sources.\nGraded on the rubric: thesis, evidence, organization, style.",
      },
    ],
    exams: [],
  };
}

export function sparseRecord() {
  return {
    schema: 2,
    course: { id: "303", name: "General Chemistry Lab", code: "CHEM 1114", label: "CHEM 1114 — General Chemistry Lab", color: "#2A9D8F" },
    fetched_at: FETCHED,
    sources: [],
    items: [
      { id: "item-a31", canvas_id: "31", course_id: "303", title: "Homework 7", kind: "assignment", points_possible: 10, due_at: hours(20), html_url: "https://canvas.example.edu/courses/303/assignments/31", submission_types: ["online_upload"], completed: false, description: "" },
      { id: "item-a32", canvas_id: "32", course_id: "303", title: "WebAssign 7", kind: "assignment", points_possible: 15, due_at: hours(44), html_url: "https://canvas.example.edu/courses/303/assignments/32", submission_types: ["external_tool"], completed: false, description: "" },
    ],
    exams: [],
  };
}

export function staleRecord() {
  const r = paperRecord();
  r.fetched_at = new Date(NOW - 5 * 86_400_000).toISOString();
  return r;
}

/** Many due-soon rows, to exercise the four-by-default / six-max rule. */
export function crowdedRecord(n = 9) {
  return {
    schema: 2,
    course: { id: "404", name: "Busy Course", code: "BUSY 1000", label: "BUSY 1000", color: "#7B68EE" },
    fetched_at: FETCHED,
    sources: [],
    items: Array.from({ length: n }, (_, i) => ({
      id: `item-a4${i}`, canvas_id: `4${i}`, course_id: "404", title: `Worksheet ${i + 1}`, kind: "assignment", points_possible: 10,
      due_at: hours(5 + i * 4), html_url: `https://canvas.example.edu/courses/404/assignments/4${i}`, submission_types: ["online_upload"], completed: false,
      description: "Answer every question on the worksheet and upload a PDF of your work.",
    })),
    exams: [],
  };
}
