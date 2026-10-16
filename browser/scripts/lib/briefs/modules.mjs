/**
 * Kind modules: what each brief adds on top of the common frame. Every
 * section either quotes the assignment / course sources (with evidence ids)
 * or is flagged `proposal: true` — an editable starting point, never the
 * instructor's expected answer. See the "Required kind modules" table in
 * docs/handoff/mission-control-assignment-briefs-architecture-2026-10-15.md.
 *
 * Hard limits enforced here, not in the renderer:
 *   - math: never a solution to a live graded problem; answer keys are never linked;
 *   - writing: an outline is always a proposal; prompt constraints stay visible;
 *   - project/lab: external/LTI tools are the student's to operate;
 *   - reading/discussion: no summary of reading we were not given, no posting;
 *   - sparse: a minimal honest card instead of a padded page.
 */
import { LIMITS, clipText } from "./schema.mjs";

export const ANSWER_SOURCE_RE = /\b(answers?|key|solutions?|solved)\b/i;

/** Lines of the assignment text that state constraints the instructor will check. */
export function constraintLines(text, re, max = 6) {
  const lines = String(text || "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 8 && l.length <= 600);
  const out = [];
  for (const l of lines) {
    if (re.test(l) && !out.includes(l)) out.push(clipText(l, LIMITS.line));
    if (out.length >= max) break;
  }
  return out;
}

const REQUIREMENT_RE = /\b(must|should|required?|include|submit|upload|due|words?|pages?|cite|citations?|format|APA|MLA|Chicago|minimum|at least|no more than|rubric|graded|show (?:all )?(?:your )?work|deliverables?)\b/i;
const LENGTH_FORMAT_RE = /\b(\d{2,4}\s*(?:-|–|to)?\s*\d*\s*(?:words|pages?)|double[- ]spaced|font|margins?|MLA|APA|Chicago|format(?:ted)?|length)\b/i;
const RUBRIC_RE = /\b(rubric|criteria|graded on|points? for|assessed|evaluated)\b/i;
const RESEARCH_RE = /\b(sources?|cite|citations?|references?|bibliography|works cited|peer[- ]reviewed|scholarly|evidence)\b/i;
const TOPIC_RE = /\b(section|chapter|ch\.|§)\s*\d+(?:\.\d+)*|\b(derivatives?|integrals?|limits?|matri(?:x|ces)|vectors?|eigen\w*|probabilit\w*|distributions?|regression|series|differential equations?|proofs?|induction|vectors?|kinematics|forces?|energy|stoichiometry|equilibrium)\b/gi;
const DELIVERABLE_RE = /\b(deliverables?|submit|turn in|upload|report|writeup|write-up|code|repo(?:sitory)?|demo|presentation|slides|milestone|data|results)\b/i;
const TOOL_RE = /\b(github|python|matlab|r studio|rstudio|jupyter|excel|labview|arduino|autocad|solidworks|java|c\+\+|webassign|zybooks|playposit|mastering|aleks|lab ?kit)\b/gi;
const SCOPE_RE = /\b(chapters?|ch\.|pp?\.|pages?|sections?|article|reading|read)\b/i;

export function requirementLines(text) {
  return constraintLines(text, REQUIREMENT_RE, 5);
}

function uniq(list) {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

function topics(text) {
  return uniq((String(text || "").match(TOPIC_RE) || []).map((m) => m.replace(/\s+/g, " ").toLowerCase())).slice(0, 8);
}

function bullet(lines) {
  return lines.map((l) => `- ${l}`).join("\n");
}

function sectionsWithin(sections) {
  return sections.map((s) => ({ ...s, title: clipText(s.title, 120), body: String(s.body).slice(0, LIMITS.body) }));
}

/**
 * @param {object} ctx
 * @param {object} ctx.item           study-sources item
 * @param {string} ctx.kind           BriefKind
 * @param {object[]} ctx.related      related course sources [{evidenceId, source}]
 * @param {object|null} ctx.exam      nearest exam after this item, same course
 * @param {string} ctx.canvasEvidenceId
 * @param {object} ctx.prefs          brief preferences
 * @param {number} ctx.now
 * @returns {{title: string, sections: object[], gaps: string[], proposals: string[]}}
 */
export function buildModule(ctx) {
  const { kind, sparse } = ctx;
  if (sparse && kind !== "exam" && kind !== "quiz") return sparseModule(ctx);
  switch (kind) {
    case "exam":
    case "quiz":
      return examModule(ctx);
    case "math":
      return mathModule(ctx);
    case "writing":
      return writingModule(ctx);
    case "project":
    case "lab":
      return projectModule(ctx);
    case "reading":
    case "discussion":
      return readingModule(ctx);
    default:
      return generalModule(ctx);
  }
}

function sourceList(related) {
  return related.map((r) => `- ${r.source.title}`).join("\n");
}

function examModule({ item, kind, related, examCoverage, canvasEvidenceId, now }) {
  const gaps = [];
  const examSources = related.filter((r) => r.source.exam_relevant || /review|study guide|practice/i.test(r.source.title));
  const covered = examSources.length ? examSources : related;
  const due = Date.parse(item.due_at || "");
  const days = Number.isFinite(due) ? Math.max(0, Math.ceil((due - now) / 86_400_000)) : null;
  const sections = [];
  sections.push({
    id: "coverage",
    title: "What it covers",
    body: covered.length
      ? `Course materials that mention this ${kind}:\n${sourceList(covered)}`
      : `Canvas does not say what this ${kind} covers. Add the study guide or topic list and this brief will use it.`,
    evidence_ids: covered.map((r) => r.evidenceId),
  });
  if (!covered.length) gaps.push("Coverage not found in Canvas");
  const confidence = examCoverage?.confidence || (covered.length >= 3 ? "medium" : "low");
  sections.push({
    id: "source_coverage",
    title: "How sure this is",
    body: `Coverage confidence: ${confidence}. ${examCoverage?.inferred !== false ? "The date and scope are inferred from Canvas titles, not confirmed by your instructor." : ""}`.trim(),
    evidence_ids: [canvasEvidenceId],
  });
  if (days != null) {
    const plan = [];
    const steps = Math.min(Math.max(days, 1), 5);
    for (let d = steps; d >= 1; d--) {
      if (d === steps && steps > 1) plan.push(`${d} days out: one retrieval set from each covered source, no notes.`);
      else if (d === 1) plan.push("Day before: mixed practice from your misses, then sleep.");
      else plan.push(`${d} days out: re-work what you missed, then one new set.`);
    }
    sections.push({ id: "practice_path", title: "A practice path", body: bullet(plan), proposal: true });
  }
  sections.push({
    id: "retrieval",
    title: "Retrieval prompts",
    body: covered.length
      ? bullet(covered.slice(0, 4).map((r) => `Without notes: explain the main idea of “${r.source.title}” in three sentences.`))
      : "Retrieval prompts need a source. Add your notes or the study guide first.",
    proposal: true,
    evidence_ids: covered.slice(0, 4).map((r) => r.evidenceId),
  });
  sections.push({
    id: "needs_source",
    title: "What still needs a source",
    body: covered.length ? "Anything your instructor said in class that isn't in Canvas. Add it as a note so practice covers it." : "Everything: there are no course materials for this yet.",
  });
  return { title: kind === "exam" ? "Exam prep" : "Quiz prep", sections: sectionsWithin(sections), gaps, proposals: ["Do one timed practice set in Study", "Mark the topics you missed for tomorrow"] };
}

function mathModule({ item, related, exam, prefs, canvasEvidenceId }) {
  const gaps = [];
  const found = topics(`${item.title}\n${item.description}`);
  // Answer keys and solutions are never offered next to live graded work.
  const examples = related.filter((r) => !ANSWER_SOURCE_RE.test(r.source.title));
  const sections = [
    {
      id: "concept_map",
      title: "Topics and notation in the assignment",
      body: found.length ? bullet(found) : "The assignment text doesn't name its topics. Check the section numbers in Canvas.",
      evidence_ids: [canvasEvidenceId],
    },
    {
      id: "worked_example_link",
      title: "A worked example from your course",
      body: examples.length
        ? `Read one of these before you start. They come from your course and aren't solutions to this assignment:\n${sourceList(examples.slice(0, 3))}`
        : "No worked example found in your course materials.",
      evidence_ids: examples.slice(0, 3).map((r) => r.evidenceId),
    },
    {
      id: "error_checks",
      title: "Error checks before you submit",
      body: bullet(["Units and signs on every answer", "Plug one answer back into the original equation", "Is the size of each answer reasonable?"]),
      proposal: true,
    },
  ];
  if (!found.length) gaps.push("Topics not named in Canvas");
  if (!examples.length) gaps.push("No worked example in course sources");
  if (exam) sections.push({ id: "feeds", title: "Where this shows up next", body: `The same topics are likely on ${exam.label} (inferred from Canvas).`, evidence_ids: [canvasEvidenceId] });
  const first = prefs?.problem_set_first || "next_step";
  if (first !== "next_step") sections.sort((a, b) => Number(b.id === first) - Number(a.id === first));
  return { title: "Problem set", sections: sectionsWithin(sections), gaps, proposals: ["List the topic each problem uses", "Attempt the first problem before looking anything up"] };
}

function writingModule({ item, related, prefs, canvasEvidenceId }) {
  const gaps = [];
  const constraints = constraintLines(item.description, LENGTH_FORMAT_RE);
  const rubric = constraintLines(item.description, RUBRIC_RE);
  const research = constraintLines(item.description, RESEARCH_RE);
  if (!rubric.length) gaps.push("Rubric not found in Canvas");
  const sections = [
    {
      id: "requirements",
      title: "Prompt constraints",
      body: constraints.length ? bullet(constraints) : "Length and format not found in Canvas. Ask your instructor or check the syllabus.",
      evidence_ids: [canvasEvidenceId],
    },
    { id: "rubric", title: "How it's graded", body: rubric.length ? bullet(rubric) : "Rubric not found in Canvas.", evidence_ids: rubric.length ? [canvasEvidenceId] : [] },
    {
      id: "research",
      title: "Sources it asks for",
      body: research.length ? bullet(research) : "No source requirement found. Citations listed here have not been checked.",
      evidence_ids: research.length ? [canvasEvidenceId] : [],
    },
    {
      id: "outline",
      title: "A starting outline (yours to change)",
      body: bullet([
        "Your claim in one sentence",
        "Reason 1 and the evidence for it",
        "Reason 2 and the evidence for it",
        "The strongest objection, and your answer to it",
        "What follows if you're right",
      ]) + "\n\nThis is a generic shape. It isn't your instructor's expected argument.",
      proposal: true,
    },
    {
      id: "revision",
      title: "Revision checklist",
      body: bullet(["Every prompt requirement above is met", "Each paragraph supports the claim", "Every quote and fact is cited", "Read it aloud once"]),
      proposal: true,
    },
  ];
  if (related.length) sections.splice(3, 0, { id: "course_sources", title: "Course readings that may help", body: sourceList(related.slice(0, 4)), evidence_ids: related.slice(0, 4).map((r) => r.evidenceId) });
  const first = prefs?.paper_first || "requirements";
  if (first === "outline") sections.sort((a, b) => Number(b.id === "outline") - Number(a.id === "outline"));
  return { title: "Paper", sections: sectionsWithin(sections), gaps, proposals: ["Write your claim in one sentence", "Match each rubric line to a paragraph"] };
}

function projectModule({ item, kind, canvasEvidenceId }) {
  const gaps = [];
  const deliverables = constraintLines(item.description, DELIVERABLE_RE);
  const tools = uniq((String(item.description || "").match(TOOL_RE) || []).map((m) => m.toLowerCase()));
  const external = (item.submission_types || []).includes("external_tool");
  if (!deliverables.length) gaps.push("Deliverables not listed in Canvas");
  const sections = [
    { id: "deliverables", title: "Deliverables", body: deliverables.length ? bullet(deliverables) : "Deliverables not found in Canvas.", evidence_ids: deliverables.length ? [canvasEvidenceId] : [] },
    {
      id: "tools",
      title: "Tools you'll use",
      body:
        (tools.length ? bullet(tools) : "No tools named in Canvas.") +
        (external ? "\n\nThis is submitted through an external tool. You'll open and use it yourself; Kairos can't operate it." : ""),
      evidence_ids: tools.length || external ? [canvasEvidenceId] : [],
    },
    {
      id: "risks",
      title: "What could block you",
      body: bullet(["Setup or install problems: try the tools today", "Partner availability, if this is group work", "Anything you have to wait on (data, equipment, approvals)"]),
      proposal: true,
    },
    { id: "verify", title: "How you'll know it works", body: bullet(["Check each deliverable against the instructions", "Run it or test it once end-to-end before the deadline"]), proposal: true },
    { id: "first_step", title: "A first step you can undo", body: "Make a folder or branch for this, and copy the instructions into a checklist.", proposal: true },
  ];
  return { title: kind === "lab" ? "Lab" : "Project", sections: sectionsWithin(sections), gaps, proposals: ["Set up the tools and open the starter files", "Write the deliverables as a checklist"] };
}

function readingModule({ item, kind, related, exam, canvasEvidenceId }) {
  const scope = constraintLines(item.description, SCOPE_RE, 4);
  const gaps = scope.length ? [] : ["Reading scope not found in Canvas"];
  const sections = [
    { id: "scope", title: kind === "discussion" ? "What the prompt asks" : "What to read", body: scope.length ? bullet(scope) : "Scope not found in Canvas.", evidence_ids: scope.length ? [canvasEvidenceId] : [] },
    {
      id: "arc",
      title: "Why it's in the course",
      body: exam ? `It leads into ${exam.label} (inferred from Canvas).` : related.length ? `Related course materials:\n${sourceList(related.slice(0, 3))}` : "Canvas doesn't say how this fits the course.",
      evidence_ids: related.slice(0, 3).map((r) => r.evidenceId),
    },
    {
      id: "prompts",
      title: "Questions to read with",
      body: bullet(["What's the main claim?", "What evidence holds it up?", "Where would you push back?"]),
      proposal: true,
    },
  ];
  if (kind === "discussion") {
    sections.push({
      id: "draft_path",
      title: "Drafting your post",
      body: "Write your post yourself: one claim, one piece of evidence, one question for classmates. Kairos never posts to Canvas for you.",
      proposal: true,
    });
  }
  return { title: kind === "discussion" ? "Discussion" : "Reading", sections: sectionsWithin(sections), gaps, proposals: ["Read once for the main claim", "Write two questions you'd ask in class"] };
}

function generalModule({ item, related, canvasEvidenceId }) {
  const req = requirementLines(item.description);
  const sections = [
    { id: "asks", title: "What it asks for", body: req.length ? bullet(req) : clipText(item.description, 600), evidence_ids: [canvasEvidenceId] },
  ];
  if (related.length) sections.push({ id: "materials", title: "Course materials that may help", body: sourceList(related.slice(0, 4)), evidence_ids: related.slice(0, 4).map((r) => r.evidenceId) });
  return { title: "Assignment", sections: sectionsWithin(sections), gaps: req.length ? [] : ["Requirements not stated clearly in Canvas"], proposals: ["Turn each requirement into a checklist line"] };
}

function sparseModule({ item, canvasEvidenceId }) {
  const external = (item.submission_types || []).includes("external_tool");
  const visible = [];
  if (item.description?.trim()) visible.push(clipText(item.description, 300));
  visible.push(item.points_possible != null ? `Worth ${item.points_possible} points` : "Points not found in Canvas");
  if (external) visible.push("Done in an external tool you'll open yourself");
  return {
    title: "What we know",
    sections: sectionsWithin([
      { id: "visible", title: "What Canvas shows", body: bullet(visible), evidence_ids: [canvasEvidenceId] },
      { id: "questions", title: "Questions to resolve", body: bullet(["What exactly is being submitted?", "How is it graded?", "Is there a reading or source it depends on?"]) },
      { id: "prepare", title: "Prepare after you add sources", body: "Add the instructions, handout, or your notes and this brief will fill in. Until then, there's nothing more to say honestly." },
    ]),
    gaps: ["Canvas has almost no instructions for this"],
    proposals: [],
  };
}
