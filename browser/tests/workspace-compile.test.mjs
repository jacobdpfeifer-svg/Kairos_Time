import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { compileWorkspace } from "../scripts/lib/workspace/compile.mjs";
import { WORKSPACE_CAPABILITIES } from "../scripts/lib/workspace/catalog.mjs";
import { normalizeWorkflowDraft } from "../scripts/lib/workspace/onboarding.mjs";
import { MAX_BLOCKS_PER_SURFACE, MAX_BLOCKS_TOTAL, SURFACES, validateWorkspaceSpec } from "../scripts/lib/workspace/bounds.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/workspace");
const NOW = "2026-10-21T18:00:00.000Z";
const catalogIds = new Set(WORKSPACE_CAPABILITIES.map((item) => item.id));

const EXPECT = {
  "deadline-tracker": {
    template: "weekly-planner",
    capabilities: ["today.next_action", "week.plan", "advisor.plan"],
    home: "week",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
  },
  "course-organizer": {
    template: "course-command",
    capabilities: ["today.next_action", "courses.sources"],
    home: "courses",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
  },
  "study-first": {
    template: "study-first",
    capabilities: ["today.next_action", "week.plan", "courses.sources", "study.practice"],
    home: "study",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
  },
  "notification-sensitive": {
    template: "quiet-minimal",
    capabilities: ["today.next_action"],
    home: "today",
    interrupt_for: ["sync_broken"],
  },
  "calendar-planner": {
    template: "weekly-planner",
    capabilities: ["today.next_action", "week.plan", "advisor.plan"],
    home: "week",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
    integrations: [{ name: "Google Calendar", state: "requested" }],
  },
  "unsupported-tool": {
    template: "course-command",
    capabilities: ["today.next_action", "courses.sources"],
    home: "courses",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
    integrations: [{ name: "Notion", state: "requested" }],
  },
  "self-contradicting": {
    template: "weekly-planner",
    capabilities: ["today.next_action", "week.plan"],
    home: "week",
    interrupt_for: ["due_moved"],
  },
  "prompt-injection": {
    template: "weekly-planner",
    capabilities: ["today.next_action", "week.plan", "advisor.plan"],
    home: "week",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
  },
  "empty-answers": {
    template: "calm-daily",
    capabilities: ["today.next_action"],
    home: "today",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
  },
  "canvas-submit": {
    template: "calm-daily",
    capabilities: ["today.next_action", "week.plan"],
    home: "today",
    interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"],
    integrations: [{ name: "Canvas submit", state: "not_available" }],
  },
};

function load(id) {
  return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
}

function compileFixture(id) {
  const fixture = load(id);
  const draft = normalizeWorkflowDraft(fixture.input, { now: fixture.now, sessionId: fixture.sessionId });
  return compileWorkspace(draft, { now: fixture.now });
}

function capabilitiesOf(spec) {
  const caps = [];
  for (const name of SURFACES) {
    for (const id of spec.surfaces[name].slots) caps.push(spec.blocks[id].capability);
  }
  return caps;
}

function shape(result) {
  const spec = result.spec;
  return {
    status: spec.status,
    accepted_by: spec.accepted_by ?? null,
    home: spec.home,
    density: spec.density,
    template_id: spec.origin.template_id,
    surfaces: spec.surfaces,
    capabilities: capabilitiesOf(spec),
    sizes: capabilitiesOf(spec).map((id) => spec.blocks[`b_${id.replaceAll(".", "_")}`].size),
    predicates: capabilitiesOf(spec).map((id) => spec.blocks[`b_${id.replaceAll(".", "_")}`].visible_when),
    interrupt_for: spec.quiet.interrupt_for,
    integrations: spec.requested_integrations.map((item) => ({ name: item.name, state: item.state })),
  };
}

function changesCap(overrides = {}) {
  return {
    id: "today.changes",
    label: "What changed",
    surfaces: ["today"],
    sizes: ["full"],
    props: {},
    supports: ["tracking_deadlines"],
    requires: [],
    max_instances: 1,
    availability: "available",
    weight: 5,
    ...overrides,
  };
}

describe("compileWorkspace", () => {
  const ids = Object.keys(EXPECT);

  it("covers the ten evaluation transcripts", () => {
    const onDisk = fs.readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".golden.json")).map((name) => name.replace(/\.json$/, "")).sort();
    assert.deepEqual(onDisk, [...ids].sort());
  });

  for (const id of ids) {
    it(`compiles ${id} into the reviewed layout`, () => {
      const result = compileFixture(id);
      const golden = JSON.parse(fs.readFileSync(path.join(dir, `${id}.golden.json`), "utf8"));
      const expected = EXPECT[id];
      assert.deepEqual(result, golden);

      const checked = validateWorkspaceSpec(result.spec, { capabilities: WORKSPACE_CAPABILITIES });
      assert.equal(checked.ok, true, checked.errors?.join("; "));
      assert.equal(result.spec.status, "proposed");
      assert.equal(result.spec.accepted_by, undefined);
      assert.equal(result.spec.accepted_at, undefined);
      assert.equal(result.spec.origin.template_id, expected.template);
      assert.equal(result.spec.home, expected.home);
      assert.deepEqual(capabilitiesOf(result.spec), expected.capabilities);
      assert.deepEqual(result.spec.quiet.interrupt_for, expected.interrupt_for);
      assert.deepEqual(
        result.spec.requested_integrations.map((item) => ({ name: item.name, state: item.state })),
        expected.integrations ?? [],
      );

      for (const block of Object.values(result.spec.blocks)) {
        assert.equal(catalogIds.has(block.capability), true);
        assert.equal(Object.hasOwn(block, "component"), false);
      }
      for (const name of SURFACES) {
        assert.ok(result.spec.surfaces[name].slots.length <= MAX_BLOCKS_PER_SURFACE);
      }
      assert.ok(Object.keys(result.spec.blocks).length <= MAX_BLOCKS_TOTAL);
      for (const item of result.spec.requested_integrations) {
        assert.ok(item.state === "requested" || item.state === "not_available");
        assert.notEqual(item.state, "available");
      }
      assert.deepEqual(Object.keys(result.rationale), Object.keys(result.spec.blocks));
      for (const line of Object.values(result.rationale)) assert.match(line, /^[^.]+\./);

      assert.deepEqual(result.patches.map((patch) => patch.op), [
        "set_density",
        "set_home",
        "set_quiet",
        ...result.patches.filter((patch) => patch.op === "place").map(() => "place"),
        "done",
      ]);
      for (const patch of result.patches) {
        if (patch.op !== "place") continue;
        assert.equal(patch.narration, result.rationale[patch.block_id]);
      }

      const encoded = JSON.stringify(result);
      for (let n = 0; n < 99; n += 1) assert.equal(JSON.stringify(compileFixture(id)), encoded);
    });
  }

  it("ignores injected instructions when they only change the student's words", () => {
    const clean = shape(compileFixture("deadline-tracker"));
    const hostile = shape(compileFixture("prompt-injection"));
    assert.deepEqual(hostile, clean);
    assert.equal(JSON.stringify(compileFixture("prompt-injection").spec).includes("submit_assignment"), false);
    assert.equal(JSON.stringify(compileFixture("prompt-injection").spec).includes("Shell"), false);
  });

  it("records a Canvas submit request without a submit capability", () => {
    const { spec } = compileFixture("canvas-submit");
    assert.equal(spec.status, "proposed");
    assert.equal(capabilitiesOf(spec).some((id) => /submit/i.test(id)), false);
    assert.equal(spec.requested_integrations[0].state, "not_available");
  });

  it("does not let a model-supplied status or block map through", () => {
    const { spec } = compileWorkspace({
      preference: "one_next_step",
      frictions: [],
      status: "accepted",
      accepted_by: "model",
      blocks: { hack: { capability: "submit_assignment", size: "huge" } },
      proposed_template: "study-first",
      ideal_workflow: "Ok",
    }, { now: NOW });
    assert.equal(spec.status, "proposed");
    assert.equal(spec.accepted_by, undefined);
    assert.equal(spec.origin.template_id, "calm-daily");
    assert.equal(capabilitiesOf(spec).includes("submit_assignment"), false);
  });

  it("requires an explicit clock", () => {
    assert.throws(() => compileWorkspace({ preference: "one_next_step" }, {}), /now is required/);
  });

  it("drops today.changes for a quiet preference and keeps it otherwise", () => {
    const catalog = [...WORKSPACE_CAPABILITIES, changesCap({ supports: ["staying_calm"], weight: 15 })];
    const quiet = compileWorkspace(normalizeWorkflowDraft({ preference: "quiet_minimal", frictions: ["staying_calm"], ideal_workflow: "Quiet." }, { now: NOW }), { catalog, now: NOW });
    assert.equal(capabilitiesOf(quiet.spec).includes("today.changes"), false);

    const daily = compileWorkspace(normalizeWorkflowDraft({ preference: "one_next_step", frictions: ["staying_calm"], ideal_workflow: "Show changes." }, { now: NOW }), { catalog, now: NOW });
    assert.equal(capabilitiesOf(daily.spec).includes("today.changes"), true);
    assert.equal(daily.spec.blocks.b_today_changes.visible_when, "has_changes");
  });

  it("never places an optional connector as a working block", () => {
    const catalog = [...WORKSPACE_CAPABILITIES, changesCap({ availability: "optional_connector", supports: ["planning_time"] })];
    const result = compileWorkspace(normalizeWorkflowDraft({ preference: "weekly_overview", frictions: ["planning_time"], ideal_workflow: "Use the calendar." }, { now: NOW }), { catalog, now: NOW });
    assert.equal(capabilitiesOf(result.spec).includes("today.changes"), false);
    assert.deepEqual(result.spec.requested_integrations, []);
  });

  it("orders one surface by the stated lead, then by catalog weight", () => {
    const catalog = [...WORKSPACE_CAPABILITIES, changesCap()];
    const lead = compileWorkspace(normalizeWorkflowDraft({ preference: "one_next_step", frictions: ["tracking_deadlines"], ideal_workflow: "Deadlines." }, { now: NOW }), { catalog, now: NOW });
    assert.deepEqual(lead.spec.surfaces.today.slots, ["b_today_next_action", "b_today_changes"]);

    const weight = compileWorkspace(normalizeWorkflowDraft({ preference: "study_first", frictions: ["tracking_deadlines"], ideal_workflow: "Deadlines." }, { now: NOW }), { catalog, now: NOW });
    assert.deepEqual(weight.spec.surfaces.today.slots, ["b_today_changes", "b_today_next_action"]);
  });

  it("drops a block whose required companion was excluded", () => {
    const catalog = [
      ...WORKSPACE_CAPABILITIES.map((cap) => (cap.id === "today.next_action" ? { ...cap, requires: ["today.changes"] } : cap)),
      changesCap({ supports: [] }),
    ];
    const result = compileWorkspace(normalizeWorkflowDraft({ preference: "quiet_minimal", frictions: [], ideal_workflow: "Quiet." }, { now: NOW }), { catalog, now: NOW });
    assert.equal(capabilitiesOf(result.spec).includes("today.next_action"), false);
    assert.equal(capabilitiesOf(result.spec).includes("today.changes"), false);
    assert.equal(validateWorkspaceSpec(result.spec, { capabilities: catalog }).ok, true);
  });

  it("streams blocks so that every frame of the live build is a valid spec", () => {
    // WorkspaceStudio replays this stream one patch at a time and validates each
    // frame, so a block may not land before a companion its capability requires.
    const catalog = [
      ...WORKSPACE_CAPABILITIES.map((cap) => (cap.id === "today.next_action" ? { ...cap, requires: ["study.practice"] } : cap)),
      changesCap({ requires: ["advisor.plan"] }),
    ];
    const result = compileWorkspace(
      normalizeWorkflowDraft({ preference: "one_next_step", frictions: ["tracking_deadlines", "planning_time"], ideal_workflow: "Next thing." }, { now: NOW }),
      { catalog, now: NOW },
    );
    assert.equal(validateWorkspaceSpec(result.spec, { capabilities: catalog }).ok, true);

    const frame = { ...result.spec, status: "proposed", blocks: {}, surfaces: Object.fromEntries(SURFACES.map((name) => [name, { slots: [] }])) };
    let frames = 0;
    for (const patch of result.patches) {
      if (patch.op !== "place") continue;
      frames += 1;
      frame.blocks[patch.block_id] = patch.block;
      frame.surfaces[patch.surface].slots.splice(patch.index, 0, patch.block_id);
      const checked = validateWorkspaceSpec(frame, { capabilities: catalog });
      assert.equal(checked.ok, true, `frame ${frames} (${patch.block.capability}): ${checked.errors.join("; ")}`);
    }
    assert.ok(frames > 1);
    // The last frame is the spec itself, in the same slot order.
    for (const name of SURFACES) assert.deepEqual(frame.surfaces[name].slots, result.spec.surfaces[name].slots);
  });

  it("throws when a placed block requires a capability that is not in the catalog", () => {
    const catalog = WORKSPACE_CAPABILITIES.map((cap) => (cap.id === "today.next_action" ? { ...cap, requires: ["missing.cap"] } : cap));
    assert.throws(
      () => compileWorkspace(normalizeWorkflowDraft({ preference: "one_next_step", frictions: [], ideal_workflow: "Next." }, { now: NOW }), { catalog, now: NOW }),
      /compileWorkspace: spec failed validation: today\.next_action requires missing\.cap/,
    );
  });
});
