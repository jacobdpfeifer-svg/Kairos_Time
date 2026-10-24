import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { stableStringify } from "../scripts/lib/canvas-model.mjs";
import { fixtureGeneration, partialOutage, wellStructured } from "../scripts/lib/canvas-reliability-fixtures.mjs";
import { promoteProjections } from "../scripts/lib/canvas-project.mjs";
import { readPointer } from "../scripts/lib/canvas-store.mjs";
import { loadWorkInputs, readWorkState, rebuildWorkState, reduceWorkState, workPaths } from "../scripts/lib/work-state.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pn-work-state-"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function seedCanvas(root, generation) {
  promoteProjections(root, generation, { now: Date.parse("2026-10-23T18:00:00Z") });
}

describe("work-state projection", () => {
  it("reports a missing projection on a profile with no work-state directory", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "week.md"), "# week\n");
    const read = readWorkState(root);
    assert.equal(read.reason, "missing");
    assert.equal(fs.existsSync(path.join(root, "inbox", "week.md")), true);
  });

  it("keeps an empty canvas account distinct from a missing sync", () => {
    const root = tmpRoot();
    const built = rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" });
    assert.equal(built.ok, true);
    const read = readWorkState(root);
    assert.equal(read.state.coverage.canvas, "missing");
    assert.equal(read.state.work_items.length, 0);
    assert.equal(read.state.source.canvas_sync_id, null);
    assert.equal(read.health.inputs.canvas.status, "missing");
  });

  it("is deterministic across source order and idempotent on disk", () => {
    const root = tmpRoot();
    seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    const first = rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" });
    const second = rebuildWorkState(root, { now: "2026-10-24T18:00:00.000Z" });
    assert.equal(second.unchanged, true);
    assert.equal(second.generation_id, first.generation_id);
    const read = readWorkState(root);
    const inputs = loadWorkInputs(root);
    const reversed = structuredClone(inputs);
    reversed.canvas.work_surface.items.reverse();
    const forward = reduceWorkState(inputs, { now: "2026-10-23T18:00:00.000Z" });
    const backward = reduceWorkState(reversed, { now: "2026-10-23T18:00:00.000Z" });
    forward.state.generated_at = null;
    backward.state.generated_at = null;
    assert.equal(stableStringify(forward), stableStringify(backward));
    const hw = read.state.work_items.find((item) => item.id === "canvas:cu-boulder:1300:assignment:101");
    assert.ok(hw);
    assert.equal(hw.title, "Homework 1");
    assert.equal(hw.canvas.submission_state.length > 0, true);
    assert.equal(Object.hasOwn(hw, "description"), false);
    assert.equal(JSON.stringify(read.state).includes("syllabus"), false);
  });

  it("annotates a moved due date once and keeps a deferral plus an orphan", () => {
    const root = tmpRoot();
    seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    writeJson(path.join(root, "inbox", "plan", "week.json"), {
      schema: 1,
      default_hours: 10,
      weeks: { "2026-10-19": { accepted: { at: "2026-10-19T00:00:00Z", days: { "item-a101": "2026-10-24", "item-a102": "2026-10-24" } } } },
      estimates: { "item-a101": 45, "item-a99999": 15 },
      deferrals: { "item-a101": { to: "2026-10-26", at: "2026-10-20T00:00:00Z" } },
      pile_moves: {},
    });
    fs.mkdirSync(path.join(root, "inbox", "freshness"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "freshness", "events.jsonl"), `${JSON.stringify({
      key: "snap-due:1300:101:2026-10-28T16:00:00Z",
      kind: "due_changed",
      course_id: "1300",
      title: "Homework 1",
      url: "https://canvas.example/courses/1300/assignments/101",
      detected_at: "2026-10-22T00:00:00Z",
      detail: { from: "2026-09-22T16:00:00Z", to: "2026-10-28T16:00:00Z", preview: "do not copy" },
    })}\n`);
    fs.appendFileSync(path.join(root, "inbox", "plan", "items.jsonl"), `${JSON.stringify({
      id: "cap-abc",
      title: "Office hours question",
      day: "2026-10-24",
      created_at: "2026-10-20T00:00:00Z",
    })}\n`);
    const read = readWorkState(rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" }) && root);
    const hw = read.state.work_items.find((item) => item.id === "canvas:cu-boulder:1300:assignment:101");
    assert.equal(hw.change.kind, "due_moved");
    assert.equal(hw.change.from, "2026-09-22T16:00:00Z");
    assert.equal(JSON.stringify(hw).includes("do not copy"), false);
    assert.equal(read.state.work_items.filter((item) => item.change?.kind === "due_moved").length, 1);
    assert.equal(hw.student.status, "deferred");
    assert.equal(hw.student.planned_day, "2026-10-26");
    assert.equal(hw.student.estimate_minutes, 45);
    assert.equal(hw.due_at, "2026-09-22T16:00:00Z");
    const orphan = read.state.work_items.find((item) => item.id === "plan:item-a99999");
    assert.ok(orphan);
    assert.equal(orphan.canvas, null);
    assert.equal(orphan.student.estimate_minutes, 15);
    const capture = read.state.work_items.find((item) => item.id === "capture:cap-abc");
    assert.equal(capture.student.status, "planned");
    const sameDay = read.state.work_items.filter((item) => item.student.planned_day === "2026-10-24");
    const orders = sameDay.map((item) => item.student.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  });

  it("joins planner changes by their stable course and object ids, never by title", () => {
    const root = tmpRoot();
    seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    fs.mkdirSync(path.join(root, "inbox", "freshness"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "freshness", "events.jsonl"), `${JSON.stringify({
      key: "planner-due:1300:assignment:101:2026-10-29T16:00:00.000Z",
      kind: "due_changed",
      course_id: "1300",
      title: "A reused assignment title is not an identifier",
      detected_at: "2026-10-23T00:00:00Z",
      detail: { from: "2026-10-22T16:00:00.000Z", to: "2026-10-29T16:00:00.000Z" },
    })}\n`);
    const read = readWorkState(rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" }) && root);
    const hw = read.state.work_items.find((item) => item.id === "canvas:cu-boulder:1300:assignment:101");
    assert.equal(hw.change.kind, "due_moved");
    assert.equal(hw.change.to, "2026-10-29T16:00:00.000Z");
    assert.equal(read.health.unmatched_change_count, 0);
  });

  it("keeps student decisions when canvas coverage is partial and plan is missing on a later profile", () => {
    const root = tmpRoot();
    writeJson(path.join(root, "inbox", "plan", "week.json"), {
      schema: 1,
      default_hours: null,
      weeks: {},
      estimates: { "item-a601": 30 },
      deferrals: {},
      pile_moves: {},
    });
    seedCanvas(root, fixtureGeneration({
      courses: [partialOutage()],
      complete: false,
      failed_endpoints: [{ endpoint: "modules:1600", status: 500 }],
    }));
    const partial = readWorkState(rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" }) && root);
    assert.equal(partial.state.coverage.canvas, "partial");
    const project = partial.state.work_items.find((item) => item.canvas_id === undefined && item.id.endsWith(":601"));
    assert.ok(project);
    assert.equal(project.student.estimate_minutes, 30);
    assert.equal(project.study.readiness, "unavailable");
    const noPlan = tmpRoot();
    seedCanvas(noPlan, fixtureGeneration({ courses: [wellStructured()] }));
    const bare = readWorkState(rebuildWorkState(noPlan, { now: "2026-10-23T18:00:00.000Z" }) && noPlan);
    assert.equal(bare.state.coverage.plan, "missing");
    assert.equal(bare.state.work_items.every((item) => item.student.status == null), true);
  });

  it("preserves the pointer when promotion throws and rejects an escaping pointer", () => {
    const root = tmpRoot();
    seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" });
    const before = fs.readFileSync(workPaths(root).pointer, "utf8");
    writeJson(path.join(root, "inbox", "plan", "week.json"), {
      schema: 1, default_hours: 1, weeks: {}, estimates: { "item-a101": 20 }, deferrals: {}, pile_moves: {},
    });
    const failed = rebuildWorkState(root, {
      now: "2026-10-23T19:00:00.000Z",
      beforePointer() {
        throw new Error("disk full");
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.preserved, true);
    assert.equal(fs.readFileSync(workPaths(root).pointer, "utf8"), before);
    writeJson(workPaths(root).pointer, {
      schema_version: 1,
      generation_id: "ws-evil",
      content_hash: "nope",
      path: "../../outside",
      previous_generation_id: null,
      finished_at: "2026-10-23T18:00:00.000Z",
    });
    const escaped = readWorkState(root);
    assert.equal(escaped.reason, "unconfined");
    assert.equal(escaped.state, null);
  });

  it("falls back to the previous generation when the current state is malformed", () => {
    const root = tmpRoot();
    const first = rebuildWorkState(root, { now: "2026-10-23T18:00:00.000Z" });
    seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    const second = rebuildWorkState(root, { now: "2026-10-23T19:00:00.000Z" });
    assert.notEqual(first.generation_id, second.generation_id);
    const pointer = readPointer(workPaths(root).pointer);
    fs.writeFileSync(path.join(root, pointer.path, "state.json"), "{");
    const read = readWorkState(root);
    assert.equal(read.fell_back, true);
    assert.equal(read.state.coverage.canvas, "missing");
  });

  it("bounds a 10_000-item reduction", () => {
    const items = [];
    for (let course = 0; course < 200; course += 1) {
      for (let assignment = 0; assignment < 50; assignment += 1) {
        items.push({
          tenant_id: "cu-boulder",
          course_id: String(course),
          object_type: "assignment",
          canvas_id: String(assignment),
          title: `Item ${assignment}`,
          description: "<p>not copied</p>",
          effective_due_at: "2026-10-25T23:59:00Z",
          html_url: "https://canvas.example/a",
          submission_state: "unsubmitted",
          course_code: `C${course}`,
          course_name: `Course ${course}`,
          id: `cu-boulder|${course}|assignment|${assignment}`,
        });
      }
    }
    const inputs = {
      canvas: {
        work_surface: { items, sync_id: "sync-scale" },
        health: { state: "fresh_complete", timezone: "America/Denver", failed_endpoints: [] },
        pointer: { sync_id: "sync-scale" },
      },
      canvasCoverage: "ok",
      week: null,
      weekStatus: "missing",
      captures: { status: "missing", rows: [], skipped: 0 },
      planStatus: "missing",
      planRevision: "none",
      freshness: { status: "missing", events: [], skipped: 0 },
      study: { status: "missing", value: null },
    };
    const started = performance.now();
    const built = reduceWorkState(inputs, { now: "2026-10-23T18:00:00.000Z", timezone: "America/Denver" });
    const elapsed = performance.now() - started;
    const bytes = Buffer.byteLength(JSON.stringify(built.state));
    assert.equal(built.state.work_items.length, 10000);
    assert.equal(built.state.courses.length, 200);
    assert.equal(JSON.stringify(built.state).includes("not copied"), false);
    console.log(`SCALE_WORK_STATE ms=${elapsed.toFixed(1)} bytes=${bytes}`);
  });
});
