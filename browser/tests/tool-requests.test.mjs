import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ASSESSMENT_TOOL_RE, writeToolGapsFile } from "../scripts/lib/canvas-session.mjs";
import {
  ASSESSMENT_NAME_RE,
  GAP_NOTE,
  integrationRequestState,
  reconcileToolGapsMarkdown,
  requestSentence,
} from "../scripts/lib/tool-request-state.mjs";
import { recordAskedFor, writeAskedFor } from "../scripts/lib/tool-requests.mjs";

const ROW = `| Notion | — | ${GAP_NOTE} |`;

let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("integration request state", () => {
  it("uses the same assessment pattern as course inventory", () => {
    assert.equal(ASSESSMENT_NAME_RE.source, ASSESSMENT_TOOL_RE.source);
    assert.equal(ASSESSMENT_NAME_RE.flags, ASSESSMENT_TOOL_RE.flags);
  });

  it("keeps ordinary tools requested and refuses assessment or Canvas acts", () => {
    assert.equal(integrationRequestState("Notion"), "requested");
    assert.equal(integrationRequestState("Google Calendar"), "requested");
    assert.equal(integrationRequestState("CampusGroups"), "requested");
    assert.equal(integrationRequestState("cu-boulder/campusgroups"), "requested");
    for (const name of ["WebAssign", "ZyBooks", "Gradescope", "PlayPosit", "Honorlock", "Respondus LockDown"]) {
      assert.equal(integrationRequestState(name), "not_available", name);
    }
    assert.equal(integrationRequestState("Canvas submit"), "not_available");
    assert.equal(integrationRequestState("discussion post"), "not_available");
    assert.equal(requestSentence("Notion"), "It would exist only if a maintainer reviews it and ships a connector in an update.");
    assert.equal(requestSentence("WebAssign"), "Kairos will not add a connector for this. You use it yourself in the browser.");
    assert.match(requestSentence("Google Calendar"), /already in the list above/);
    assert.match(requestSentence("Outlook"), /already in the list above/);
    assert.equal(
      requestSentence("CampusGroups"),
      "A reviewed connector for this already ships with Kairos. This list does not start a connection.",
    );
    assert.equal(requestSentence("cu-boulder/campusgroups"), requestSentence("CampusGroups"));
    assert.doesNotMatch(requestSentence("CampusGroups"), /\bConnect\b|oauth/i);
    assert.doesNotMatch(requestSentence("Notion"), /\bConnect\b|oauth/i);
  });
});

describe("tool-gaps asked-for section", () => {
  it("appends the shared row and keeps it across a sync rewrite", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-gaps-"));
    const file = path.join(dir, "tool-gaps.md");
    fs.writeFileSync(file, "# Tool connector gaps\n\n## Gaps\n\n_None._\n");
    writeAskedFor(dir, ["Notion", "notion", "A|B"]);
    const written = fs.readFileSync(file, "utf8");
    assert.match(written, /\| Notion \| — \| No connector in registry — flag only; do not auto-build \|\n/);
    assert.match(written, /\| A\/B \| — \| No connector in registry — flag only; do not auto-build \|/);
    assert.equal(written.split("| Notion |").length - 1, 1);
    assert.match(written, /## Gaps/);
    assert.equal(fs.statSync(file).mode & 0o077, 0);

    const synced = writeToolGapsFile(
      [{ code: "PHYS", courseName: "Physics", tools: [{ bucket: "A", slug: "gradebook", name: "Gradebook" }] }],
      { today: "2026-10-21", file },
    );
    const after = fs.readFileSync(synced.path, "utf8");
    assert.match(after, /\| Gradebook \| PHYS \| No connector in registry — flag only; do not auto-build \|/);
    assert.match(after, new RegExp(ROW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(after, /oauth/i);

    writeAskedFor(dir, []);
    const left = fs.readFileSync(file, "utf8");
    assert.match(left, /\| Gradebook \|/);
    assert.doesNotMatch(left, /Asked for on this Mac/);
    assert.doesNotMatch(left, /Notion/);
  });

  it("records the union of the draft and the accepted spec, then drops a removed name", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-gaps-union-"));
    const workspace = path.join(dir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "onboarding-draft.json"),
      `${JSON.stringify({ status: "draft", requested_integrations: ["Notion"] }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(workspace, "workspace.json"),
      `${JSON.stringify({ requested_integrations: [{ name: "Obsidian", state: "requested" }] }, null, 2)}\n`,
    );
    recordAskedFor(dir);
    const both = fs.readFileSync(path.join(dir, "inbox", "tool-gaps.md"), "utf8");
    assert.match(both, /\| Notion \|/);
    assert.match(both, /\| Obsidian \|/);

    fs.writeFileSync(path.join(workspace, "onboarding-draft.json"), `${JSON.stringify({ status: "draft", requested_integrations: [] })}\n`);
    fs.writeFileSync(path.join(workspace, "workspace.json"), `${JSON.stringify({ requested_integrations: [] })}\n`);
    recordAskedFor(dir);
    assert.equal(fs.existsSync(path.join(dir, "inbox", "tool-gaps.md")), false);
  });

  it("leaves a file that has no asked-for section unchanged when nothing was named", () => {
    const original = "# Tool connector gaps\n\n## Gaps\n\n_None._\n";
    assert.equal(reconcileToolGapsMarkdown(original, []), original);
  });
});
