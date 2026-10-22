/**
 * Write `{inbox}/tool-gaps.md` for tools the student named.
 * Local file only. No fetch, no install, no count across students.
 */
import fs from "node:fs";
import path from "node:path";
import { dedupeRequestNames, reconcileToolGapsMarkdown } from "./tool-request-state.mjs";

/** @param {string} file */
function namesFromWorkspaceFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = data?.requested_integrations;
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.name === "string") return item.name;
      return "";
    });
  } catch {
    return [];
  }
}

/**
 * Replace the asked-for section with `names`. Other sections stay.
 * @param {string} inboxDir
 * @param {readonly unknown[]} names
 */
export function writeAskedFor(inboxDir, names) {
  const gaps = path.join(inboxDir, "tool-gaps.md");
  const existing = fs.existsSync(gaps) ? fs.readFileSync(gaps, "utf8") : "";
  const next = reconcileToolGapsMarkdown(existing, names);
  if (next === existing) return { path: gaps, names: dedupeRequestNames(names) };
  if (!next) {
    if (fs.existsSync(gaps)) fs.rmSync(gaps);
    return { path: gaps, names: [] };
  }
  fs.mkdirSync(path.dirname(gaps), { recursive: true, mode: 0o700 });
  const tmp = `${gaps}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, gaps);
  return { path: gaps, names: dedupeRequestNames(names) };
}

/**
 * Union of names on the draft and the accepted spec, then rewrite the section.
 * @param {string} userRoot
 * @param {string} [inboxDir]
 */
export function recordAskedFor(userRoot, inboxDir = path.join(userRoot, "inbox")) {
  const names = dedupeRequestNames([
    ...namesFromWorkspaceFile(path.join(userRoot, "workspace", "onboarding-draft.json")),
    ...namesFromWorkspaceFile(path.join(userRoot, "workspace", "workspace.json")),
  ]);
  return writeAskedFor(inboxDir, names);
}
