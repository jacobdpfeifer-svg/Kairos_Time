/**
 * The whole tool surface the voice model gets. Deliberately tiny: two local
 * markdown appends. No Canvas access, no submits, no reads — anything else
 * the student asks for is recorded as a `request` for the text agent, not executed.
 */
import fs from "node:fs";
import path from "node:path";
import { denverDay } from "./config.mjs";
import {
  GOAL_CATEGORIES,
  GOAL_HORIZONS,
  appendClassNote,
  appendGoalCapture,
  clean,
} from "./notes.mjs";
import { INTERRUPT_KINDS } from "../workspace/bounds.mjs";
import { compileWorkspace } from "../workspace/compile.mjs";
import { dedupeRequestNames } from "../tool-request-state.mjs";
import { writeAskedFor } from "../tool-requests.mjs";
import { WORKFLOW_FRICTIONS, WORKFLOW_PREFERENCES, WORKSPACE_TEMPLATES, normalizeWorkflowDraft, workspaceDraftPath, writeWorkflowDraft } from "../workspace/onboarding.mjs";

/** Course files are `CODE.md` (letters+digits); `CODE-webassign.md` and `_raw/` are not courses. */
export function listCourseCodes(coursesDir) {
  try {
    return fs
      .readdirSync(coursesDir)
      .filter((f) => /^[A-Z][A-Z0-9]*\.md$/.test(f))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** @param {string[]} courseCodes */
export function buildToolDeclarations(courseCodes, { onboarding = false } = {}) {
  const declarations = [
    {
      name: "save_goal",
      description:
        "Save something the student just said about what they want, why, or what limits them: a goal, motivation, value, constraint, preference, or a request for the text agent. Use their words, first person. Call it as soon as they say it; do not ask permission first.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: {
            type: "STRING",
            enum: GOAL_CATEGORIES,
            description:
              "career, academic, skill, personal, value, constraint, preference, or request (something the student wants the text agent to do later — recorded, never executed here).",
          },
          statement: {
            type: "STRING",
            description: "What the student said, in their words, first person, one or two sentences.",
          },
          why: { type: "STRING", description: "Their reason or motivation, if they gave one." },
          horizon: {
            type: "STRING",
            enum: GOAL_HORIZONS,
            description: "When it matters: now, this_semester, this_year, career, or unspecified.",
          },
        },
        required: ["category", "statement"],
      },
    },
  ];
  if (courseCodes.length) {
    declarations.push({
      name: "append_class_note",
      description:
        "Save what the student says they studied, learned, or are struggling with in one specific course. Call it right after they share it; do not ask permission first.",
      parameters: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING", enum: courseCodes, description: "Course code, e.g. CSCI1200." },
          note: {
            type: "STRING",
            description: "What the student covered, understood, or found hard, in one or two sentences.",
          },
          mastery_gap: {
            type: "STRING",
            description: "Only if they say they are shaky on something: the specific topic they need to work on.",
          },
        },
        required: ["course_code", "note"],
      },
    });
  }
  if (onboarding) {
    declarations.push({
      name: "save_workflow_draft",
      description: "Save a structured local-only draft of the student's desired Kairos workspace after hearing their friction, ideal workflow, and preference. This never changes their UI, connects an account, installs a connector, or takes an action.",
      parameters: {
        type: "OBJECT",
        properties: {
          ideal_workflow: { type: "STRING", description: "The student's ideal study workflow in their words." },
          frictions: { type: "ARRAY", items: { type: "STRING", enum: WORKFLOW_FRICTIONS }, description: "Up to three recurring workflow problems." },
          preference: { type: "STRING", enum: WORKFLOW_PREFERENCES, description: "The student's preferred workspace orientation." },
          constraints: { type: "STRING", description: "Relevant time, attention, schedule, privacy, or interruption constraints." },
          interrupt_for: {
            type: "ARRAY",
            items: { type: "STRING", enum: [...INTERRUPT_KINDS] },
            description: "Notification kinds the student still wants. Omit the field if they did not say. Only due_moved, high_stakes_48h, and sync_broken.",
          },
          proposed_template: { type: "STRING", enum: WORKSPACE_TEMPLATES.map((x) => x.id), description: "One reviewed template that best fits." },
          requested_integrations: { type: "ARRAY", items: { type: "STRING" }, description: "Tools the student mentioned that Kairos does not currently list. Requests only." },
          alternatives: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, reason: { type: "STRING" } }, required: ["title", "reason"] }, description: "At most three honest alternatives from reviewed capabilities and templates." },
        },
        required: ["ideal_workflow", "frictions", "preference", "proposed_template"],
      },
    });
  }
  return [{ functionDeclarations: declarations }];
}

/** Write via temp file + rename so a crash never leaves a half-written memory file. */
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * @param {{ paths: ReturnType<import("./config.mjs").voicePaths>, sessionId?: string, courseCodes?: string[], now?: () => Date }} opts
 */
export function createToolHandlers({ paths, sessionId, courseCodes = [], onboarding = false, now = () => new Date() }) {
  const codes = courseCodes.length ? courseCodes : listCourseCodes(paths.coursesDir);

  const tools = {
    save_goal(args) {
      const category = String(args.category || "").toLowerCase();
      if (!GOAL_CATEGORIES.includes(category)) {
        return { ok: false, error: `category must be one of: ${GOAL_CATEGORIES.join(", ")}` };
      }
      const statement = clean(args.statement, 600);
      if (!statement) return { ok: false, error: "statement is required" };
      const horizon = GOAL_HORIZONS.includes(args.horizon) ? args.horizon : "unspecified";
      const why = clean(args.why, 400);

      const existing = fs.existsSync(paths.goalsPath) ? fs.readFileSync(paths.goalsPath, "utf8") : "";
      const next = appendGoalCapture(existing, { category, statement, why, horizon }, { day: denverDay(now()), sessionId });
      writeAtomic(paths.goalsPath, next);
      return { ok: true, saved: "goal", category, statement };
    },

    append_class_note(args) {
      const code = String(args.course_code || "").trim().toUpperCase();
      if (!codes.includes(code)) {
        return { ok: false, error: `course_code must be one of: ${codes.join(", ") || "(no course files)"}` };
      }
      const note = clean(args.note, 800);
      if (!note) return { ok: false, error: "note is required" };
      const gap = clean(args.mastery_gap, 300);

      const file = path.join(paths.coursesDir, `${code}.md`);
      const { md, masteryAdded } = appendClassNote(fs.readFileSync(file, "utf8"), { note, gap }, { day: denverDay(now()), sessionId });
      writeAtomic(file, md);
      return { ok: true, saved: "class_note", course_code: code, note, mastery: gap ? (masteryAdded ? "added" : "kept in note") : undefined };
    },

    save_workflow_draft(args) {
      if (!onboarding) return { ok: false, error: "workflow drafting is available only during onboarding" };
      const draft = normalizeWorkflowDraft(args, { now: now().toISOString(), sessionId });
      if (!draft.ideal_workflow) return { ok: false, error: "ideal_workflow is required" };
      const userRoot = path.dirname(paths.inboxDir);
      const file = workspaceDraftPath(userRoot);
      writeWorkflowDraft(file, draft);
      const specNames = [];
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(userRoot, "workspace", "workspace.json"), "utf8"));
        if (Array.isArray(spec?.requested_integrations)) {
          for (const item of spec.requested_integrations) {
            if (typeof item === "string") specNames.push(item);
            else if (item && typeof item.name === "string") specNames.push(item.name);
          }
        }
      } catch {
        /* no accepted workspace yet */
      }
      writeAskedFor(paths.inboxDir, dedupeRequestNames([...(draft.requested_integrations ?? []), ...specNames]));
      let narration = [];
      try {
        const compiled = compileWorkspace(draft, { now: draft.created_at });
        narration = compiled.patches.filter((patch) => patch.op === "place" && typeof patch.narration === "string").map((patch) => patch.narration);
      } catch {
        narration = [];
      }
      return {
        ok: true,
        saved: "workflow_draft",
        status: "draft",
        proposed_template: draft.proposed_template,
        file,
        narration,
        speak: "Read each narration sentence exactly, in order, then stop. Do not add blocks.",
      };
    },
  };

  return {
    courseCodes: codes,
    /** @param {string} name @param {Record<string, unknown>} [args] */
    async handle(name, args) {
      // Own keys only: a model-supplied name like "constructor" or "__proto__"
      // must not resolve to an inherited Object method.
      const fn = typeof name === "string" && Object.hasOwn(tools, name) ? tools[name] : null;
      if (!fn) {
        const label = String(name).slice(0, 64);
        const statement = clean(`Asked for ${label}, which Kairos cannot do from here.`, 600);
        let recorded = false;
        try {
          const existing = fs.existsSync(paths.goalsPath) ? fs.readFileSync(paths.goalsPath, "utf8") : "";
          const next = appendGoalCapture(existing, { category: "request", statement, horizon: "unspecified" }, { day: denverDay(now()), sessionId });
          writeAtomic(paths.goalsPath, next);
          recorded = true;
        } catch {
          recorded = false;
        }
        return {
          ok: false,
          error: `Kairos can't do that from here (unknown tool: ${label})`,
          recorded: recorded ? "request" : "unrecorded",
        };
      }
      try {
        return fn(args ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
