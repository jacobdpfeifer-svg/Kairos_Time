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
export function buildToolDeclarations(courseCodes) {
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
export function createToolHandlers({ paths, sessionId, courseCodes = [], now = () => new Date() }) {
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
  };

  return {
    courseCodes: codes,
    /** @param {string} name @param {Record<string, unknown>} [args] */
    async handle(name, args) {
      // Own keys only: a model-supplied name like "constructor" or "__proto__"
      // must not resolve to an inherited Object method.
      const fn = typeof name === "string" && Object.hasOwn(tools, name) ? tools[name] : null;
      if (!fn) return { ok: false, error: `unknown tool: ${String(name).slice(0, 64)}` };
      try {
        return fn(args ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
