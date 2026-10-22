/**
 * State and tool-gaps markdown for a tool the student named.
 *
 * Pure: no filesystem, no network. The row text is shared with
 * app/src-tauri/src/workspace.rs. Keep the two writers identical.
 *
 * A name is `not_available` when it is a Bucket B assessment tool
 * (same pattern as ASSESSMENT_TOOL_RE in canvas-session.mjs) or a
 * Canvas-visible act (submit, comment, discussion post). Anything else
 * is `requested`. Neither state connects, fetches, or installs.
 */
import { isReviewedConnector } from "./connector-registry-data.mjs";

/** Same source and flags as canvas-session.mjs ASSESSMENT_TOOL_RE. */
export const ASSESSMENT_NAME_RE =
  /gradescope|webassign|zybooks|playposit|play posit|proctor|lockdown|respondus|honorlock|proctored|norton|eoc|learningcurve/i;

export const CANVAS_VISIBLE_ACT_RE =
  /\b(?:submit(?:ting)?|submissions?|comments?(?:\s+on)?|discussion\s+posts?|discussion\s+replies|reply\s+to\s+(?:a\s+|the\s+)?discussion)\b/i;

export const ASKED_HEADING = "## Asked for on this Mac";
export const ASKED_INTRO = "Tools the student named on this Mac. Flag only; do not auto-build.";
export const GAP_NOTE = "No connector in registry — flag only; do not auto-build";
export const GAP_COURSES = "—";

export const REQUESTED_SENTENCE = "It would exist only if a maintainer reviews it and ships a connector in an update.";
export const NOT_AVAILABLE_SENTENCE = "Kairos will not add a connector for this. You use it yourself in the browser.";
export const REVIEWED_SENTENCE = "A reviewed connector for this already ships with Kairos. This list does not start a connection.";

const ALREADY_ON_SCREEN = {
  "google calendar": "Google Calendar is already in the list above. This note does not start a new connection.",
  gcal: "Google Calendar is already in the list above. This note does not start a new connection.",
  outlook: "Outlook is already in the list above. This note does not start a new connection.",
  "outlook email": "Outlook is already in the list above. This note does not start a new connection.",
  "outlook mail": "Outlook is already in the list above. This note does not start a new connection.",
};

/** @param {unknown} name @returns {"requested" | "not_available"} */
export function integrationRequestState(name) {
  const text = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "requested";
  if (ASSESSMENT_NAME_RE.test(text) || CANVAS_VISIBLE_ACT_RE.test(text)) return "not_available";
  return "requested";
}

/** One sentence about what would have to happen for this name to exist here. */
export function requestSentence(name) {
  const key = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (integrationRequestState(name) === "not_available") return NOT_AVAILABLE_SENTENCE;
  if (ALREADY_ON_SCREEN[key]) return ALREADY_ON_SCREEN[key];
  if (isReviewedConnector(key)) return REVIEWED_SENTENCE;
  return REQUESTED_SENTENCE;
}

/** One Markdown table cell. Matches canvas-session.mjs escCell for `|` and line breaks. */
export function escGapCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "/")
    .replace(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g, " ")
    .trim();
}

/** @param {unknown} name */
export function clipRequestName(name) {
  const text = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...text];
  return chars.length <= 120 ? text : chars.slice(0, 120).join("");
}

/** @param {unknown[]} names */
export function dedupeRequestNames(names) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of names) {
    const name = clipRequestName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

/** @param {readonly string[]} names */
export function formatAskedSection(names) {
  const rows = names.map((name) => `| ${escGapCell(name)} | ${GAP_COURSES} | ${GAP_NOTE} |`);
  return [ASKED_HEADING, "", ASKED_INTRO, "", "| Tool | Courses | Notes |", "|------|---------|-------|", ...rows, ""].join("\n");
}

/** @param {string} markdown */
export function parseAskedForNames(markdown) {
  const text = String(markdown ?? "");
  const start = text.indexOf(ASKED_HEADING);
  if (start < 0) return [];
  const rest = text.slice(start + ASKED_HEADING.length);
  const next = rest.search(/\n#/);
  const body = next < 0 ? rest : rest.slice(0, next);
  /** @type {string[]} */
  const names = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|\s*-+/.test(trimmed)) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === "tool") continue;
    if (!cells[0]) continue;
    names.push(cells[0]);
  }
  return dedupeRequestNames(names);
}

function stripAskedSection(text) {
  const start = text.indexOf(ASKED_HEADING);
  if (start < 0) return text.trimEnd();
  const before = text.slice(0, start).trimEnd();
  const afterMarker = text.slice(start + ASKED_HEADING.length);
  const next = afterMarker.search(/\n#/);
  const after = next < 0 ? "" : afterMarker.slice(next + 1).replace(/^\n+/, "").trimEnd();
  if (!before && !after) return "";
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`;
}

/**
 * Rebuild the asked-for section from `names`. Sync prose outside that section stays.
 * An empty name list removes the section. A file that never had the section is unchanged
 * when `names` is empty.
 * @param {string} existing
 * @param {readonly unknown[]} names
 */
export function reconcileToolGapsMarkdown(existing, names) {
  const raw = String(existing ?? "");
  const had = raw.includes(ASKED_HEADING);
  const unique = dedupeRequestNames(names);
  const base = stripAskedSection(raw);
  if (unique.length === 0) {
    if (!had) return raw;
    if (!base) return "";
    return `${base}\n`;
  }
  const section = formatAskedSection(unique);
  if (!base) return section;
  return `${base}\n\n${section}`;
}
