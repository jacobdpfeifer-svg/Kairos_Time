import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { clearSchoolConfigCache } from "../scripts/lib/school-config.mjs";
import { campusGroupsAllowed, currentCampusGroupsAllowed } from "../scripts/lib/school-gate.mjs";

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

  it("resolves a host-slug profile to cu-boulder and still lets SCHOOL_SLUG refuse", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pn-school-gate-"));
    fs.mkdirSync(path.join(root, "school"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "school", "profile.json"),
      JSON.stringify({ slug: "canvas-colorado-edu", display_name: "CU Boulder", canvas_host: "canvas.colorado.edu" }),
    );
    const previousRoot = process.env.DEV_USER_ROOT;
    const previousSlug = process.env.SCHOOL_SLUG;
    const plugin = path.join(import.meta.dirname, "..", "..", "plugins", "cu-boulder-campusgroups", "open-campusgroups.mjs");
    try {
      delete process.env.SCHOOL_SLUG;
      process.env.DEV_USER_ROOT = root;
      clearSchoolConfigCache();
      assert.equal(currentCampusGroupsAllowed(), true);
      process.env.SCHOOL_SLUG = "other";
      clearSchoolConfigCache();
      assert.equal(currentCampusGroupsAllowed(), false);
      const direct = spawnSync(process.execPath, [plugin], {
        env: { ...process.env, SCHOOL_SLUG: "other", DEV_USER_ROOT: root },
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(direct.status, 2);
      assert.match(direct.stderr, /Refusing before a browser/);
    } finally {
      if (previousRoot === undefined) delete process.env.DEV_USER_ROOT;
      else process.env.DEV_USER_ROOT = previousRoot;
      if (previousSlug === undefined) delete process.env.SCHOOL_SLUG;
      else process.env.SCHOOL_SLUG = previousSlug;
      clearSchoolConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
