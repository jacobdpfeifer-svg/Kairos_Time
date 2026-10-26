/**
 * Cache COEN AI Lab workshop slots → inbox/coen-ai-labs.md
 *
 * Parses CampusGroups/cglink links from COEN 1500 AI Lab Workshop assignment description.
 *
 * Usage:
 *   cd browser && npm run sync-ai-labs
 *   npm run sync-ai-labs -- --force
 */
import fs from "node:fs";
import path from "node:path";
import {
  api,
  schoolLocalDay,
  extractLinksFromHtml,
  launchCanvasContext,
  requireLoggedIn,
  stripHtmlTags,
} from "../../browser/scripts/lib/canvas-session.mjs";
import {
  COEN_AI_LABS_PATH,
  parseEventIdFromUrl,
} from "./campusgroups-session.mjs";
import { refuseDirectCampusGroups } from "./require-school.mjs";

refuseDirectCampusGroups(import.meta.url);

const STALE_DAYS = 7;
const force = process.argv.includes("--force");

function isStale(filePath) {
  if (force) return true;
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs > STALE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

/** @param {string} html */
export function parseAiLabRowsFromDescription(html) {
  const rows = [];
  const plain = stripHtmlTags(html);
  const links = extractLinksFromHtml(html).filter((l) => /cglink\.me|campusgroups/i.test(l));

  for (const link of links) {
    const rsvpId = parseEventIdFromUrl(link);
    if (!rsvpId) continue;
    const idx = plain.indexOf(link);
    const context = plain.slice(Math.max(0, idx - 160), idx > -1 ? idx + 40 : plain.length);
    const timeMatch = context.match(
      /\b(?:Mon|Tue|Wed|Thu|Fri|Monday|Tuesday|Wednesday|Thursday|Friday)[^\n]{0,40}?\d{1,2}(?::\d{2})?\s*(?:am|pm)/i
    );
    const dateMatch = context.match(/\b(?:Aug|Sept?|Oct)\.?\s+\d{1,2}(?:,?\s*\d{4})?/i);
    rows.push({
      date: dateMatch ? dateMatch[0].trim() : "",
      time: timeMatch ? timeMatch[0].trim() : "",
      workshop: context.trim().replace(/\s+/g, " ").slice(-100),
      rsvpId,
      cglink: link,
    });
  }

  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.rsvpId)) return false;
    seen.add(r.rsvpId);
    return true;
  });
}

function formatAiLabsMd(rows, today) {
  const header = `# COEN 1500 — AI Lab workshop slots (cached)

Updated: ${today}

Source: Canvas AI Lab Workshop Sign Up assignment description (sync-ai-labs)

| Date | Time | Workshop | RSVP ID | cglink |
|------|------|----------|---------|--------|
`;
  if (!rows.length) {
    return `${header}| | | | | |\n\nNo workshop rows parsed — check Canvas assignment description.\n`;
  }
  return (
    header +
    rows
      .map(
        (r) =>
          `| ${r.date || ""} | ${r.time || ""} | ${r.workshop || ""} | ${r.rsvpId} | ${r.cglink} |`
      )
      .join("\n") +
    "\n"
  );
}

async function fetchAiLabDescription(page) {
  const coursesRes = await api(page, "/api/v1/courses?enrollment_state=active&per_page=50");
  if (!coursesRes.ok) throw new Error("Failed to fetch courses");
  const coen = (coursesRes.json || []).find((c) => /coen\s*1500/i.test(c.name || c.course_code || ""));
  if (!coen) throw new Error("COEN 1500 not found");

  const assignRes = await api(
    page,
    `/api/v1/courses/${coen.id}/assignments?search_term=AI+Lab&per_page=10`
  );
  if (!assignRes.ok) throw new Error("Failed to fetch assignments");
  const assignment = (assignRes.json || []).find((a) => /ai\s*lab/i.test(a.name || ""));
  if (!assignment) throw new Error("AI Lab Workshop assignment not found");

  const detailRes = await api(
    page,
    `/api/v1/courses/${coen.id}/assignments/${assignment.id}`
  );
  if (!detailRes.ok) throw new Error("Failed to fetch AI Lab assignment detail");
  return detailRes.json?.description || "";
}

const today = schoolLocalDay();

if (!isStale(COEN_AI_LABS_PATH)) {
  console.log(`Cache fresh: ${COEN_AI_LABS_PATH} (use --force to refresh)`);
  process.exit(0);
}

const { context, page } = await launchCanvasContext();
try {
  await requireLoggedIn(page);
} catch (e) {
  console.error(String(e.message || e));
  await context.close();
  process.exit(1);
}

let rows = [];
try {
  const description = await fetchAiLabDescription(page);
  rows = parseAiLabRowsFromDescription(description);
} catch (e) {
  console.warn(`AI Lab fetch failed: ${e.message}`);
}

const md = formatAiLabsMd(rows, today);
fs.mkdirSync(path.dirname(COEN_AI_LABS_PATH), { recursive: true });
fs.writeFileSync(COEN_AI_LABS_PATH, md, "utf8");
console.log(`Wrote ${COEN_AI_LABS_PATH} (${rows.length} rows)`);
await context.close();
