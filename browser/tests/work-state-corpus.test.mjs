/**
 * Golden corpus for the work-state projection (program gate 1).
 *
 * Every case in browser/tests/fixtures/work-state/cases.mjs is rebuilt from
 * local artifacts and compared against a frozen projection under
 * tests/fixtures/work-state/. Regenerate deliberately, and read the diff:
 *
 *   UPDATE_WORK_STATE_FIXTURES=1 node --test tests/work-state-corpus.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { CASES, NOW } from "./fixtures/work-state/cases.mjs";
import { rebuildWorkState, readWorkState } from "../scripts/lib/work-state.mjs";

const GOLDEN = path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "work-state");
const UPDATE = process.env.UPDATE_WORK_STATE_FIXTURES === "1";

/** Generation ids and timestamps move every run; the facts under them must not. */
function normalize(read) {
  return {
    ok: read.ok,
    reason: read.reason,
    fell_back: read.fell_back,
    coverage: read.state?.coverage ?? null,
    source: read.state ? { ...read.state.source, canvas_sync_id: read.state.source.canvas_sync_id ? "<sync>" : null } : null,
    courses: read.state?.courses ?? null,
    work_items: read.state?.work_items ?? null,
    health: read.health
      ? {
          inputs: read.health.inputs,
          orphans: read.health.orphans,
          ambiguous_plan_ids: read.health.ambiguous_plan_ids,
          unmatched_change_count: read.health.unmatched_change_count,
          ignored_change_count: read.health.ignored_change_count,
          errors: read.health.errors,
        }
      : null,
  };
}

describe("work-state golden corpus", () => {
  for (const kase of CASES) {
    it(`${kase.name}: ${kase.why}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `pn-corpus-${kase.name}-`));
      try {
        kase.seed(root);
        const built = rebuildWorkState(root, { now: NOW });
        assert.equal(built.ok, true, `rebuild failed: ${built.reason}`);
        const actual = normalize(readWorkState(root));
        const file = path.join(GOLDEN, `${kase.name}.json`);
        if (UPDATE) {
          fs.mkdirSync(GOLDEN, { recursive: true });
          fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
          return;
        }
        assert.ok(fs.existsSync(file), `missing golden file ${file}. Regenerate with UPDATE_WORK_STATE_FIXTURES=1`);
        assert.deepEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("a rebuild is byte-identical on a second run", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pn-corpus-stable-"));
    try {
      CASES.find((c) => c.name === "capture-and-deferral").seed(root);
      const first = rebuildWorkState(root, { now: NOW });
      const second = rebuildWorkState(root, { now: "2026-10-24T18:00:00.000Z" });
      assert.equal(second.unchanged, true);
      assert.equal(second.generation_id, first.generation_id);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
