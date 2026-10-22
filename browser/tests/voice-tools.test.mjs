import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { voicePaths } from "../scripts/lib/voice/config.mjs";
import { goalsTemplate } from "../scripts/lib/voice/notes.mjs";
import { extractSection } from "../scripts/lib/voice/md.mjs";
import { buildToolDeclarations, createToolHandlers, listCourseCodes } from "../scripts/lib/voice/tools.mjs";

const NOW = () => new Date("2026-09-30T18:00:00Z"); // 12:00 MT → 2026-09-30

let dir;
let paths;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-tools-"));
  paths = voicePaths(dir);
  fs.mkdirSync(paths.coursesDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.coursesDir, "CSCI1200.md"),
    "# CSCI1200\n\n## Class notes\n\n- **2026-09-09** — lists\n",
  );
  fs.writeFileSync(path.join(paths.coursesDir, "APPM1235-webassign.md"), "# not a course\n");
  fs.mkdirSync(path.join(paths.coursesDir, "_raw"));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("listCourseCodes", () => {
  it("lists CODE.md course files only", () => {
    assert.deepEqual(listCourseCodes(paths.coursesDir), ["CSCI1200"]);
  });

  it("returns [] when the directory is missing", () => {
    assert.deepEqual(listCourseCodes(path.join(dir, "nope")), []);
  });
});

describe("buildToolDeclarations", () => {
  it("exposes exactly save_goal and append_class_note by default, with the course enum", () => {
    const [{ functionDeclarations }] = buildToolDeclarations(["CSCI1200", "ECON2010"]);
    assert.deepEqual(
      functionDeclarations.map((f) => f.name),
      ["save_goal", "append_class_note"],
    );
    assert.deepEqual(functionDeclarations[1].parameters.properties.course_code.enum, ["CSCI1200", "ECON2010"]);
  });

  it("adds a workspace draft tool only for an onboarding session", () => {
    const [{ functionDeclarations }] = buildToolDeclarations(["CSCI1200"], { onboarding: true });
    assert.deepEqual(functionDeclarations.map((f) => f.name), ["save_goal", "append_class_note", "save_workflow_draft"]);
    assert.deepEqual(functionDeclarations[2].parameters.properties.interrupt_for.items.enum, ["due_moved", "high_stakes_48h", "sync_broken"]);
  });

  it("drops append_class_note when there are no course files", () => {
    const [{ functionDeclarations }] = buildToolDeclarations([]);
    assert.deepEqual(functionDeclarations.map((f) => f.name), ["save_goal"]);
  });
});

describe("save_goal", () => {
  it("creates goals.md from the template and appends the capture", async () => {
    const tools = createToolHandlers({ paths, sessionId: "sess1", now: NOW });
    const res = await tools.handle("save_goal", {
      category: "career",
      statement: "I want to build a company\nnot just work at one",
      why: "freedom",
      horizon: "career",
    });
    assert.deepEqual(res, {
      ok: true,
      saved: "goal",
      category: "career",
      statement: "I want to build a company not just work at one",
    });
    const md = fs.readFileSync(paths.goalsPath, "utf8");
    assert.match(md, /\*\*2026-09-30\*\* \[career · career\] I want to build a company not just work at one — why: freedom _\(voice sess1\)_/);
  });

  it("rejects unknown categories and empty statements without writing", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    assert.equal((await tools.handle("save_goal", { category: "vibes", statement: "x" })).ok, false);
    assert.equal((await tools.handle("save_goal", { category: "career", statement: "  " })).ok, false);
    assert.equal(fs.existsSync(paths.goalsPath), false);
  });

  it("coerces an unknown horizon to unspecified", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    await tools.handle("save_goal", { category: "skill", statement: "x", horizon: "someday" });
    assert.doesNotMatch(fs.readFileSync(paths.goalsPath, "utf8"), /·/);
  });

  it("leaves no temp files behind", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    await tools.handle("save_goal", { category: "career", statement: "x" });
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")), []);
  });
});

describe("append_class_note", () => {
  it("appends to the course's Class notes (course code is case-insensitive)", async () => {
    const tools = createToolHandlers({ paths, sessionId: "sess1", now: NOW });
    const res = await tools.handle("append_class_note", { course_code: "csci1200", note: "loops finally click" });
    assert.equal(res.ok, true);
    assert.equal(res.course_code, "CSCI1200");
    const md = fs.readFileSync(path.join(paths.coursesDir, "CSCI1200.md"), "utf8");
    assert.match(md, /lists\n- \*\*2026-09-30\*\* — loops finally click \(voice: sess1\)\n$/);
  });

  it("refuses course codes that are not real course files", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    const res = await tools.handle("append_class_note", { course_code: "../../USER", note: "x" });
    assert.equal(res.ok, false);
    assert.match(res.error, /CSCI1200/);
  });

  it("reports where the mastery gap went", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    const res = await tools.handle("append_class_note", { course_code: "CSCI1200", note: "n", mastery_gap: "slicing" });
    assert.equal(res.mastery, "kept in note"); // fixture has no mastery section
  });
});

describe("handle", () => {
  it("returns an error result for unknown tools instead of throwing", async () => {
    const tools = createToolHandlers({ paths, now: NOW });
    const res = await tools.handle("submit_assignment", {});
    assert.equal(res.ok, false);
    assert.match(res.error, /can't do that from here/);
    assert.match(res.error, /unknown tool: submit_assignment/);
    assert.equal(res.recorded, "request");
    const md = fs.readFileSync(paths.goalsPath, "utf8");
    assert.match(md, /\[request\] Asked for submit_assignment/);
  });

  it("writes an onboarding workflow proposal as a draft, never an applied workspace", async () => {
    const tools = createToolHandlers({ paths, sessionId: "sess1", onboarding: true, now: NOW });
    const res = await tools.handle("save_workflow_draft", {
      ideal_workflow: "I want a calm next step every day",
      frictions: ["finding_next_action"],
      preference: "one_next_step",
      proposed_template: "calm-daily",
    });
    assert.equal(res.ok, true);
    const draft = JSON.parse(fs.readFileSync(res.file, "utf8"));
    assert.equal(draft.status, "draft");
    assert.equal(draft.proposed_template, "calm-daily");
  });

  it("records a named tool in tool-gaps without offering a connection", async () => {
    const tools = createToolHandlers({ paths, sessionId: "sess1", onboarding: true, now: NOW });
    const res = await tools.handle("save_workflow_draft", {
      ideal_workflow: "I keep class notes in Notion and WebAssign",
      frictions: ["remembering_course_context"],
      preference: "course_by_course",
      proposed_template: "course-command",
      requested_integrations: ["Notion", "WebAssign"],
    });
    assert.equal(res.ok, true);
    const gaps = fs.readFileSync(path.join(dir, "tool-gaps.md"), "utf8");
    assert.match(gaps, /\| Notion \| — \| No connector in registry — flag only; do not auto-build \|/);
    assert.match(gaps, /\| WebAssign \| — \| No connector in registry — flag only; do not auto-build \|/);
    assert.doesNotMatch(gaps, /\bConnect\b|oauth/i);
  });

  it("turns filesystem failures into error results", async () => {
    const blocker = path.join(dir, "blocked");
    fs.writeFileSync(blocker, "a file, not a directory");
    const tools = createToolHandlers({ paths: { ...paths, goalsPath: path.join(blocker, "goals.md") }, now: NOW });
    const res = await tools.handle("save_goal", { category: "career", statement: "x" });
    assert.equal(res.ok, false);
  });
});

describe("goals.md template", () => {
  it("has the sections the writer and prompt depend on", () => {
    const md = goalsTemplate("2026-10-06");
    assert.notEqual(extractSection(md, "Raw captures"), null);
    assert.notEqual(extractSection(md, "Distilled"), null);
    assert.match(md, /^Updated: \d{4}-\d{2}-\d{2}$/m);
  });
});
