/**
 * Brief kind: which module a brief gets. Builds on the semester `kind`
 * (study-sources classifyItem: exam/quiz/discussion/assignment/other) and only
 * refines "assignment" when the title or the course gives a clear signal. A
 * vague title stays "assignment" (or "unknown" when there is nothing to read)
 * — the brief must not invent a math module from the word "Homework".
 */

const MATH_COURSE = /\b(math|calc|calculus|algebra|stat|statistics|physics|phys|chem|econ|appm|engineering|differential|linear|discrete|probability)\b/i;
const MATH_TITLE = /\b(problem set|pset|problems?|exercises?|webassign|worksheet|derivative|integral|equations?|matrix|proof)\b/i;
const MATH_TEXT = /\b(solve|compute|show your work|derive|prove|evaluate|simplify|integrate|differentiate|section \d+\.\d+)\b/i;
const WRITING_TITLE = /\b(essay|paper|draft|thesis|reflection|memo|report|response paper|literature review|op-?ed|annotated bibliography|argument)\b/i;
const WRITING_TEXT = /\b(\d{3,4}\s*words|\d+\s*(?:-|–|to)?\s*\d*\s*pages?|double[- ]spaced|MLA|APA|Chicago style|thesis statement|cite|citations?|works cited|bibliography)\b/i;
const PROJECT_TITLE = /\b(project|milestone|prototype|deliverable|capstone|presentation|portfolio|repo|implementation)\b/i;
const LAB_TITLE = /\b(lab|laboratory|experiment|practicum)\b/i;
const READING_TITLE = /\b(reading|read|chapter|ch\.|article|textbook|pp\.)\b/i;

/** True when Canvas gives us nothing to build a brief from. */
export function isSparse(item) {
  const desc = String(item?.description || "").trim();
  return desc.length < 40;
}

export function isExternalTool(item) {
  const types = (item?.submission_types || []).map(String);
  return types.includes("external_tool") || Boolean(item?.lti);
}

/**
 * @param {{kind?: string, title?: string, description?: string, submission_types?: string[]}} item
 * @param {{name?: string, code?: string, label?: string}} course
 * @returns {import("../../../../app/src/missionControl/contracts.ts").BriefKind}
 */
export function briefKind(item, course = {}) {
  const base = String(item?.kind || "assignment");
  if (base === "exam") return "exam";
  if (base === "quiz") return "quiz";
  if (base === "discussion") return "discussion";
  const title = String(item?.title || "");
  const text = String(item?.description || "");
  const courseText = `${course.code || ""} ${course.name || ""} ${course.label || ""}`;
  if (LAB_TITLE.test(title)) return "lab";
  if (PROJECT_TITLE.test(title)) return "project";
  if (WRITING_TITLE.test(title) || (WRITING_TEXT.test(text) && !MATH_TEXT.test(text))) return "writing";
  if (MATH_TITLE.test(title) && (MATH_COURSE.test(courseText) || MATH_TEXT.test(text))) return "math";
  if (MATH_COURSE.test(courseText) && MATH_TEXT.test(text)) return "math";
  if (READING_TITLE.test(title)) return "reading";
  if (isSparse(item)) return "unknown";
  return "assignment";
}
