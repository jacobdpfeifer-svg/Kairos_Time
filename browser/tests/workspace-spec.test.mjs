import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { WORKSPACE_CAPABILITIES as catalogCaps } from "../scripts/lib/workspace/catalog.mjs";
import { WORKSPACE_CAPABILITIES } from "../scripts/lib/workspace/onboarding.mjs";
import { MAX_NAME, validateWorkspaceSpec } from "../scripts/lib/workspace/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = { capabilities: catalogCaps };

function block(capability) {
  return { capability, size: "full", props: {}, visible_when: "always" };
}

function accepted() {
  return {
    schema_version: 1,
    status: "accepted",
    accepted_by: "student",
    surfaces: {
      today: { slots: ["b_today"] },
      week: { slots: ["b_week"] },
      courses: { slots: ["b_courses"] },
      study: { slots: ["b_study"] },
      advisor: { slots: ["b_advisor"] },
    },
    blocks: {
      b_today: block("today.next_action"),
      b_week: block("week.plan"),
      b_courses: block("courses.sources"),
      b_study: block("study.practice"),
      b_advisor: block("advisor.plan"),
    },
  };
}

describe("workspace spec bounds", () => {
  it("accepts the five current screens", () => {
    assert.equal(validateWorkspaceSpec(accepted(), catalog).ok, true);
  });

  it("rejects a spec the student did not accept", () => {
    const spec = accepted();
    spec.accepted_by = "model";
    const result = validateWorkspaceSpec(spec, catalog);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /accepted_by student/);
  });

  it("rejects an unknown capability, a bad predicate, a duplicate, and an over-size surface", () => {
    const unknown = accepted();
    unknown.blocks.b_today.capability = "nope";
    assert.match(validateWorkspaceSpec(unknown, catalog).errors.join(" "), /not in the catalog/);

    const predicate = accepted();
    predicate.blocks.b_today.visible_when = "whenever";
    assert.match(validateWorkspaceSpec(predicate, catalog).errors.join(" "), /unknown predicate/);

    const duplicate = accepted();
    duplicate.surfaces.week.slots = ["b_today"];
    assert.match(validateWorkspaceSpec(duplicate, catalog).errors.join(" "), /more than one surface/);

    const wide = accepted();
    wide.surfaces.today.slots = ["b0", "b1", "b2", "b3", "b4", "b5", "b6"];
    for (const id of wide.surfaces.today.slots) wide.blocks[id] = block("today.next_action");
    assert.match(validateWorkspaceSpec(wide, catalog).errors.join(" "), /more than 6/);
  });

  it("rejects more than 24 blocks and a block that is never placed", () => {
    const spec = accepted();
    for (let n = 0; n < 25; n += 1) spec.blocks[`b_extra_${n}`] = block("today.next_action");
    assert.match(validateWorkspaceSpec(spec, catalog).errors.join(" "), /more than 24/);

    const loose = accepted();
    loose.blocks.b_spare = block("week.plan");
    assert.match(validateWorkspaceSpec(loose, catalog).errors.join(" "), /never placed/);
  });

  it("rejects a prop whose type the capability does not declare", () => {
    const demo = {
      capabilities: [{ id: "demo", surfaces: ["today"], sizes: ["full"], max_instances: 1, requires: [], props: { show: { type: "boolean", default: true } } }],
    };
    const spec = {
      schema_version: 1,
      status: "accepted",
      accepted_by: "student",
      surfaces: { today: { slots: ["b1"] } },
      blocks: { b1: { capability: "demo", size: "full", props: { show: true, extra: 1 }, visible_when: "always" } },
    };
    assert.equal(validateWorkspaceSpec(spec, demo).ok, true, "an unknown key is dropped by the writers, not an error here");

    spec.blocks.b1.props = { show: "no" };
    assert.match(validateWorkspaceSpec(spec, demo).errors.join(" "), /prop show is not a boolean/);
  });

  it("bounds the student-authored name", () => {
    const long = accepted();
    long.name = "x".repeat(MAX_NAME + 1);
    assert.match(validateWorkspaceSpec(long, catalog).errors.join(" "), /name must be text/);

    const wrong = accepted();
    wrong.name = { nested: true };
    assert.match(validateWorkspaceSpec(wrong, catalog).errors.join(" "), /name must be text/);

    const fits = accepted();
    fits.name = "x".repeat(MAX_NAME);
    assert.equal(validateWorkspaceSpec(fits, catalog).ok, true);
  });
});

describe("workspace catalog parity", () => {
  it("onboarding uses the authored catalog", () => {
    assert.deepEqual(WORKSPACE_CAPABILITIES, catalogCaps);
  });

  it("the app and Rust JSON match the authored catalog", () => {
    const res = spawnSync(process.execPath, ["tools/emit-workspace-catalog.mjs", "--check"], { cwd: root, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr || res.stdout);
  });
});
