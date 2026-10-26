/**
 * Cache COEN major dinner schedule → inbox/coen-major-dinners.md
 *
 * Primary source: public CU engineering schedule page (cglink.me table).
 * Fallback: Canvas Major Dinner assignment description.
 *
 * Usage:
 *   cd browser && npm run sync-dinners
 *   npm run sync-dinners -- --force
 */
import fs from "node:fs";
import path from "node:path";
import {
  BASE,
  api,
  schoolLocalDay,
  extractLinksFromHtml,
  launchCanvasContext,
  requireLoggedIn,
  stripHtmlTags,
} from "../../browser/scripts/lib/canvas-session.mjs";
import { COEN_MAJOR_DINNERS_PATH, parseEventIdFromUrl } from "./campusgroups-session.mjs";
import {
  ENGINEERING_DINNERS_URL,
  parseEngineeringDinnersHtml,
} from "../../browser/scripts/lib/coen-schedule-parse.mjs";
import { refuseDirectCampusGroups } from "./require-school.mjs";

refuseDirectCampusGroups(import.meta.url);

const STALE_DAYS = 7;
const force = process.argv.includes("--force");
const SCHEDULE_YEAR = Number(process.env.SCHEDULE_YEAR || 2026);

function isStale(filePath) {
  if (force) return true;
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function parseDinnerRowsFromDescription(html) {
  const rows = [];
  const links = extractLinksFromHtml(html).filter((l) => /cglink\.me/i.test(l));
  for (const link of links) {
    const eventId = parseEventIdFromUrl(link);
    if (eventId) rows.push({ date: "", slot: "", major: "Unknown", rsvpId: eventId, cglink: link });
  }
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.rsvpId)) return false;
    seen.add(r.rsvpId);
    return true;
  });
}

function formatDinnersMd(rows, today) {
  const header = `# COEN 1500 — Major dinner schedule (cached)

Updated: ${today}

Source: CU engineering schedule page + CampusGroups cglink (${ENGINEERING_DINNERS_URL})

| Date | Slot | Major | RSVP ID | cglink |
|------|------|-------|---------|--------|
`;
  if (!rows.length) {
    return `${header}| | | | | |\n\nNo dinner rows parsed — check engineering schedule page or run with Canvas SSO for fallback.\n`;
  }
  const body = rows
    .map(
      (r) =>
        `| ${r.date || ""} | ${r.slot || ""} | ${r.major} | ${r.rsvpId} | ${r.cglink} |`
    )
    .join("\n");
  return `${header}${body}\n`;
}

async function fetchEngineeringSchedule() {
  const res = await fetch(ENGINEERING_DINNERS_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Engineering schedule fetch failed: ${res.status}`);
  return res.text();
}

async function fetchCoenMajorDinnerDescription(page) {
  const coursesRes = await api(page, "/api/v1/courses?enrollment_state=active&per_page=50");
  if (!coursesRes.ok) throw new Error("Failed to fetch courses");
  const coen = (coursesRes.json || []).find((c) => /coen\s*1500/i.test(c.name || c.course_code || ""));
  if (!coen) throw new Error("COEN 1500 not found in active enrollments");

  const assignRes = await api(
    page,
    `/api/v1/courses/${coen.id}/assignments?search_term=Major+Dinner&per_page=10`
  );
  if (!assignRes.ok) throw new Error("Failed to fetch COEN assignments");
  const assignment = (assignRes.json || []).find((a) => /major\s*dinner/i.test(a.name || ""));
  if (!assignment) throw new Error("Major Dinner assignment not found");

  const detailRes = await api(
    page,
    `/api/v1/courses/${coen.id}/assignments/${assignment.id}`
  );
  if (!detailRes.ok) throw new Error("Failed to fetch Major Dinner assignment detail");
  return detailRes.json?.description || "";
}

const today = schoolLocalDay();

if (!isStale(COEN_MAJOR_DINNERS_PATH)) {
  console.log(`Cache fresh: ${COEN_MAJOR_DINNERS_PATH} (use --force to refresh)`);
  process.exit(0);
}

let rows = [];
let source = "engineering-schedule";

try {
  const html = await fetchEngineeringSchedule();
  rows = parseEngineeringDinnersHtml(html, { year: SCHEDULE_YEAR });
} catch (e) {
  console.warn(`Engineering schedule fetch failed: ${e.message}`);
}

if (!rows.length) {
  source = "canvas-fallback";
  const { context, page } = await launchCanvasContext();
  try {
    await requireLoggedIn(page);
    const description = await fetchCoenMajorDinnerDescription(page);
    rows = parseDinnerRowsFromDescription(description);
  } catch (e) {
    console.warn(`Canvas fallback failed: ${e.message}`);
  } finally {
    await context.close();
  }
}

const md = formatDinnersMd(rows, today);
fs.mkdirSync(path.dirname(COEN_MAJOR_DINNERS_PATH), { recursive: true });
fs.writeFileSync(COEN_MAJOR_DINNERS_PATH, md, "utf8");
console.log(`Wrote ${COEN_MAJOR_DINNERS_PATH} (${rows.length} rows, source=${source})`);
console.log(JSON.stringify({ rows: rows.length, source, canvas: BASE }, null, 2));
