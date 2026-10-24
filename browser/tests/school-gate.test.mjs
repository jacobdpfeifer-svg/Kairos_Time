import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { campusGroupsAllowed } from "../scripts/lib/school-gate.mjs";

const shim = path.join(import.meta.dirname, "..", "scripts", "rsvp-campusgroups.mjs");

describe("CampusGroups school gate", () => {
  it("refuses a missing or non-CU slug before spawning the plugin", () => {
    assert.equal(campusGroupsAllowed("other"), false);
    assert.equal(campusGroupsAllowed(""), false);
    const refused = spawnSync(process.execPath, [shim], {
      env: { ...process.env, SCHOOL_SLUG: "other" },
      encoding: "utf8",
    });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /Refusing before a browser/);
  });

  it("allows an explicit CU Boulder slug", () => {
    assert.equal(campusGroupsAllowed("cu-boulder"), true);
  });
});
