/**
 * The named work-state corpus from tests/fixtures/work-state/README.md.
 *
 * Each case seeds a user root from local artifacts only. The expected
 * projection for every case is frozen under tests/fixtures/work-state/ and
 * compared by browser/tests/work-state-corpus.test.mjs, so a reducer change
 * that moves a student-visible fact has to show up as a reviewable diff.
 */
import fs from "node:fs";
import path from "node:path";
import { fixtureGeneration, partialOutage, wellStructured } from "../../../scripts/lib/canvas-reliability-fixtures.mjs";
import { promoteProjections } from "../../../scripts/lib/canvas-project.mjs";

export const NOW = "2026-10-23T18:00:00.000Z";

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendLine(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function seedCanvas(root, generation) {
  promoteProjections(root, generation, { now: Date.parse("2026-10-23T18:00:00Z") });
}

function plan(root, state) {
  writeJson(path.join(root, "inbox", "plan", "week.json"), {
    schema: 1,
    default_hours: 10,
    weeks: {},
    estimates: {},
    deferrals: {},
    pile_moves: {},
    ...state,
  });
}

export const CASES = [
  {
    name: "empty-account",
    why: "no Canvas pointer at all. An empty list is never described as no work.",
    seed(root) {
      fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
    },
  },
  {
    name: "empty-generation",
    why: "a real sync that found no courses, distinct from never having synced.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [] }));
    },
  },
  {
    name: "normal-account",
    why: "one reconciled course. One work item per Canvas id.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    },
  },
  {
    name: "partial-sync",
    why: "a failed endpoint keeps rows and marks coverage partial.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({
        courses: [partialOutage()],
        complete: false,
        failed_endpoints: [{ endpoint: "modules:1600", status: 500 }],
      }));
    },
  },
  {
    name: "due-date-moved",
    why: "one moved-date annotation, carrying the freshness key that identifies the move.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
      appendLine(path.join(root, "inbox", "freshness", "events.jsonl"), {
        key: "snap-due:1300:101:2026-10-28T16:00:00Z",
        kind: "due_changed",
        course_id: "1300",
        title: "Homework 1",
        url: "https://canvas.example/courses/1300/assignments/101",
        detected_at: "2026-10-22T00:00:00Z",
        detail: { from: "2026-09-22T16:00:00Z", to: "2026-10-28T16:00:00Z", preview: "never copied" },
      });
    },
  },
  {
    name: "a-later-change-does-not-bury-the-move",
    why: "a newer points change must not replace the due move a surface renders.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
      const events = path.join(root, "inbox", "freshness", "events.jsonl");
      appendLine(events, {
        key: "snap-due:1300:101:2026-10-28T16:00:00Z",
        kind: "due_changed",
        course_id: "1300",
        url: "https://canvas.example/courses/1300/assignments/101",
        detected_at: "2026-10-22T00:00:00Z",
        detail: { from: "2026-09-22T16:00:00Z", to: "2026-10-28T16:00:00Z" },
      });
      appendLine(events, {
        key: "snap-points:1300:101:12",
        kind: "points_changed",
        course_id: "1300",
        url: "https://canvas.example/courses/1300/assignments/101",
        detected_at: "2026-10-23T00:00:00Z",
        detail: { from: "10", to: "12" },
      });
    },
  },
  {
    name: "completed-work",
    why: "submission facts are copied, never inferred.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    },
  },
  {
    name: "capture-and-deferral",
    why: "a typed row and a deferral survive beside Canvas rows.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
      plan(root, {
        weeks: { "2026-10-19": { accepted: { at: "2026-10-19T00:00:00Z", days: { "item-a101": "2026-10-24", "item-a102": "2026-10-24" } } } },
        estimates: { "item-a101": 45 },
        deferrals: { "item-a101": { to: "2026-10-26", at: "2026-10-20T00:00:00Z" } },
      });
      appendLine(path.join(root, "inbox", "plan", "items.jsonl"), {
        id: "cap-abc",
        title: "Office hours question",
        day: "2026-10-24",
        created_at: "2026-10-20T00:00:00Z",
      });
    },
  },
  {
    name: "orphaned-plan-decision",
    why: "a decision whose Canvas row is gone is retained honestly, not dropped.",
    seed(root) {
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
      plan(root, { estimates: { "item-a99999": 15 } });
    },
  },
  {
    name: "historical-profile",
    why: "an old root with week.md and no work-state directory upgrades without a rename.",
    seed(root) {
      fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
      fs.writeFileSync(path.join(root, "inbox", "week.md"), "# week\n");
      seedCanvas(root, fixtureGeneration({ courses: [wellStructured()] }));
    },
  },
];
