import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { normalizeWorkflowDraft, suggestTemplates, workspaceDraftPath, writeWorkflowDraft } from "../scripts/lib/workspace/onboarding.mjs";

let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("workspace onboarding draft", () => {
  it("normalizes model output to the reviewed workflow vocabulary", () => {
    const draft = normalizeWorkflowDraft({
      ideal_workflow: "  I want one quiet place to know what matters next. ",
      frictions: ["finding_next_action", "made_up", "finding_next_action"],
      preference: "quiet_minimal",
      constraints: "Too many notifications",
      proposed_template: "not-real",
      requested_integrations: ["Notion", "Notion", "   "],
      alternatives: [{ title: "Weekly planner", reason: "See the whole week." }, { title: "", reason: "drop" }],
    }, { now: "2026-10-21T12:00:00.000Z", sessionId: "s1" });
    assert.equal(draft.status, "draft");
    assert.deepEqual(draft.frictions, ["finding_next_action", "other"]);
    assert.equal(draft.proposed_template, "calm-daily");
    assert.deepEqual(draft.requested_integrations, ["Notion"]);
    assert.deepEqual(draft.alternatives, [{ title: "Weekly planner", reason: "See the whole week." }]);
  });

  it("keeps interruption answers inside the three notification kinds", () => {
    const draft = normalizeWorkflowDraft({
      preference: "quiet_minimal",
      interrupt_for: ["sync_broken", "every_email", "sync_broken", "submit_done"],
    });
    assert.deepEqual(draft.interrupt_for, ["sync_broken"]);

    const unspoken = normalizeWorkflowDraft({ preference: "one_next_step" });
    assert.equal(Object.hasOwn(unspoken, "interrupt_for"), false);

    const none = normalizeWorkflowDraft({ interrupt_for: [] });
    assert.deepEqual(none.interrupt_for, []);

    const prose = normalizeWorkflowDraft({ interrupt_for: "no notifications" });
    assert.equal(Object.hasOwn(prose, "interrupt_for"), false);
  });

  it("ranks a matching template without involving the model", () => {
    const [first] = suggestTemplates({ preference: "study_first", frictions: ["turning_notes_into_study"] });
    assert.equal(first.id, "study-first");
  });

  it("writes only a local draft with owner-only permissions", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-onboarding-"));
    const file = workspaceDraftPath(dir);
    writeWorkflowDraft(file, normalizeWorkflowDraft({ ideal_workflow: "A calm plan", preference: "one_next_step", proposed_template: "calm-daily" }));
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "draft");
    assert.equal(fs.statSync(file).mode & 0o077, 0);
  });
});
