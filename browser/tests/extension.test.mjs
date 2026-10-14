import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canvasGet, isAllowedBase, isAllowedPath, trimPlannerItem, trimStreamItem } from "../../app/extension-chrome/lib/canvas-read.js";
import { assignmentFromUrl, blockBefore, costLine } from "../../app/extension-chrome/lib/format.js";
import { checklistItems, honestPath } from "../../app/extension-chrome/lib/assignment-plan.js";
import { BLOT_MODULES, BLOT_SOURCE_DIR, BLOT_TARGET_DIR, MODULES, TARGET_DIR, vendoredBlotText, vendoredText } from "../../app/extension-chrome/tools/vendor-shared.mjs";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "extension-chrome");

describe("extension: read-only Canvas access", () => {
  it("allows only the four read endpoints", () => {
    for (const ok of [
      "/api/v1/users/self/activity_stream/summary",
      "/api/v1/users/self/activity_stream?per_page=30&only_active_courses=true",
      "/api/v1/planner/items?start_date=x&end_date=y",
      "/api/v1/courses/12/assignments/34",
    ]) {
      assert.equal(isAllowedPath(ok), true, ok);
    }
    for (const bad of [
      "/api/v1/courses/12/assignments/34/submissions",
      "/api/v1/courses/12/discussion_topics/5/entries",
      "/api/v1/conversations",
      "/api/v1/courses/12/assignments/../../conversations",
      "/api/v1/users/self/activity_stream/summary/../x",
      "https://evil.example/api/v1/planner/items",
      "api/v1/planner/items",
      "/courses/12/assignments/34",
    ]) {
      assert.equal(isAllowedPath(bad), false, bad);
    }
  });

  it("accepts only clean https origins, and reads one only after Chrome grants it", () => {
    assert.equal(isAllowedBase("https://canvas.colorado.edu/"), true);
    assert.equal(isAllowedBase("https://cuboulder.instructure.com/"), true);
    // Any school's Canvas has this shape; Chrome's per-origin grant is the gate.
    assert.equal(isAllowedBase("https://canvas.myschool.edu/"), true);
    for (const bad of ["http://canvas.colorado.edu/", "https://canvas.colorado.edu/x", "https://10.0.0.1/", "https://localhost/", "https://canvas.colorado.edu:444/", "javascript:alert(1)"]) {
      assert.equal(isAllowedBase(bad), false, bad);
    }
    const sw = fs.readFileSync(path.join(EXT, "sw.js"), "utf8");
    assert.match(sw, /chrome\.permissions\.contains\(\{ origins: \[originPattern\(base\)\] \}\)/, "reads require a Chrome host grant");
    assert.match(sw, /async function canvasBase\(\) \{\n  const \{ base \} = await get\("base"\);\n  return \(await canRead\(base\)\) \? base : null;/);
  });

  it("sends a plain credentialed GET and parses Canvas's JSON guard", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { status: 200, text: async () => 'while(1);[{"type":"Announcement"}]' };
    };
    const res = await canvasGet("https://canvas.colorado.edu/", "/api/v1/users/self/activity_stream/summary", { fetchImpl });
    assert.equal(seen.init.method, "GET");
    assert.equal(seen.init.credentials, "include");
    assert.deepEqual(Object.keys(seen.init.headers), ["Accept"]);
    assert.equal(seen.url, "https://canvas.colorado.edu/api/v1/users/self/activity_stream/summary");
    assert.deepEqual(res, { ok: true, status: 200, json: [{ type: "Announcement" }] });
    await assert.rejects(canvasGet("https://canvas.colorado.edu/", "/api/v1/conversations", { fetchImpl }));
    const unauth = await canvasGet("https://canvas.colorado.edu/", "/api/v1/planner/items", {
      fetchImpl: async () => ({ status: 401, text: async () => '{"status":"unauthenticated"}' }),
    });
    assert.equal(unauth.ok, false);
    assert.equal(unauth.status, 401);
  });

  it("has no write path, no CSRF use, and never renders Canvas text as HTML", () => {
    const files = ["sw.js", "panel.js", "ui/dashboard.js", ...fs.readdirSync(path.join(EXT, "lib")).map((f) => `lib/${f}`)];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(EXT, rel), "utf8");
      assert.doesNotMatch(text, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i, `${rel}: write method`);
      assert.doesNotMatch(text, /_csrf_token|X-CSRF-Token/i, `${rel}: CSRF token`);
      assert.doesNotMatch(text, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|\beval\(|new Function\(/, `${rel}: HTML sink`);
      assert.doesNotMatch(text, /chrome\.cookies|document\.cookie/, `${rel}: cookie access`);
    }
  });

  it("asks Chrome for the minimum permissions", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
    // scripting: run the dashboard stage on a school Canvas the student granted at runtime.
    assert.deepEqual([...manifest.permissions].sort(), ["alarms", "nativeMessaging", "scripting", "sidePanel", "storage"]);
    assert.deepEqual(manifest.host_permissions, ["https://canvas.colorado.edu/*", "https://*.instructure.com/*"]);
    // Any other school is asked for one origin at a time, https only, never granted up front.
    assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
    assert.deepEqual(manifest.content_scripts[0].matches, manifest.host_permissions);
    assert.equal(manifest.background.type, "module");
  });

  it("trims stream and planner items to the fields the classifier reads", () => {
    const item = trimStreamItem({ type: "Announcement", id: 1, message: "x".repeat(5000), secret_field: "nope", root_discussion_entries: [1, 2] });
    assert.equal(item.message.length, 4000);
    assert.equal("secret_field" in item, false);
    assert.equal("root_discussion_entries" in item, false);
    const p = trimPlannerItem({ plannable_type: "assignment", plannable: { title: "HW", due_at: "d", body: "long" }, submissions: { x: 1 } });
    assert.deepEqual(Object.keys(p.plannable).sort(), ["created_at", "due_at", "points_possible", "title"]);
    assert.equal("submissions" in p, false);
  });
});

describe("extension: shared modules", () => {
  it("vendored copies match the brain's source", () => {
    for (const name of MODULES) {
      const have = fs.readFileSync(path.join(TARGET_DIR, `${name}.js`), "utf8");
      assert.equal(have, vendoredText(name), `shared/${name}.js drifted — run node app/extension-chrome/tools/vendor-shared.mjs`);
    }
  });

  it("vendored Blot engine matches app/src/blot/core and covers every runtime module", () => {
    for (const name of BLOT_MODULES) {
      const have = fs.readFileSync(path.join(BLOT_TARGET_DIR, `${name}.js`), "utf8");
      assert.equal(have, vendoredBlotText(name), `shared/blot/${name}.js drifted — run node app/extension-chrome/tools/vendor-shared.mjs`);
    }
    const runtime = fs
      .readdirSync(BLOT_SOURCE_DIR)
      .filter((f) => f.endsWith(".js") && !f.includes(".test."))
      .map((f) => f.replace(/\.js$/, ""))
      .sort();
    assert.deepEqual(runtime, [...BLOT_MODULES].sort());
  });
});

describe("extension: panel helpers", () => {
  it("formats cost lines only when there is something honest to say", () => {
    assert.equal(costLine(null), null);
    assert.equal(costLine({ status: "cannot_calculate", if_zero: null }), null);
    assert.deepEqual(costLine({ status: "ok", current: 84, if_zero: 66, if_full: 86, share_of_final: 10 }), {
      skip: "84.0% → 66.0%",
      full: "86.0%",
      share: "10.0%",
      estimate: false,
    });
    assert.equal(costLine({ status: "estimate", current: null, if_zero: 0, if_full: 100 }).estimate, true);
  });

  it("suggests a block only when it is still in the future", () => {
    assert.equal(blockBefore(new Date(Date.now() + 60 * 60 * 1000).toISOString()), null);
    const slot = blockBefore(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    assert.equal(Date.parse(slot.end) - Date.parse(slot.start), 90 * 60 * 1000);
  });

  it("reads assignment ids from Canvas URLs", () => {
    assert.deepEqual(assignmentFromUrl("https://canvas.colorado.edu/courses/12/assignments/34?module_item_id=9"), { courseId: "12", assignmentId: "34" });
    assert.equal(assignmentFromUrl("https://canvas.colorado.edu/courses/12/assignments"), null);
    assert.equal(assignmentFromUrl("not a url"), null);
  });

  it("builds the checklist from the rubric, else from the instructions", () => {
    const withRubric = checklistItems({ rubric: [{ id: "r1", description: "Thesis", points: 5 }] });
    assert.deepEqual(withRubric, [{ id: "r1", text: "Thesis", long: "", points: 5 }]);
    const fromText = checklistItems({ description: "<ul><li>Answer all five questions</li><li>Show your work clearly</li><li>ok</li></ul>" });
    assert.deepEqual(fromText.map((i) => i.text), ["Answer all five questions", "Show your work clearly"]);
  });

  it("orders the path by rubric points and ends with a self-check", () => {
    const steps = honestPath({ rubric: [{ description: "Style", points: 2 }, { description: "Analysis", points: 10 }, { description: "Sources", points: 5 }] });
    assert.match(steps[1], /Analysis \(10 pts\), then Sources \(5 pts\)/);
    assert.match(steps.at(-1), /submit in Canvas/);
  });
});
