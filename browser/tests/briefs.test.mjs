import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { briefKind } from "../scripts/lib/briefs/classify.mjs";
import { buildBriefProjection, sectionOrder } from "../scripts/lib/briefs/assemble.mjs";
import { briefPath, writeBriefProjection } from "../scripts/lib/briefs/project.mjs";
import { ACTION_KINDS, validateBrief } from "../scripts/lib/briefs/schema.mjs";
import { FETCHED, NOW, TZ, crowdedRecord, mathRecord, paperRecord, sparseRecord, staleRecord } from "./fixtures/briefs/records.mjs";

const build = (records, extra = {}) => buildBriefProjection({ records, now: NOW, timeZone: TZ, ...extra });
const briefFor = (out, title) => out.briefs.find((b) => b.title.startsWith(title));

test("kind: refines only on a clear signal; a vague title stays honest", () => {
  const math = { label: "MATH 1300 — Calculus 1" };
  assert.equal(briefKind({ kind: "assignment", title: "Problem Set 4", description: "Show your work for every derivative. Section 3.4." }, math), "math");
  assert.equal(briefKind({ kind: "assignment", title: "Homework 7", description: "" }, math), "unknown");
  assert.equal(briefKind({ kind: "assignment", title: "Argument essay draft", description: "1500 words" }, {}), "writing");
  assert.equal(briefKind({ kind: "assignment", title: "Lab 3: titration", description: "x".repeat(50) }, {}), "lab");
  assert.equal(briefKind({ kind: "discussion", title: "Week 4 discussion" }, {}), "discussion");
  assert.equal(briefKind({ kind: "exam", title: "Midterm 2" }, {}), "exam");
});

test("math homework: source locators, a worked example, and never a solution source", () => {
  const out = build([mathRecord()]);
  const b = briefFor(out, "Problem Set 4");
  assert.equal(b.kind, "math");
  assert.equal(b.module.title, "Problem set");
  const labels = b.evidence.map((e) => e.label).join(" | ");
  assert.match(labels, /Worked examples: chain rule/);
  assert.doesNotMatch(labels, /solutions/i, "an answer key must never be offered next to live graded work");
  assert.ok(b.evidence.find((e) => e.kind === "canvas").locator.startsWith("https://"));
  const concept = b.module.sections.find((s) => s.id === "concept_map");
  assert.match(concept.body, /section 3\.4/);
  for (const s of b.module.sections) for (const id of s.evidence_ids || []) assert.ok(b.evidence.some((e) => e.id === id));
  assert.ok(b.checklist.length >= 3 && b.checklist.length <= 7);
  assert.ok(b.requirements.includes("Worth 20 points"));
});

test("sparse Canvas title produces needs_source, not invented themes", () => {
  const out = build([sparseRecord()]);
  const hw = briefFor(out, "Homework 7");
  assert.equal(hw.state, "needs_source");
  assert.equal(hw.module.title, "What we know");
  assert.ok(hw.requirements.includes("Instructions: not found in Canvas"));
  const lti = briefFor(out, "WebAssign 7");
  assert.equal(lti.state, "needs_source");
  assert.match(lti.module.sections[0].body, /external tool you'll open yourself/);
});

test("writing brief marks the outline as a proposal and keeps prompt constraints visible", () => {
  const b = briefFor(build([paperRecord()]), "Argument essay");
  assert.equal(b.kind, "writing");
  const outline = b.module.sections.find((s) => s.id === "outline");
  assert.equal(outline.proposal, true);
  assert.match(outline.body, /isn't your instructor's expected argument/);
  const constraints = b.module.sections.find((s) => s.id === "requirements");
  assert.match(constraints.body, /1500-2000 words/);
  assert.match(constraints.body, /MLA/);
  assert.ok(b.requirements.some((r) => /Cite at least three/.test(r)));
});

test("exam brief links Study and names what still needs a source", () => {
  const b = briefFor(build([mathRecord()]), "Midterm 2");
  assert.equal(b.kind, "exam");
  const primary = b.actions.find((a) => a.primary);
  assert.equal(primary.kind, "study");
  assert.ok(b.module.sections.some((s) => s.id === "needs_source"));
  assert.ok(b.module.sections.find((s) => s.id === "practice_path").proposal);
});

test("stale sources mark the brief stale and change its fingerprint", () => {
  const fresh = briefFor(build([paperRecord()]), "Argument essay");
  const stale = briefFor(build([staleRecord()]), "Argument essay");
  assert.equal(stale.state, "stale");
  assert.match(stale.gaps[0], /hasn't synced/);
  assert.notEqual(fresh.source_fingerprint, stale.source_fingerprint);
});

test("an exam brief does not attach an answer key", () => {
  const rec = mathRecord();
  rec.sources.push({
    id: "page-midterm-key", kind: "page", title: "Midterm 2 answer key", exam_relevant: true,
    url: "https://canvas.example.edu/courses/101/pages/key", text: "1. B", updated_at: FETCHED,
  });
  const b = briefFor(build([rec]), "Midterm 2");
  const labels = b.evidence.map((e) => e.label).join(" | ");
  assert.doesNotMatch(labels, /answer key/i);
  assert.match(labels, /Midterm 2 review/);
});

test("an accepted day's plan stays together when overdue work sits outside it", () => {
  const plan = { schema: 1, weeks: { "2026-10-12": { accepted: { at: "2026-10-12T15:00:00Z", days: { "item-a21": "2026-10-15", "item-a11": "2026-10-15" } } } }, deferrals: {} };
  const overdue = paperRecord();
  overdue.course = { id: "505", name: "History", code: "HIST 1010", label: "HIST 1010", color: "#444444" };
  overdue.items = [{
    id: "item-a51", canvas_id: "51", course_id: "505", title: "Reading response", kind: "assignment", points_possible: 10,
    due_at: new Date(NOW - 5 * 3_600_000).toISOString(), html_url: "https://canvas.example.edu/courses/505/assignments/51",
    submission_types: ["online_text_entry"], completed: false,
    description: "Write two paragraphs responding to the assigned chapter and upload them.",
  }];
  const titles = build([mathRecord(), paperRecord(), overdue], { plan }).index.assignments.map((a) => a.title);
  const ps = titles.indexOf("Problem Set 4: derivatives");
  const essay = titles.indexOf("Argument essay draft");
  const reading = titles.indexOf("Reading response");
  const midterm = titles.indexOf("Midterm 2");
  assert.ok(ps >= 0 && essay === ps + 1, "the two items planned for today stay adjacent, sooner due first");
  assert.ok(midterm > essay && reading > essay, "urgent work that was not in the plan follows today's block");
  assert.ok(reading !== ps + 1 && midterm !== ps + 1);
});

test("four islands by default, six at most, the rest routes to Week", () => {
  const relaxed = build([crowdedRecord(9)], { now: NOW - 3 * 86_400_000 });
  assert.equal(relaxed.index.assignments.length, 4);
  assert.equal(relaxed.index.rest_count, 5);
  const busy = build([crowdedRecord(9)]);
  assert.equal(busy.index.assignments.length, 6);
  assert.equal(busy.index.rest_count, 3);
});

test("exam within three days leads and is flagged as focus", () => {
  const out = build([mathRecord(), paperRecord()]);
  assert.equal(out.index.assignments[0].title, "Midterm 2");
  assert.equal(out.index.assignments[0].focus, true);
  assert.equal(out.index.assignments[0].priority_reason, "Exam in 2 days"); // Oct 17, 9 PM in Denver, two calendar days out
});

test("an accepted Week order wins; new work enters as Changed, not reshuffled in", () => {
  const plan = { schema: 1, weeks: { "2026-10-12": { accepted: { at: "2026-10-12T15:00:00Z", days: { "item-a21": "2026-10-15", "item-a11": "2026-10-16" } } } }, deferrals: {} };
  const out = build([mathRecord(), paperRecord()], { plan });
  const titles = out.index.assignments.map((a) => a.title);
  assert.equal(titles[0], "Argument essay draft");
  assert.equal(out.index.assignments[0].priority_reason, "You planned this for today");
  const midterm = out.index.assignments.find((a) => a.title === "Midterm 2");
  assert.equal(midterm.state, "changed");
  assert.equal(midterm.priority_reason, "New since you planned your week");
});

test("a moved due date is labeled Changed", () => {
  const events = [{ kind: "due_changed", course_id: "202", title: "Argument essay draft", key: "snap-due:202:21:x", detected_at: new Date(NOW - 3_600_000).toISOString(), detail: {} }];
  const island = build([paperRecord()], { events }).index.assignments[0];
  assert.equal(island.state, "changed");
  assert.equal(island.priority_reason, "Due date moved");
});

test("no brief can offer a Canvas submit, comment, or discussion post", () => {
  assert.deepEqual(ACTION_KINDS, ["study", "open_canvas", "open_source", "ask", "calendar_preview", "email_draft"]);
  const out = build([mathRecord(), paperRecord(), sparseRecord()]);
  for (const b of out.briefs) for (const a of b.actions) assert.ok(ACTION_KINDS.includes(a.kind));
  const bad = structuredClone(out.briefs[0]);
  bad.actions.push({ id: "x", label: "Submit", kind: "submit_assignment", availability: "available" });
  assert.throws(() => validateBrief(bad), /actions/);
});

test("preferences only reorder; requirements always render", () => {
  assert.deepEqual(sectionOrder("writing", { paper_first: "outline", default_order: "next_step_first" }).slice(0, 2), ["module", "next_step"]);
  assert.equal(sectionOrder("math", { problem_set_first: "next_step", default_order: "requirements_first" })[0], "requirements");
  for (const kind of ["writing", "math", "exam"]) assert.ok(sectionOrder(kind, { paper_first: "outline", problem_set_first: "concept_map" }).includes("requirements"));
  const prefs = { paper_first: "outline", problem_set_first: "concept_map", default_order: "next_step_first" };
  const b = briefFor(build([mathRecord()], { prefs }), "Problem Set 4");
  assert.equal(b.module.sections[0].id, "concept_map");
});

test("projection: atomic files, stable prepared_at, pruned orphans, per-profile roots", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-"));
  const rootA = path.join(tmp, "a");
  const rootB = path.join(tmp, "b");
  for (const [root, rec] of [[rootA, mathRecord()], [rootB, paperRecord()]]) {
    fs.mkdirSync(path.join(root, "inbox", "study-sources"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "study-sources", `${rec.course.id}.json`), JSON.stringify(rec));
  }
  const first = writeBriefProjection(rootA, { now: NOW, timeZone: TZ });
  assert.equal(first.islands, 2);
  assert.equal(first.changed, true);
  const file = briefPath(rootA, "101", "a11");
  const prepared = JSON.parse(fs.readFileSync(file, "utf8")).prepared_at;
  const mtime = fs.statSync(file).mtimeMs;
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  const second = writeBriefProjection(rootA, { now: NOW + 600_000, timeZone: TZ });
  assert.equal(second.changed, false, "an unchanged signature does not rewrite");
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).prepared_at, prepared, "unchanged sources keep prepared_at");
  fs.writeFileSync(path.join(rootA, "inbox", "briefs", "v1", "101--a99.json"), "{}");
  fs.writeFileSync(path.join(rootA, "inbox", "briefs", "v1", "101--a99--enriched.json"), "{}");
  writeBriefProjection(rootA, { now: NOW, timeZone: TZ });
  assert.ok(!fs.existsSync(path.join(rootA, "inbox", "briefs", "v1", "101--a99.json")));
  assert.ok(!fs.existsSync(path.join(rootA, "inbox", "briefs", "v1", "101--a99--enriched.json")));
  writeBriefProjection(rootB, { now: NOW, timeZone: TZ });
  const idxA = JSON.parse(fs.readFileSync(path.join(rootA, "inbox", "briefs", "v1", "index.json"), "utf8"));
  const idxB = JSON.parse(fs.readFileSync(path.join(rootB, "inbox", "briefs", "v1", "index.json"), "utf8"));
  assert.ok(idxA.assignments.every((a) => a.course_id === "101"));
  assert.ok(idxB.assignments.every((a) => a.course_id === "202"));
  assert.throws(() => briefPath(rootA, "../b", "a11"), /unsafe/);
  assert.equal(FETCHED.length > 0, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a routine source refresh does not make unchanged brief content look updated", () => {
  const firstRecord = mathRecord();
  firstRecord.fetched_at = new Date(NOW - 60_000).toISOString();
  const secondRecord = structuredClone(firstRecord);
  secondRecord.fetched_at = new Date(NOW).toISOString();
  const first = briefFor(build([firstRecord]), "Problem Set 4");
  const second = briefFor(build([secondRecord]), "Problem Set 4");
  assert.ok(first && second);
  assert.equal(first.source_fingerprint, second.source_fingerprint);
});

test("no study-sources yet: nothing written, nothing claimed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-empty-"));
  assert.deepEqual(writeBriefProjection(tmp, { now: NOW, timeZone: TZ }), { ok: true, skipped: "no study-sources yet", changed: false });
  assert.ok(!fs.existsSync(path.join(tmp, "inbox", "briefs")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeInChild(root, now, pauseMs) {
  const projectMod = pathToFileURL(fileURLToPath(new URL("../scripts/lib/briefs/project.mjs", import.meta.url))).href;
  const code = `
    import { writeBriefProjection } from ${JSON.stringify(projectMod)};
    const r = writeBriefProjection(process.env.BRIEF_ROOT, {
      now: Number(process.env.BRIEF_NOW),
      timeZone: ${JSON.stringify(TZ)},
      pauseMs: Number(process.env.BRIEF_PAUSE || 0),
    });
    process.stdout.write(JSON.stringify(r));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      env: { ...process.env, BRIEF_ROOT: root, BRIEF_NOW: String(now), BRIEF_PAUSE: String(pauseMs) },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `writer exited ${code}`));
      else resolve(JSON.parse(out));
    });
  });
}

test("two overlapping writers leave an index that matches the brief files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-race-"));
  const rec = mathRecord();
  fs.mkdirSync(path.join(root, "inbox", "study-sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "inbox", "study-sources", "101.json"), JSON.stringify(rec));
  const [a, b] = await Promise.all([writeInChild(root, NOW, 80), writeInChild(root, NOW, 80)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal([a.changed, b.changed].filter(Boolean).length, 1, "the waiter sees the projection the first writer just committed");
  const index = JSON.parse(fs.readFileSync(path.join(root, "inbox", "briefs", "v1", "index.json"), "utf8"));
  assert.ok(index.assignments.length > 0 && index.assignments.length <= 6);
  for (const row of index.assignments) {
    const body = JSON.parse(fs.readFileSync(briefPath(root, row.course_id, row.assignment_id), "utf8"));
    assert.equal(body.source_fingerprint, row.source_fingerprint);
    assert.equal(body.state, row.brief_state);
    assert.equal(body.priority_reason, row.priority_reason);
    for (const action of body.actions) assert.ok(ACTION_KINDS.includes(action.kind));
  }
  assert.ok(!fs.existsSync(path.join(root, "inbox", "briefs", "v1", ".write.lock")));
  fs.rmSync(root, { recursive: true, force: true });
});
