/**
 * Shared Canvas SSO session helpers (school-aware).
 *
 * Truth path: session cookies → same /api/v1 REST as a PAT would use.
 * Playwright is auth + transport, not a second product.
 *
 * School constants come from schools/{slug}.yaml via getSchoolConfig().
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSchoolConfig, schoolDay } from "./school-config.mjs";
import { hasConnector, listConnectorsForSchool } from "./connector-registry.mjs";
import {
  resolveInboxDir as resolveInboxDirFromUserRoot,
  resolveUserRoot,
} from "./user-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function school() {
  return getSchoolConfig();
}

export function getBase() {
  return school().canvas_base_url;
}

/**
 * Canvas base URL for the student's school. Resolved lazily: importing this module
 * must work before onboarding has chosen a school (tests, school search). Every
 * Canvas entry point (launchCanvasContext, requireLoggedIn) re-resolves it and
 * throws a clear "pick your school" error when there is none.
 */
export let BASE = (() => {
  try {
    return getBase();
  } catch {
    return "";
  }
})();

export const ROOT = path.join(__dirname, "..", "..", "..");
/**
 * Browser profile (SSO cookies) lives INSIDE the per-user root so two student
 * profiles on one machine never share a Canvas session. The historical
 * ``browser/.auth`` default leaked cookies across profiles; ``AUTH_DIR`` still
 * overrides for tests and manual runs.
 */
export const AUTH_DIR =
  process.env.AUTH_DIR ||
  path.join(resolveUserRoot({ create: false, announce: false }), "auth", "browser");

/** Same resolver as Python ``user_root`` / Tauri inbox — never ``{repo}/inbox``. */
function resolveInboxDir() {
  return resolveInboxDirFromUserRoot({ create: false, announce: false });
}

export { resolveUserRoot };
export const INBOX_DIR = resolveInboxDir();
export const COURSES_DIR = path.join(INBOX_DIR, "courses");
export const COURSES_RAW_DIR = path.join(COURSES_DIR, "_raw");
export const WEEK_PATH = path.join(INBOX_DIR, "week.md");
export const GRADES_PATH = path.join(INBOX_DIR, "grades.yaml");
export const TOOL_GAPS_PATH = path.join(INBOX_DIR, "tool-gaps.md");

/** Ensure inbox dirs exist and print the active user-root path (sync entrypoints). */
export function ensureInboxReady() {
  return resolveInboxDirFromUserRoot({ create: true, announce: true });
}

/** Assessment / proctored tooling — Bucket B; never automate. */
export const ASSESSMENT_TOOL_RE =
  /gradescope|webassign|zybooks|playposit|play posit|proctor|lockdown|respondus|honorlock|proctored|norton|eoc|learningcurve/i;

/** Named assessment tools for inventory labels. */
const ASSESSMENT_TOOL_NAMES = [
  { re: /gradescope/i, name: "Gradescope", slug: "gradescope" },
  { re: /webassign/i, name: "WebAssign", slug: "webassign" },
  { re: /zybooks/i, name: "ZyBooks", slug: "zybooks" },
  { re: /play\s*posit/i, name: "PlayPosit", slug: "playposit" },
  { re: /honorlock/i, name: "Honorlock", slug: "honorlock" },
  { re: /respondus|lockdown/i, name: "Respondus LockDown", slug: "respondus" },
  { re: /proctor(?!ed)|proctored/i, name: "Proctoring", slug: "proctoring" },
  { re: /\bnorton\b/i, name: "Norton", slug: "norton" },
  { re: /\beoc\b/i, name: "EOC", slug: "eoc" },
  { re: /learningcurve/i, name: "LearningCurve", slug: "learningcurve" },
];

/** Read-only / administrative surfaces — Bucket A; registry-eligible only. */
const ADMIN_TOOL_NAMES = [
  {
    re: /campusgroups|cglink\.me|major\s*dinner|ai\s*lab\s*workshop/i,
    name: "CampusGroups",
    slug: "campusgroups",
  },
  {
    re: /gradebook|grades?\s*view|check\s*my\s*grades?/i,
    name: "Gradebook",
    slug: "gradebook",
  },
  {
    re: /\bcalendar\s*feed\b|\bical\b|\.ics\b|subscribe.{0,24}\bcalendar\b/i,
    name: "Calendar feed",
    slug: "calendar-feed",
  },
  {
    re: /syllabus.*(tool|viewer|external)|external.*syllabus/i,
    name: "Syllabus tool",
    slug: "syllabus-tool",
  },
];

const POLICY_PAGE_RE =
  /professional|participation|policy|syllabus|grading|integrity|gen\s*ai|expectation/i;
export const CATALOG_DAYS = Number(process.env.CATALOG_DAYS || 90);

/** Map Canvas course name/code → inbox/courses/CODE.md (from school yaml). */
export function getCourseFileMap() {
  return school().course_file_map || [];
}

/** @deprecated Prefer getCourseFileMap(); empty until a school is chosen. */
export const COURSE_FILE_MAP = (() => {
  try {
    return getCourseFileMap();
  } catch {
    return [];
  }
})();

/** School-local calendar day as YYYY-MM-DD (not UTC). */
export function schoolLocalDay(d = new Date()) {
  return schoolDay(d, school().timezone);
}

export function clearSingletonLocks(authDir = AUTH_DIR) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.unlinkSync(path.join(authDir, name));
    } catch {
      /* absent is fine */
    }
  }
}

/** Advisory lock filename under AUTH_DIR — one Playwright owner at a time. */
export const AUTH_LOCK_NAME = ".playwright.lock";

export function authLockPath(authDir = AUTH_DIR) {
  return path.join(authDir, AUTH_LOCK_NAME);
}

export function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire an exclusive advisory lock on the shared Chromium user-data-dir.
 * Call before clearSingletonLocks so a second script never yanks the profile
 * out from under a live owner. Steals the lock only when the holder pid is dead.
 *
 * @returns {Promise<() => void>} release function (idempotent)
 */
export async function acquireAuthLock(
  authDir = AUTH_DIR,
  { timeoutMs = 60_000, pollMs = 200 } = {}
) {
  fs.mkdirSync(authDir, { recursive: true });
  const lockPath = authLockPath(authDir);
  const start = Date.now();
  let fd = null;

  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holderPid = NaN;
      try {
        holderPid = parseInt(fs.readFileSync(lockPath, "utf8").trim().split(/\s+/)[0], 10);
      } catch {
        /* unreadable — try steal below */
      }
      if (!isProcessAlive(holderPid)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* race with another waiter */
        }
      } else if (Date.now() - start > timeoutMs) {
        throw new Error(
          `another Canvas browser script (pid ${holderPid}) owns ${authDir}; ` +
            `wait for it to finish, or set AUTH_DIR to a separate profile path`
        );
      } else {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  return release;
}

export async function launchCanvasContext(options = {}) {
  BASE = getBase();
  // The Chromium profile holds the student's live Canvas SSO cookies.
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(AUTH_DIR, 0o700);
  } catch {
    /* best effort */
  }
  const releaseLock = await acquireAuthLock(AUTH_DIR);
  try {
    clearSingletonLocks();
    const headless = process.env.HEADLESS === "1";
    // PLAYWRIGHT_CHANNEL=chrome lets a packaged app drive the student's installed
    // Chrome instead of requiring Playwright's downloaded Chromium.
    const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
    const context = await chromium.launchPersistentContext(AUTH_DIR, {
      headless,
      viewport: { width: 1280, height: 900 },
      ...(channel ? { channel } : {}),
      ...options,
    });
    const origClose = context.close.bind(context);
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      releaseLock();
    };
    context.close = async (...args) => {
      try {
        return await origClose(...args);
      } finally {
        releaseOnce();
      }
    };
    process.once("exit", releaseOnce);
    const page = context.pages()[0] || (await context.newPage());
    return { context, page };
  } catch (err) {
    releaseLock();
    throw err;
  }
}

export async function requireLoggedIn(page) {
  BASE = getBase();
  const hostRe = new RegExp(
    school().canvas_base_url.replace(/^https?:\/\//, "").replace(/\./g, "\\."),
    "i"
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  try {
    await page.waitForURL(hostRe, { timeout: 45_000 });
  } catch {
    /* may already be on Canvas after SAML */
  }
  await page.waitForTimeout(2000);
  const idpHost = (school().sso_idp || "").replace(/^https?:\/\//, "");
  const onLogin =
    page.url().includes("login") ||
    (idpHost && page.url().includes(idpHost)) ||
    (await page.locator("text=IdentiKey").count()) > 0 ||
    (await page.locator('input[name="username"], #username').count()) > 0;
  if (onLogin) {
    throw new Error(
      "Not logged in. Run: cd browser && npm run open-canvas — complete SSO/MFA, then retry."
    );
  }
}

/** @deprecated Prefer schoolLocalDay for window bounds. */
export function isoDay(d = new Date()) {
  return schoolLocalDay(d);
}

function schoolLocalHour(ms) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: school().timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date(ms))
  );
}

/** UTC instant for midnight on `dayStr` (YYYY-MM-DD) in the school timezone. */
export function schoolMidnightUtc(dayStr) {
  const [year, month, day] = dayStr.split("-").map(Number);
  let lo = Date.UTC(year, month - 1, day - 1, 12, 0, 0);
  let hi = Date.UTC(year, month - 1, day + 1, 12, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midDay = schoolLocalDay(new Date(mid));
    if (midDay < dayStr) lo = mid + 1;
    else hi = mid;
  }
  let t = lo;
  while (schoolLocalDay(new Date(t)) === dayStr && schoolLocalHour(t) > 0) {
    t -= 3600000;
  }
  while (schoolLocalDay(new Date(t)) !== dayStr) t += 3600000;
  return new Date(t);
}

/** Add calendar days in the school timezone, returning YYYY-MM-DD. */
export function addSchoolDays(dayStr, n) {
  const start = schoolMidnightUtc(dayStr);
  return schoolLocalDay(new Date(start.getTime() + Number(n) * 86400000));
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null || item === "") continue;
        qs.append(key, String(item));
      }
    } else {
      qs.set(key, String(value));
    }
  }
  return qs;
}

/** Session-authenticated Canvas REST (cookies, not developer PAT). */
export async function api(page, pathAndQuery) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await page.evaluate(async (pq) => {
        const res = await fetch(pq, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = text.slice(0, 500);
        }
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json,
        };
      }, pathAndQuery);
    } catch (e) {
      const msg = String(e?.message || e);
      if (attempt === 2 || !msg.includes("Execution context was destroyed")) throw e;
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
    }
  }
}

const API_RETRIES = 3;
const API_RETRY_MS = 500;

async function apiWithRetry(page, pathAndQuery) {
  let last = null;
  for (let attempt = 1; attempt <= API_RETRIES; attempt++) {
    last = await api(page, pathAndQuery);
    if (last.ok || last.status < 500) return last;
    if (attempt < API_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, API_RETRY_MS * attempt));
    }
  }
  return last;
}

async function apiGet(page, pathBase, params = {}) {
  const qs = buildQuery(params);
  const sep = pathBase.includes("?") ? "&" : "?";
  const query = qs ? `${sep}${qs}` : "";
  const r = await apiWithRetry(page, `${pathBase}${query}`);
  return {
    ok: r.ok,
    status: r.status,
    json: r.json,
    error: r.ok ? null : r.json,
  };
}

export async function apiAllPages(page, pathBase, params = {}) {
  const items = [];
  let pageNum = 1;
  let truncated = false;
  let lastStatus = 200;
  for (;;) {
    const qs = buildQuery({
      ...params,
      per_page: params.per_page || "100",
      page: String(pageNum),
    });
    const sep = pathBase.includes("?") ? "&" : "?";
    const r = await apiWithRetry(page, `${pathBase}${sep}${qs}`);
    lastStatus = r.status;
    if (!r.ok) {
      // Keep partial pages rather than discarding a successful first page.
      if (items.length) {
        return {
          ok: true,
          items,
          truncated: true,
          status: lastStatus,
          partial: true,
          error: r.json,
        };
      }
      return { ok: false, status: r.status, items, error: r.json, truncated };
    }
    const batch = Array.isArray(r.json) ? r.json : [];
    items.push(...batch);
    if (batch.length < Number(params.per_page || 100)) {
      return { ok: true, items, truncated, status: lastStatus };
    }
    pageNum += 1;
    if (pageNum > 20) {
      truncated = true;
      return { ok: true, items, truncated, status: lastStatus };
    }
  }
}

/** Planner items across a date range, chunked to avoid per-request caps. */
async function fetchPlannerItems(page, startIso, endIso, extraParams = {}) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const chunkMs = 7 * 86400000;
  const allItems = [];
  let truncated = false;
  let ok = true;
  let lastStatus = 200;

  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += chunkMs) {
    const chunkEnd = new Date(Math.min(cursor + chunkMs, end.getTime()));
    const res = await apiAllPages(page, "/api/v1/planner/items", {
      start_date: new Date(cursor).toISOString(),
      end_date: chunkEnd.toISOString(),
      ...extraParams,
    });
    lastStatus = res.status;
    if (!res.ok) {
      ok = false;
      if (!allItems.length) return res;
      truncated = true;
      break;
    }
    allItems.push(...(res.items || []));
    if (res.truncated) truncated = true;
  }

  return { ok, items: allItems, truncated, status: lastStatus };
}

/**
 * One Markdown table cell. Every character any reader treats as a line break
 * becomes a space: Python's str.splitlines() also splits on \r \v \f
 * \x1c-\x1e \x85 U+2028 U+2029, so leaving one in a Canvas title would hide
 * that row from the model while the app still lists it (finding F1).
 */
export function escCell(s) {
  return String(s ?? "")
    .replace(/\|/g, "/")
    .replace(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g, " ")
    .trim();
}

export function keyOf(course, title, due) {
  return `${(course || "").toLowerCase()}||${(title || "").toLowerCase()}||${(due || "").slice(0, 10)}`;
}

/**
 * Heuristic outcome / friction label for inbox Notes.
 * Sync stays mechanical — does not write P-scores (skill computes those).
 */
export function resolveCourseFile(courseName, courseCode) {
  const blob = `${courseName || ""} ${courseCode || ""}`;
  for (const entry of getCourseFileMap()) {
    if (entry.patterns.some((p) => p.test(blob))) {
      return path.join(COURSES_DIR, `${entry.code}.md`);
    }
  }
  // Generic fallback when school yaml has no personal roster: pull the leading
  // DEPT+NUMBER off Canvas course_code (or, failing that, course name) and
  // ignore whatever term/section junk trails it — real course_code values
  // look like "APPM 1235 Fall 2026", "ECON 2010-100", "BCOR 1030-018,019,024",
  // not the clean "DEPT1234" shape a full-string match would require.
  const leading = /^_?\s*([A-Za-z]{2,8})\s*[-_ ]?\s*(\d{3,5})/;
  const match = String(courseCode || "").match(leading) || String(courseName || "").match(leading);
  if (match) {
    return path.join(COURSES_DIR, `${(match[1] + match[2]).toUpperCase()}.md`);
  }
  return null;
}

export function isCheckpoint(title, type, description = "", submissionTypes = []) {
  const blob = `${title || ""} ${type || ""} ${description || ""}`;
  const hint = classifyOutcomeHint(title, type, description, "", submissionTypes);
  if (hint.includes("outcome:quiz")) return true;
  if (hint.includes("outcome:presentation")) return true;
  if (/thought\s*project/i.test(blob)) return true;
  return /\bquiz\b|\bexam\b|\bmidterm\b|\bfinal\s+(?:exam|quiz)\b/i.test(blob);
}

export function outcomeLabel(title, type, description = "", points = "", submissionTypes = []) {
  const hint = classifyOutcomeHint(title, type, description, points, submissionTypes);
  const m = hint.match(/^outcome:(\w+)/);
  return m ? m[1] : hint ? hint.split(";")[0].trim() : "-";
}

/** Open catalog rows for course arc (~term window + checkpoints). */
export function filterCatalogRows(rows, { today, catalogDays = CATALOG_DAYS } = {}) {
  const startDay = today || schoolLocalDay();
  const endDay = addSchoolDays(startDay, Number(catalogDays || 90));

  return (rows || [])
    .filter((r) => {
      if (r.complete) return false;
      if (isCheckpoint(r.title, r.type, r.description, r.submission_types)) return true;
      if (!r.due) return true;
      const dueDay = schoolLocalDay(new Date(r.due));
      if (dueDay < startDay) return true;
      return dueDay <= endDay;
    })
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

export function formatCatalogTable(rows) {
  const header =
    "| Name | Due | Points | Type | Outcome | Status |\n|------|-----|--------|------|---------|--------|";
  if (!rows?.length) {
    return `${header}\n| | | | | | |`;
  }
  return [
    header,
    ...rows.map((r) => {
      const due = formatDueForSync(r.due);
      const status = r.complete ? "complete" : "open";
      return `| ${escCell(r.title)} | ${escCell(due)} | ${escCell(r.points)} | ${escCell(
        r.type
      )} | ${escCell(outcomeLabel(r.title, r.type, r.description, r.points, r.submission_types))} | ${status} |`;
    }),
  ].join("\n");
}

export function formatCheckpoints(rows) {
  const cps = (rows || []).filter((r) =>
    isCheckpoint(r.title, r.type, r.description, r.submission_types)
  );
  if (!cps.length) {
    return "- (no quizzes/exams or major milestones on record yet)";
  }
  return cps
    .map((r) => {
      const due = r.due ? formatDueForSync(r.due) : "undated";
      const pts = r.points != null && r.points !== "" ? `${r.points} pts` : "points TBD";
      return `- **${r.title}** — due ${due}; ${pts} (${r.type})`;
    })
    .join("\n");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(content, heading) {
  const marker = `## ${heading}`;
  const text = String(content || "");
  const idx = text.indexOf(marker);
  if (idx === -1) return "";
  const after = text.slice(idx + marker.length).replace(/^\s*\n/, "");
  const next = after.search(/\n## /);
  return (next === -1 ? after : after.slice(0, next)).trim();
}

function isPlaceholderSection(body) {
  const t = String(body || "").trim();
  return (
    !t ||
    t === "-" ||
    t === "(sync fills quizzes/exams with due dates)" ||
    t.startsWith("(none")
  );
}

function parseCourseHeader(existing, fallbackName) {
  const line = String(existing || "")
    .split("\n")
    .find((l) => l.startsWith("# "));
  if (line) return line.replace(/^#\s*/, "").trim();
  return fallbackName;
}

function parseMetaField(existing, label) {
  const re = new RegExp(`^${escapeRegExp(label)}:\\s*([^\\n]*)`, "m");
  const m = String(existing || "").match(re);
  if (!m) return "";
  const value = m[1].trim();
  if (!value || value.startsWith("##")) return "";
  if (/^(?:Sections|Canvas URL|Primary instructor\(s\)|TA\(s\)|Syllabus hash):?$/i.test(value)) return "";
  if (/(?:Canvas URL|Primary instructor\(s\)|TA\(s\)|Syllabus hash):/i.test(value)) return "";
  return value;
}

/** Render an ISO instant in the school's local timezone, never as raw UTC. */
export function formatDueForDisplay(value, timeZone = school().timezone) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Machine-readable local day carried invisibly beside the human display. */
export function formatDueMachineToken(value, timeZone = school().timezone) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function formatDueForSync(value, timeZone = school().timezone) {
  const display = formatDueForDisplay(value, timeZone);
  const day = formatDueMachineToken(value, timeZone);
  return day ? `${display} <!-- due:${day} -->` : display;
}

function cleanSectionBody(body, heading) {
  let text = String(body || "").trim();
  const marker = `## ${heading}`;
  while (text.startsWith(marker)) {
    text = text.slice(marker.length).trim();
  }
  return text;
}

/** Strip HTML to plain text for syllabus cache (minimal, no dependency). */
export function stripHtmlTags(html) {
  let text = String(html || "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Extract href values from HTML assignment descriptions. */
export function extractLinksFromHtml(html) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    links.push(m[1]);
  }
  return links;
}

/** @param {string} html */
export function hasCampusGroupsLink(html) {
  const blob = String(html || "").toLowerCase();
  return /campusgroups\.com|cglink\.me/.test(blob);
}

/** External RSVP off Canvas (CampusGroups, cglink, or CU engineering dinner schedule). */
export function hasExternalSignupLink(html) {
  const blob = String(html || "").toLowerCase();
  return (
    hasCampusGroupsLink(html) ||
    /engineering-connections-major-dinners|major-dinners/.test(blob)
  );
}

export function isCoenTwoStepSignup(title) {
  return /major\s*dinner|ai\s*lab\s*workshop/i.test(String(title || ""));
}

/** @param {string} html */
export function hasUploadAfterEventHint(html) {
  const blob = stripHtmlTags(html).toLowerCase();
  return /selfie|after you attend|post-dinner|after the dinner|after attending|upload.*after/.test(
    blob
  );
}

export function isSignupTitle(title, type) {
  const blob = `${title || ""} ${type || ""}`.toLowerCase();
  return /sign\s*up|signup|dinner|workshop|calendar_event/.test(blob) || type === "calendar_event";
}

/** Build week.md Notes column parts for a sync row. */
export function buildWeekNoteParts(row) {
  const hint = classifyOutcomeHint(
    row.title,
    row.type,
    row.description,
    row.points,
    row.submission_types
  );
  const parts = [(row.sources || [row.source]).join("+"), "open", hint].filter(Boolean);
  if (row.html_url) {
    const url = String(row.html_url).startsWith("http")
      ? row.html_url
      : `${BASE}${row.html_url}`;
    parts.push(`url:${url}`);
  }
  return parts;
}

export function syllabusHash(body) {
  return crypto.createHash("sha256").update(String(body || ""), "utf8").digest("hex").slice(0, 16);
}

const AGENT_POLICY_KV_RE = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i;
const AGENT_POLICY_KEYS = new Set(["agent_writes", "allow_tools", "note"]);

/**
 * Parse agent_writes / allow_tools / note from syllabus plain text.
 * Mirrors src/canvas_mcp/core/course_policy.py conflict rules.
 */
export function parseAgentPolicyFromSyllabus(body) {
  const values = {};
  for (const line of String(body || "").split(/\r?\n/)) {
    const match = AGENT_POLICY_KV_RE.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!AGENT_POLICY_KEYS.has(key)) continue;
    if (!values[key]) values[key] = [];
    values[key].push(match[2].trim());
  }

  const writeDirectives = new Set(
    (values.agent_writes || []).map((v) => v.toLowerCase())
  );
  const note = (values.note || [""])[0];
  const hasMarker = writeDirectives.size > 0;

  if (writeDirectives.size > 1) {
    return {
      hasMarker: true,
      agentWrites: "conflict",
      allowTools: null,
      note:
        note ||
        "Syllabus states conflicting agent_writes values — treat as deny until instructor fixes.",
    };
  }

  const agentWrites = writeDirectives.size ? [...writeDirectives][0] : "";

  if (agentWrites === "allow") {
    const toolDirectives = new Set(values.allow_tools || []);
    if (toolDirectives.size > 1) {
      return {
        hasMarker: true,
        agentWrites: "conflict",
        allowTools: null,
        note:
          note ||
          "Syllabus lists conflicting allow_tools values — treat as deny until instructor fixes.",
      };
    }
    const rawTools = toolDirectives.size ? [...toolDirectives][0] : "";
    const tools = rawTools
      .replace(/,/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (values.allow_tools && !tools.length) {
      return {
        hasMarker: true,
        agentWrites: "conflict",
        allowTools: null,
        note:
          note ||
          "Syllabus allows agent writes but allow_tools is empty — treat as deny.",
      };
    }
    return {
      hasMarker: true,
      agentWrites: "allow",
      allowTools: tools.length ? tools : null,
      note,
    };
  }

  if (agentWrites === "deny") {
    return { hasMarker: true, agentWrites: "deny", allowTools: null, note };
  }

  if (hasMarker) {
    return {
      hasMarker: true,
      agentWrites: "malformed",
      allowTools: null,
      note: note || "Syllabus agent_writes value could not be interpreted — treat as deny.",
    };
  }

  return { hasMarker: false, agentWrites: "", allowTools: null, note: "" };
}

/**
 * Pull prerequisite / corequisite language from syllabus plain text.
 * Returns null when nothing matched — never invents requirements.
 * @param {string} syllabusPlain
 * @returns {string | null}
 */
export function extractPrereqLanguage(syllabusPlain) {
  const text = String(syllabusPlain || "");
  if (!text.trim()) return null;
  const lines = text.split(/\r?\n/);
  const hits = [];
  const re =
    /\b(pre-?req(?:uisite)?s?|co-?req(?:uisite)?s?|prerequisite\(s\)|corequisite\(s\))\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !re.test(line)) continue;
    const chunk = [line];
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j].trim();
      if (!next || /^#{1,3}\s/.test(next)) break;
      if (next.length > 200) break;
      chunk.push(next);
    }
    hits.push(chunk.join(" ").replace(/\s+/g, " ").trim());
  }
  if (!hits.length) return null;
  // Dedupe while preserving order
  const seen = new Set();
  const unique = [];
  for (const h of hits) {
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
  }
  return unique.map((h) => `- ${h}`).join("\n");
}

/**
 * Sync-owned ## Prerequisites (from syllabus) body, or preserve existing agent notes
 * when syllabus has no prereq language.
 */
export function formatPrereqSection(syllabusPlain, existingBody, today) {
  const synced = today || schoolLocalDay();
  const extracted = extractPrereqLanguage(syllabusPlain);
  if (extracted) {
    return `(synced ${synced} — from syllabus text; confirm in catalog)\n\n${extracted}`;
  }
  const existing = String(existingBody || "").trim();
  if (existing && !isPlaceholderSection(existing)) {
    return existing;
  }
  return `(synced ${synced})\n\n- (no prerequisite language found in syllabus)`;
}

/**
 * Build inbox/grades.yaml from Canvas course enrollments (total_scores).
 * @param {object[]} courses — /api/v1/courses items with enrollments
 * @param {{ today?: string }} [opts]
 * @returns {{ path: string, count: number }}
 */
export function writeGradesYaml(courses, { today } = {}) {
  const syncDay = today || schoolLocalDay();
  const rows = [];
  for (const c of courses || []) {
    const enrollments = c.enrollments || [];
    const enrollment = enrollments[0] || {};
    const letter =
      enrollment.computed_current_grade ||
      enrollment.computed_final_grade ||
      "";
    const percent =
      enrollment.computed_current_score ??
      enrollment.computed_final_score ??
      null;
    const filePath = resolveCourseFile(c.name, c.course_code);
    const code = filePath
      ? path.basename(filePath, ".md")
      : String(c.course_code || c.id || "").replace(/\s+/g, "").toUpperCase();
    if (!code) continue;
    rows.push({
      code,
      name: c.name || "",
      canvas_course_id: c.id ?? null,
      letter: letter || "",
      percent: percent == null || percent === "" ? null : Number(percent),
    });
  }
  rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const lines = [
    `# Synced from Canvas enrollments (computed_* scores). Local GPA estimate only.`,
    `synced_at: "${syncDay}"`,
    `courses:`,
  ];
  if (!rows.length) {
    lines.push("  []");
  } else {
    for (const r of rows) {
      lines.push(`  - code: ${yamlScalar(r.code)}`);
      lines.push(`    name: ${yamlScalar(r.name)}`);
      lines.push(`    canvas_course_id: ${r.canvas_course_id == null ? "null" : r.canvas_course_id}`);
      lines.push(`    letter: ${yamlScalar(r.letter)}`);
      lines.push(
        `    percent: ${r.percent == null || Number.isNaN(r.percent) ? "null" : r.percent}`
      );
    }
  }
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  fs.writeFileSync(GRADES_PATH, `${lines.join("\n")}\n`, "utf8");
  return { path: GRADES_PATH, count: rows.length };
}

function yamlScalar(value) {
  const s = String(value ?? "");
  if (s === "") return '""';
  if (/^[{}\[\],&*!|>'"%@`]/.test(s) || /: |^\s|\s$|#/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Sync-owned markdown for ## Syllabus / agent policy notes */
export function formatAgentPolicyNotes(syllabusPlain, today) {
  const synced = today || schoolLocalDay();
  const parsed = parseAgentPolicyFromSyllabus(syllabusPlain);
  if (!parsed.hasMarker) {
    return [
      `(synced ${synced})`,
      "",
      "No `agent_writes:` marker in Canvas syllabus — MCP uses default posture",
      "(deny unless `COURSE_AGENT_POLICY_DEFAULT=allow`).",
      "",
      "Instructor may add to syllabus:",
      "```",
      "agent_writes: allow",
      "allow_tools: submit_assignment",
      "```",
      "(Tool names are preview/triage grants — submit_assignment never writes.)",
    ].join("\n");
  }

  const lines = [`(synced ${synced})`, ""];
  if (parsed.agentWrites === "conflict" || parsed.agentWrites === "malformed") {
    lines.push(`agent_writes: ${parsed.agentWrites} (synced ${synced})`);
  } else {
    lines.push(`agent_writes: ${parsed.agentWrites} (synced ${synced})`);
  }
  if (parsed.allowTools?.length) {
    lines.push(`allow_tools: ${parsed.allowTools.join(" ")}`);
  }
  if (parsed.note) {
    lines.push(`note: ${parsed.note}`);
  }
  return lines.join("\n");
}

function extractSubsection(body, heading) {
  const marker = `### ${heading}`;
  const text = String(body || "");
  const idx = text.indexOf(marker);
  if (idx === -1) return "";
  const after = text.slice(idx + marker.length).replace(/^\s*\n/, "");
  const next = after.search(/\n### /);
  return (next === -1 ? after : after.slice(0, next)).trim();
}

function removeSubsection(body, heading) {
  const marker = `### ${heading}`;
  const text = String(body || "");
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  const after = text.slice(idx + marker.length);
  const next = after.search(/\n### /);
  const tail = next === -1 ? "" : after.slice(next);
  return (text.slice(0, idx).trim() + (tail ? `\n${tail.trim()}` : "")).trim();
}

function formatPolicyPagesList(pages) {
  if (!pages?.length) {
    return "- (none matched policy keywords yet)";
  }
  return pages
    .map((p) => {
      const title = p.title || p.url || "Untitled";
      const url = p.html_url || p.url || "";
      return url ? `- ${title} — ${url}` : `- ${title}`;
    })
    .join("\n");
}

export function formatTeachers(teachers) {
  const list = (teachers || []).filter((t) => t && (t.display_name || t.name));
  if (!list.length) return "";
  return list
    .map((t) => {
      const name = t.display_name || t.name;
      return t.id ? `${name} (id ${t.id})` : name;
    })
    .join("; ");
}

function isInstructorProfilePlaceholder(body) {
  const t = String(body || "").trim();
  return (
    !t ||
    t === "-" ||
    /Profile updated:\s*\(agent fills/i.test(t) ||
    /^### Grading and weights\s*\n\s*-\s*$/m.test(t)
  );
}

function formatInstructorProfileBlock(agentBody, policyPages) {
  const policyBlock = `### Policy pages (synced)\n\n${formatPolicyPagesList(policyPages)}\n`;
  if (isInstructorProfilePlaceholder(agentBody)) {
    return `Profile updated: (agent fills via \`student-instructor-profile\`)\n\n${policyBlock}`;
  }
  const withoutPolicy = removeSubsection(agentBody, "Policy pages (synced)").trim();
  return `${withoutPolicy}\n\n${policyBlock}`;
}

/**
 * Merge sync-owned catalog/checkpoints into inbox/courses/CODE.md.
 * Preserves Theme, Arc notes, Weak topics, Instructor profile (agent),
 * Syllabus, Modules, Worth, Lecture captures when present.
 * Sync-owned: Checkpoints, Assignment catalog, Tools this semester,
 * Prerequisites (from syllabus) when syllabus text is present.
 */
export function mergeCourseFileContent({
  existingContent,
  courseTitle,
  catalogRows,
  today,
  syncMeta = {},
  toolInventory = null,
}) {
  const existing = String(existingContent || "");
  const header = parseCourseHeader(existing, courseTitle);
  const sections = existing ? existing : "";
  const theme = cleanSectionBody(extractSection(sections, "Theme"), "Theme");
  const arcNotes = cleanSectionBody(extractSection(sections, "Arc notes"), "Arc notes");
  const weakTopics = cleanSectionBody(
    extractSection(sections, "Weak topics"),
    "Weak topics"
  );
  const lectureCaptures = cleanSectionBody(
    extractSection(sections, "Lecture captures"),
    "Lecture captures"
  );
  const instructorProfile = cleanSectionBody(
    extractSection(sections, "Instructor profile"),
    "Instructor profile"
  );
  const syllabus = cleanSectionBody(
    extractSection(sections, "Syllabus / agent policy notes"),
    "Syllabus / agent policy notes"
  );
  const prereqsExisting = cleanSectionBody(
    extractSection(sections, "Prerequisites (from syllabus)"),
    "Prerequisites (from syllabus)"
  );
  const modules = cleanSectionBody(
    extractSection(sections, "Modules / what's next"),
    "Modules / what's next"
  );
  const worth = cleanSectionBody(
    extractSection(sections, "Worth your time defaults"),
    "Worth your time defaults"
  );
  const registrationLog = cleanSectionBody(
    extractSection(sections, "Registration log"),
    "Registration log"
  );

  const sectionsLine = parseMetaField(existing, "Sections");
  const canvasUrl =
    syncMeta.canvasUrl || parseMetaField(existing, "Canvas URL");
  const primaryInstructors =
    syncMeta.primaryInstructors || parseMetaField(existing, "Primary instructor(s)");
  const tas = syncMeta.tas || parseMetaField(existing, "TA(s)");
  const syllabusHashValue = Object.prototype.hasOwnProperty.call(syncMeta, "syllabusHash")
    ? syncMeta.syllabusHash
    : (syncMeta.syllabusSynced && !syncMeta.syllabusPlain ? "(none)" : "") ||
      parseMetaField(existing, "Syllabus hash");
  const policyPages = syncMeta.policyPages ?? null;
  const agentPolicyBlock =
    syncMeta.syllabusPlain != null
      ? `${formatAgentPolicyNotes(syncMeta.syllabusPlain, today)}\n`
      : isPlaceholderSection(syllabus)
        ? "-\n"
        : `${syllabus}\n`;

  const themeBlock = isPlaceholderSection(theme) ? "-\n" : `${theme}\n`;
  const arcBlock = isPlaceholderSection(arcNotes) ? "-\n" : `${arcNotes}\n`;
  const weakBlock = isPlaceholderSection(weakTopics)
    ? ""
    : `## Weak topics\n\n${weakTopics}\n\n`;
  const lectureBlock = isPlaceholderSection(lectureCaptures)
    ? ""
    : `## Lecture captures\n\n${lectureCaptures}\n\n`;
  const instructorBlock = `${formatInstructorProfileBlock(
    instructorProfile,
    policyPages
  )}\n`;

  const inventory =
    toolInventory ||
    aggregateToolInventory(catalogRows || [], {
      existingSection: extractSection(sections, "Tools this semester"),
      today: today || schoolLocalDay(),
    });
  const toolsBlock = formatToolsSection(inventory);
  const prereqBlock =
    syncMeta.syllabusPlain != null
      ? formatPrereqSection(syncMeta.syllabusPlain, prereqsExisting, today)
      : isPlaceholderSection(prereqsExisting)
        ? formatPrereqSection("", prereqsExisting, today)
        : prereqsExisting;

  return `# ${header}

Updated: ${today || schoolLocalDay()}

Sections: ${sectionsLine || ""}
Canvas URL: ${canvasUrl || ""}
Primary instructor(s): ${primaryInstructors || ""}
TA(s): ${tas || ""}
Syllabus hash: ${syllabusHashValue || ""}

## Theme

${themeBlock}
## Checkpoints

${formatCheckpoints(catalogRows)}

## Assignment catalog

Synced from Canvas \`/api/v1\` (open items, term window). Not the 14d due-list — see \`inbox/week.md\` for what's due now.

${formatCatalogTable(catalogRows)}

## Tools this semester

${toolsBlock}

## Prerequisites (from syllabus)

${prereqBlock}

## Arc notes

${arcBlock}${weakBlock}${lectureBlock}## Instructor profile

${instructorBlock}
## Syllabus / agent policy notes

${agentPolicyBlock}
## Modules / what's next

${isPlaceholderSection(modules) ? "-\n" : `${modules}\n`}
## Worth your time defaults

${isPlaceholderSection(worth) ? "(See USER.md for this course.)\n" : `${worth}\n`}
${isPlaceholderSection(registrationLog) ? "" : `## Registration log\n\n${registrationLog}\n`}
`;
}

export function writeCourseCatalogFiles(perCourse, { today } = {}) {
  const syncDay = today || schoolLocalDay();
  fs.mkdirSync(COURSES_DIR, { recursive: true });
  fs.mkdirSync(COURSES_RAW_DIR, { recursive: true });
  const written = [];
  /** @type {{ code: string, courseName: string, tools: object[] }[]} */
  const inventories = [];

  for (const course of perCourse || []) {
    const filePath = resolveCourseFile(course.name, course.code);
    if (!filePath) {
      console.warn(
        `No catalog mapping for enrolled course: ${course.name} (${course.code || course.id})`
      );
      continue;
    }

    const code = path.basename(filePath, ".md");
    if (course.syllabusPlain) {
      const rawPath = path.join(COURSES_RAW_DIR, `${code}-syllabus.txt`);
      fs.writeFileSync(rawPath, course.syllabusPlain, "utf8");
    }

    const catalogRows = filterCatalogRows(course.rows || [], { today: syncDay });
    let existing = "";
    try {
      existing = fs.readFileSync(filePath, "utf8");
    } catch {
      /* new file */
    }

    const syncMeta = {
      canvasUrl: course.canvasUrl || "",
      primaryInstructors: course.primaryInstructors || "",
      tas: course.tas || "",
      syllabusHash: course.syllabusHash || "",
      syllabusPlain: course.syllabusPlain ?? null,
      syllabusSynced: !!course.syllabus_ok,
      policyPages: course.policyPages || [],
    };

    // Inventory uses all term rows (incl. complete); catalog table stays open-window.
    const toolInventory = aggregateToolInventory(course.rows || [], {
      existingSection: extractSection(existing, "Tools this semester"),
      today: syncDay,
    });
    inventories.push({
      code,
      courseName: course.name || code,
      tools: toolInventory,
    });

    const md = mergeCourseFileContent({
      existingContent: existing,
      courseTitle: course.name,
      catalogRows,
      today: syncDay,
      syncMeta,
      toolInventory,
    });
    fs.writeFileSync(filePath, md, "utf8");
    written.push({
      file: filePath,
      code,
      catalogCount: catalogRows.length,
      checkpoints: catalogRows.filter((r) => isCheckpoint(r.title, r.type)).length,
      syllabus: !!course.syllabusPlain,
      policyPages: (course.policyPages || []).length,
      tools: toolInventory.length,
    });
  }

  writeToolGapsFile(inventories, { today: syncDay });
  return written;
}

/** @param {unknown} points */
export function isGradedItem(points) {
  const n = Number(points);
  return Number.isFinite(n) && n > 0;
}

/**
 * Detect a distinct external tool from sync row fields (no launch-URL fetch).
 * Bucket is a property of the tool — Bucket B has no trust/override flag.
 *
 * @returns {{ name: string, slug: string, bucket: "A"|"B" } | null}
 */
export function detectExternalTool(title, type, description = "", points = "") {
  const blob = `${title || ""} ${type || ""} ${description || ""}`;
  const typeStr = String(type || "").toLowerCase();
  const graded = isGradedItem(points);

  for (const entry of ASSESSMENT_TOOL_NAMES) {
    if (entry.re.test(blob)) {
      return { name: entry.name, slug: entry.slug, bucket: "B" };
    }
  }
  if (ASSESSMENT_TOOL_RE.test(blob)) {
    return { name: "Assessment LTI", slug: "assessment-lti", bucket: "B" };
  }

  // Graded external_tool is assessment-shaped even without a known vendor name.
  if (typeStr === "external_tool" && graded) {
    return {
      name: "External tool (graded)",
      slug: "external-tool-graded",
      bucket: "B",
    };
  }

  const externalSurface =
    typeStr === "external_tool" ||
    /https?:\/\/[^\s<]*(?:calendar|\.ics|cglink|campusgroups|gradebook)/i.test(blob);
  for (const entry of ADMIN_TOOL_NAMES) {
    if (externalSurface && entry.re.test(blob)) {
      return { name: entry.name, slug: entry.slug, bucket: "A" };
    }
  }

  if (typeStr === "external_tool") {
    return {
      name: "External tool",
      slug: "external-tool",
      bucket: "A",
    };
  }

  return null;
}

/** Thin wrapper: bucket assignment only (`A` | `B` | null). */
export function classifyToolBucket(title, type, description = "", points = "") {
  return detectExternalTool(title, type, description, points)?.bucket ?? null;
}

/**
 * Aggregate distinct tools from catalog/universe rows.
 * Preserves earlier first-seen dates from a prior Tools section when present.
 */
export function aggregateToolInventory(rows, { existingSection = "", today } = {}) {
  const syncDay = today || schoolLocalDay();
  const prior = parseToolsFirstSeen(existingSection);
  /** @type {Map<string, { name: string, slug: string, bucket: "A"|"B", count: number, firstSeen: string }>} */
  const bySlug = new Map();

  for (const row of rows || []) {
    const tool = detectExternalTool(
      row.title,
      row.type,
      row.description,
      row.points
    );
    if (!tool) continue;
    const dueDay = row.due ? schoolLocalDay(new Date(row.due)) : syncDay;
    const candidateSeen = /^\d{4}-\d{2}-\d{2}$/.test(dueDay) ? dueDay : syncDay;
    const prev = bySlug.get(tool.slug);
    if (!prev) {
      const remembered = prior.get(tool.slug);
      bySlug.set(tool.slug, {
        name: tool.name,
        slug: tool.slug,
        bucket: tool.bucket,
        count: 1,
        firstSeen: remembered || candidateSeen,
      });
    } else {
      prev.count += 1;
      if (candidateSeen < prev.firstSeen) prev.firstSeen = candidateSeen;
      // Bucket B wins if the same slug ever looks assessment-shaped.
      if (tool.bucket === "B") prev.bucket = "B";
    }
  }

  return [...bySlug.values()].sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
    return a.name.localeCompare(b.name);
  });
}

/** @param {string} sectionBody */
export function parseToolsFirstSeen(sectionBody) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of String(sectionBody || "").split("\n")) {
    const m = line.match(
      /^\|\s*([^|]+?)\s*\|\s*([AB])\s*\|\s*\d+\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/
    );
    if (!m) continue;
    const name = m[1].trim();
    const firstSeen = m[3];
    const slug = slugifyToolName(name);
    if (slug && !map.has(slug)) map.set(slug, firstSeen);
  }
  return map;
}

function slugifyToolName(name) {
  const known = [...ASSESSMENT_TOOL_NAMES, ...ADMIN_TOOL_NAMES].find(
    (e) => e.name.toLowerCase() === String(name || "").toLowerCase()
  );
  if (known) return known.slug;
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Sync-owned markdown for ## Tools this semester. */
export function formatToolsSection(inventory) {
  const header =
    "Discovery-only (no launch URLs followed). Bucket B = escape hatch only; Bucket A = registry-eligible when a reviewed connector exists — never auto-build.\n\n" +
    "| Tool | Bucket | Count | First seen |\n|------|--------|-------|------------|";
  if (!inventory?.length) {
    return `${header}\n| (none detected) | | | |`;
  }
  return [
    header,
    ...inventory.map(
      (t) =>
        `| ${escCell(t.name)} | ${t.bucket} | ${t.count} | ${escCell(t.firstSeen)} |`
    ),
  ].join("\n");
}

/**
 * Flag Bucket-A tools with no registry entry. Does not write or fetch code.
 * @param {{ code: string, courseName: string, tools: object[] }[]} inventories
 */
export function writeToolGapsFile(inventories, { today } = {}) {
  const syncDay = today || schoolLocalDay();
  const schoolSlug = getSchoolConfig().slug || "";
  /** @type {Map<string, { name: string, slug: string, courses: Set<string> }>} */
  const gaps = new Map();

  for (const inv of inventories || []) {
    for (const tool of inv.tools || []) {
      if (tool.bucket !== "A") continue;
      if (hasConnector(tool.slug, schoolSlug)) continue;
      const key = tool.slug;
      let entry = gaps.get(key);
      if (!entry) {
        entry = { name: tool.name, slug: tool.slug, courses: new Set() };
        gaps.set(key, entry);
      }
      entry.courses.add(inv.code || inv.courseName || "?");
    }
  }

  const registered = listConnectorsForSchool(schoolSlug)
    .map((c) => `- \`${c.id}\` → \`${c.pluginDir}\``)
    .join("\n");

  const gapRows = [...gaps.values()].sort((a, b) => a.name.localeCompare(b.name));
  const table =
    gapRows.length > 0
      ? [
          "| Tool | Courses | Notes |",
          "|------|---------|-------|",
          ...gapRows.map(
            (g) =>
              `| ${escCell(g.name)} | ${escCell([...g.courses].sort().join(", "))} | No connector in registry — flag only; do not auto-build |`
          ),
        ].join("\n")
      : "_None — every Bucket-A tool detected this sync has a registry entry (or none detected)._";

  const md = `# Tool connector gaps

Updated: ${syncDay}

Bucket-A tools from course inventories with **no** matching entry in the static connector registry (\`browser/scripts/lib/connector-registry.mjs\`).

Agent action: flag only (this file). Do **not** fetch, write, or execute connector code. A maintainer may add \`plugins/{school}/{tool}/\` via reviewed PR — see \`plugins/README.md\`.

## Gaps

${table}

## Registered Bucket-A connectors (${schoolSlug || "school"})

${registered || "_None registered for this school._"}
`;

  fs.mkdirSync(INBOX_DIR, { recursive: true });
  fs.writeFileSync(TOOL_GAPS_PATH, md, "utf8");
  return { path: TOOL_GAPS_PATH, gapCount: gapRows.length };
}

export function classifyOutcomeHint(
  title,
  type,
  description = "",
  points = "",
  submissionTypes = []
) {
  const blob = `${title || ""} ${type || ""} ${description || ""} ${Array.isArray(submissionTypes) ? submissionTypes.join(" ") : submissionTypes}`.toLowerCase();
  const typeStr = String(type || "").toLowerCase();
  const descHtml = String(description || "").toLowerCase();

  const tool = detectExternalTool(title, type, description, points);
  if (tool?.bucket === "B") {
    return `outcome:lti; bucket:B; tool:${tool.name}; external/LTI — browser+student; never auto`;
  }
  // Bucket A admin tools that are not CampusGroups signup flows.
  if (tool?.bucket === "A" && tool.slug !== "campusgroups") {
    return `outcome:external-admin; bucket:A; tool:${tool.name}; registry-eligible — flag gap if no connector; never auto-build`;
  }

  if (/\bquiz\b|\bexam\b|\bmidterm\b|\bfinal\s+(?:exam|quiz)\b/.test(blob)) {
    return "outcome:quiz; assessment — student only";
  }
  if (/presentation|in-class\s+present/.test(blob)) {
    return "outcome:presentation; student only";
  }

  const externalSignup =
    hasExternalSignupLink(descHtml) ||
    /campusgroups|cglink\.me|major\s*dinner|ai\s*lab\s*workshop/.test(blob);
  const uploadAfter =
    hasUploadAfterEventHint(description) ||
    hasUploadAfterEventHint(blob) ||
    isCoenTwoStepSignup(title);

  if (externalSignup) {
    let outcome = "outcome:signup-external";
    if (uploadAfter) outcome += "+upload-after-event";
    let extra = "bucket:A; tool:CampusGroups; rsvp:CampusGroups";
    if (uploadAfter) extra += "; canvas_submit:post-dinner selfie";
    return `${outcome}; ${extra}`;
  }

  if (isSignupTitle(title, type)) {
    if (uploadAfter) {
      return "outcome:signup+upload-after-event; canvas_submit:post-event upload";
    }
    return "outcome:signup";
  }
  if (/thought\s*project|philosophy\s*of|relationship\s*to\s*engineering/.test(blob)) {
    return "outcome:written; reflection — student voice";
  }
  if (/recitation\s*scan/.test(blob)) {
    return "outcome:written";
  }
  if (/challenge\s*activit/.test(blob)) {
    return "outcome:lab";
  }
  if (/\bdiscussion_topic\b|\bdiscussion\b/.test(`${typeStr} ${descHtml}`)) {
    return "outcome:discussion";
  }
  if (/pre[\s-]?reading|pre[\s-]?class|reading\b/.test(blob)) {
    return "outcome:reading";
  }
  if (/\blab\b|pre[\s-]?lab/.test(blob)) {
    return "outcome:lab";
  }
  if (/written\s*hw|essay|reflection|case\b|gen\s*ai\s*assignment|survey/.test(blob)) {
    return "outcome:written";
  }
  if (
    /syllabus\s*video|playlist|training|access\b|orientation/.test(blob) ||
    typeStr === "announcement"
  ) {
    return "outcome:busywork";
  }
  return "";
}

/** Exclude recurring class meetings and non-actionable announcements from week table. */
export function shouldIncludeInWeekTable(row) {
  const type = String(row?.type || "").toLowerCase();
  const title = String(row?.title || "").toLowerCase();

  if (type === "calendar_event" || type === "event") {
    if (
      /section\s*\d+|fall\s*\d+\s*section/.test(title) &&
      !/sign\s*up|signup|dinner|workshop/.test(title)
    ) {
      return false;
    }
  }

  if (type === "announcement") {
    if (
      !row?.points &&
      /available|reminder|answers\/lecture|extensions|class reminders|lecture-video/.test(
        title
      )
    ) {
      return false;
    }
  }

  return true;
}

/** @deprecated Prefer classifyOutcomeHint; kept for callers that only want LTI/assessment. */
export function classifyExternalHint(title, type) {
  const full = classifyOutcomeHint(title, type);
  if (!full) return "";
  if (full.includes("external/LTI") || full.includes("assessment")) {
    return full.replace(/^outcome:\w+;\s*/, "");
  }
  return "";
}

function submissionComplete(submission) {
  if (!submission || typeof submission !== "object") return false;
  if (submission.submitted_at) return true;
  const state = String(submission.workflow_state || "").toLowerCase();
  return state === "submitted" || state === "graded" || state === "pending_review";
}

/** Prefer student override due from all_dates; never treat lock_at as due. */
export function studentDueAt(assignment) {
  const dates = assignment?.all_dates;
  if (Array.isArray(dates) && dates.length) {
    const override = dates.find((d) => d && d.base === false && d.due_at);
    if (override?.due_at) return override.due_at;
    const base = dates.find((d) => d && d.base !== false && d.due_at);
    if (base?.due_at) return base.due_at;
    const any = dates.find((d) => d?.due_at);
    if (any?.due_at) return any.due_at;
  }
  return assignment?.due_at || "";
}

export function fromPlanner(items) {
  const rows = [];
  for (const item of items || []) {
    const p = item.plannable || {};
    const canvasId =
      item.plannable_id || p.id || item.assignment_id || undefined;
    rows.push({
      source: "planner",
      course: item.context_name || item.course_name || item.context_code || "",
      title: p.title || p.name || item.plannable_type || "Untitled",
      due: item.plannable_date || p.due_at || p.todo_date || "",
      points: p.points_possible ?? "",
      type: item.plannable_type || "",
      html_url: item.html_url || p.html_url || "",
      complete: !!(
        item.planner_override?.marked_complete || item.submissions?.submitted
      ),
      course_id:
        item.course_id ||
        (String(item.context_code || "").match(/course_(\d+)/) || [])[1],
      canvas_id: canvasId != null ? String(canvasId) : "",
    });
  }
  return rows;
}

export function fromTodo(items) {
  const rows = [];
  for (const t of items || []) {
    const a = t.assignment || {};
    const submission = a.submission;
    rows.push({
      source: "todo",
      course: t.context_name || a.course_id || "",
      title: a.name || t.type || "Todo",
      due: a.due_at || "",
      points: a.points_possible ?? "",
      type: t.type || "todo",
      html_url: a.html_url || "",
      complete: submissionComplete(submission),
      course_id: a.course_id,
      canvas_id: a.id != null ? String(a.id) : "",
    });
  }
  return rows;
}

export function fromAssignments(courseName, courseId, assignments) {
  const rows = [];
  for (const a of assignments || []) {
    const submissionTypes = a.submission_types || [];
    rows.push({
      source: "course_assignments",
      course: courseName,
      title: a.name || "Assignment",
      due: studentDueAt(a),
      points: a.points_possible ?? "",
      type: submissionTypes.includes("external_tool")
        ? "external_tool"
        : (a.is_quiz_assignment && "quiz") ||
          submissionTypes.join(",") ||
          "assignment",
      html_url: a.html_url || "",
      description: [a.description || "", a.external_tool_tag_attributes?.url || ""]
        .filter(Boolean)
        .join(" "),
      submission_types: submissionTypes,
      complete: submissionComplete(a.submission),
      course_id: courseId,
      canvas_id: a.id != null ? String(a.id) : "",
    });
  }
  return rows;
}

export function fromDiscussions(courseName, courseId, topics) {
  const rows = [];
  for (const t of topics || []) {
    const due = t.due_at || t.assignment?.due_at || "";
    if (!due) continue;
    const submission = t.assignment?.submission;
    rows.push({
      source: "discussion_topics",
      course: courseName,
      title: t.title || "Discussion",
      due,
      points: t.assignment?.points_possible ?? t.points_possible ?? "",
      type: t.assignment_id ? "discussion_topic" : "discussion_topic",
      html_url: t.html_url || "",
      description: t.message || t.description || "",
      submission_types: t.assignment?.submission_types || [],
      complete: submissionComplete(submission),
      course_id: courseId,
      canvas_id: t.id != null ? String(t.id) : "",
    });
  }
  return rows;
}

export function fromCalendar(events) {
  const rows = [];
  for (const e of events || []) {
    const assignment = e.assignment || {};
    rows.push({
      source: "calendar",
      course: e.context_name || e.context_code || "",
      title: e.title || assignment.name || "Event",
      due: assignment.due_at || e.start_at || e.end_at || "",
      points: assignment.points_possible ?? "",
      type: e.type || (assignment.id ? "assignment" : "calendar_event"),
      html_url: e.html_url || assignment.html_url || "",
      complete: false,
      course_id: (String(e.context_code || "").match(/course_(\d+)/) || [])[1],
      canvas_id:
        assignment.id != null
          ? String(assignment.id)
          : e.id != null
            ? `cal_${e.id}`
            : "",
    });
  }
  return rows;
}

export function dedupeRows(rows) {
  const byId = new Map();
  const byKey = new Map();

  const merge = (prev, next) => {
    if (!prev.sources.includes(next.source)) prev.sources.push(next.source);
    if (!prev.due && next.due) prev.due = next.due;
    if ((prev.points === "" || prev.points == null) && next.points != null) {
      prev.points = next.points;
    }
    if (!prev.html_url && next.html_url) prev.html_url = next.html_url;
    if (!prev.type && next.type) prev.type = next.type;
    if (next.complete) prev.complete = true;
    if (!prev.canvas_id && next.canvas_id) prev.canvas_id = next.canvas_id;
    if (!prev.course_id && next.course_id) prev.course_id = next.course_id;
    return prev;
  };

  for (const r of rows) {
    const enriched = { ...r, sources: [r.source] };
    const idKey =
      enriched.canvas_id && String(enriched.canvas_id)
        ? `${enriched.course_id || ""}::${enriched.canvas_id}`
        : null;

    if (idKey) {
      const prev = byId.get(idKey);
      if (!prev) byId.set(idKey, enriched);
      else merge(prev, enriched);
      continue;
    }

    const k = keyOf(enriched.course, enriched.title, enriched.due);
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, enriched);
    else merge(prev, enriched);
  }

  // Fold title-key rows into id rows when titles match (no id on one side).
  for (const [, row] of byKey) {
    let folded = false;
    for (const idRow of byId.values()) {
      if (
        (idRow.title || "").toLowerCase() === (row.title || "").toLowerCase() &&
        String(idRow.course_id || "") === String(row.course_id || "") &&
        (idRow.due || "").slice(0, 10) === (row.due || "").slice(0, 10)
      ) {
        merge(idRow, row);
        folded = true;
        break;
      }
    }
    if (!folded) byId.set(`key::${keyOf(row.course, row.title, row.due)}`, row);
  }

  // Final collapse: same course + title + Denver due-day under different Canvas ids
  // (e.g. planner quiz vs todo "submitting", or calendar event vs planner calendar_event).
  const typeRank = (t) => {
    const x = String(t || "").toLowerCase();
    if (x === "quiz" || x.includes("quiz")) return 5;
    if (x === "assignment" || x === "discussion_topic") return 4;
    if (x === "announcement") return 3;
    if (x === "calendar_event") return 2;
    if (x === "submitting" || x === "event") return 1;
    return 2;
  };

  const byTitleDay = new Map();
  for (const row of byId.values()) {
    const dueDay = row.due ? schoolLocalDay(new Date(row.due)) : "";
    const k = `${(row.course || "").toLowerCase()}||${(row.title || "").toLowerCase()}||${dueDay}`;
    const prev = byTitleDay.get(k);
    if (!prev) {
      byTitleDay.set(k, row);
      continue;
    }
    // Prefer richer / more specific row, then merge sources.
    if (typeRank(row.type) > typeRank(prev.type)) {
      merge(row, prev);
      byTitleDay.set(k, row);
    } else {
      merge(prev, row);
    }
  }

  return [...byTitleDay.values()].sort((a, b) =>
    String(a.due).localeCompare(String(b.due))
  );
}

export function filterPolicyPages(pages) {
  return (pages || [])
    .filter((p) => p && (p.published !== false) && POLICY_PAGE_RE.test(String(p.title || "")))
    .map((p) => ({
      title: p.title,
      url: p.url,
      html_url: p.html_url || (p.url ? `${BASE}/courses/${p.course_id || ""}/pages/${p.url}` : ""),
    }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

async function fetchCourseInstructorMeta(page, courseId) {
  const detailRes = await apiGet(page, `/api/v1/courses/${courseId}`, {
    "include[]": ["syllabus_body", "teachers"],
  });
  if (!detailRes.ok) {
    return {
      ok: false,
      status: detailRes.status,
      canvasUrl: "",
      primaryInstructors: "",
      tas: "",
      syllabusPlain: "",
      syllabusHash: "",
      policyPages: [],
    };
  }

  const course = detailRes.json || {};
  const teachers = course.teachers || [];
  const primary = formatTeachers(
    teachers.filter((t) => !/ta\b|teaching assistant/i.test(String(t.display_name || t.name || "")))
  );
  const tas = formatTeachers(
    teachers.filter((t) => /ta\b|teaching assistant/i.test(String(t.display_name || t.name || "")))
  );
  const syllabusBody = course.syllabus_body || "";
  const syllabusPlain = stripHtmlTags(syllabusBody);

  const pagesRes = await apiAllPages(page, `/api/v1/courses/${courseId}/pages`, {
    per_page: 100,
  });
  const policyPages = pagesRes.ok
    ? filterPolicyPages(
        (pagesRes.items || []).map((p) => ({
          ...p,
          course_id: courseId,
          html_url: p.html_url || `${BASE}/courses/${courseId}/pages/${p.url}`,
        }))
      )
    : [];

  return {
    ok: true,
    status: detailRes.status,
    canvasUrl: course.html_url || `${BASE}/courses/${courseId}`,
    primaryInstructors: primary || formatTeachers(teachers),
    tas,
    syllabusPlain,
    syllabusHash: syllabusPlain ? syllabusHash(syllabusPlain) : "",
    policyPages,
    pagesOk: pagesRes.ok,
  };
}

function healthEntry(res, extra = {}) {
  return {
    ok: !!res?.ok,
    count: res?.items?.length ?? res?.count ?? 0,
    status: res?.status,
    truncated: !!res?.truncated,
    ...extra,
  };
}

/** Fetch assignment descriptions for signup-titled rows (CampusGroups link detection). */
export async function enrichSignupDescriptions(page, universe) {
  const signupRows = (universe || []).filter(
    (r) => isSignupTitle(r.title, r.type) && r.course_id && r.canvas_id && !r.description
  );
  const byKey = new Map();
  for (const row of signupRows) {
    const key = `${row.course_id}:${row.canvas_id}`;
    if (byKey.has(key)) continue;
    byKey.set(key, row);
  }

  for (const row of byKey.values()) {
    const res = await api(
      page,
      `/api/v1/courses/${row.course_id}/assignments/${row.canvas_id}`
    );
    if (res.ok && res.json?.description) {
      row.description = res.json.description;
      for (const r of universe) {
        if (r.course_id === row.course_id && r.canvas_id === row.canvas_id) {
          r.description = res.json.description;
        }
      }
    }
  }
}

/**
 * Fetch the canonical due-work universe via SSO session → /api/v1.
 * Prefer this over DOM scraping. Used by both sync and audit.
 */
export async function fetchDueUniverse(page, { daysAhead = 14 } = {}) {
  const today = schoolLocalDay();
  const start = schoolMidnightUtc(today);
  const end = schoolMidnightUtc(addSchoolDays(today, daysAhead));
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const startDay = today;
  const endDay = addSchoolDays(today, daysAhead);
  const health = {};

  const coursesRes = await apiAllPages(page, "/api/v1/courses", {
    enrollment_state: "active",
    "include[]": ["total_scores", "current_grading_period_scores"],
  });
  health.courses = healthEntry(coursesRes);
  if (!coursesRes.ok) {
    throw new Error(
      `Courses API failed (${coursesRes.status}). Re-run open-canvas or check session.`
    );
  }
  const courses = coursesRes.items || [];

  const plannerRes = await fetchPlannerItems(page, startIso, endIso);
  health.planner = healthEntry(plannerRes);

  // Second pass: incomplete items (peer review / assessment_request gaps).
  // Soft-fail: some Canvas tenants reject this filter (HTTP 400).
  const plannerIncompleteRes = await fetchPlannerItems(page, startIso, endIso, {
    filter: "incomplete_items",
  });
  health.planner_incomplete = healthEntry(plannerIncompleteRes);
  if (!plannerIncompleteRes.ok) {
    console.warn(
      "Planner incomplete_items filter unavailable; continuing without that pass."
    );
  }

  const todoRes = await apiAllPages(page, "/api/v1/users/self/todo", {});
  health.todo = healthEntry(todoRes);

  const contextCodes = courses.map((c) => `course_${c.id}`);
  let calAssign = { ok: true, items: [], truncated: false };
  let calEvents = { ok: true, items: [], truncated: false };
  if (contextCodes.length) {
    calAssign = await apiAllPages(page, "/api/v1/calendar_events", {
      type: "assignment",
      start_date: startDay,
      end_date: endDay,
      "context_codes[]": contextCodes,
      all_events: "true",
    });
    calEvents = await apiAllPages(page, "/api/v1/calendar_events", {
      type: "event",
      start_date: startDay,
      end_date: endDay,
      "context_codes[]": contextCodes,
      all_events: "true",
    });
  }
  health.calendar_assignments = healthEntry(calAssign);
  health.calendar_events = healthEntry(calEvents);

  const allRows = [
    ...fromPlanner(plannerRes.items),
    ...(plannerIncompleteRes.ok
      ? fromPlanner(plannerIncompleteRes.items)
      : []),
    ...fromTodo(todoRes.items),
    ...fromCalendar(calAssign.items),
    ...fromCalendar(calEvents.items),
  ];

  const perCourse = [];
  let assignmentHardFail = false;
  let syllabusFail = 0;
  let syllabusOk = 0;
  for (const c of courses) {
    const id = c.id;
    const name = c.name || c.course_code || String(id);
    const aRes = await apiAllPages(page, `/api/v1/courses/${id}/assignments`, {
      order_by: "due_at",
      "include[]": ["submission", "all_dates"],
    });
    const dRes = await apiAllPages(
      page,
      `/api/v1/courses/${id}/discussion_topics`,
      {
        "include[]": ["assignment", "all_dates"],
      }
    );
    const instructorMeta = await fetchCourseInstructorMeta(page, id);
    if (instructorMeta.ok) syllabusOk += 1;
    else syllabusFail += 1;

    const aRows = aRes.ok ? fromAssignments(name, id, aRes.items || []) : [];
    const dRows = dRes.ok ? fromDiscussions(name, id, dRes.items || []) : [];
    const courseRows = dedupeRows([...aRows, ...dRows]);
    perCourse.push({
      id,
      name,
      code: c.course_code,
      rows: courseRows,
      assignments_ok: aRes.ok,
      assignments_count: aRows.length,
      assignments_truncated: !!aRes.truncated,
      discussions_ok: dRes.ok,
      discussions_count: dRows.length,
      canvasUrl: instructorMeta.canvasUrl,
      primaryInstructors: instructorMeta.primaryInstructors,
      tas: instructorMeta.tas,
      syllabusPlain: instructorMeta.syllabusPlain,
      syllabusHash: instructorMeta.syllabusHash,
      policyPages: instructorMeta.policyPages,
      syllabus_ok: instructorMeta.ok,
    });
    if (!aRes.ok) assignmentHardFail = true;
    if (aRes.ok) allRows.push(...aRows);
    if (dRes.ok) allRows.push(...dRows);
  }

  health.assignments = {
    ok: !assignmentHardFail,
    count: perCourse.reduce((n, c) => n + c.assignments_count, 0),
    truncated: perCourse.some((c) => c.assignments_truncated),
  };
  health.discussions = {
    ok: perCourse.every((c) => c.discussions_ok),
    count: perCourse.reduce((n, c) => n + c.discussions_count, 0),
  };
  health.syllabus = {
    ok: syllabusFail === 0,
    count: syllabusOk,
    failed: syllabusFail,
  };

  if (assignmentHardFail) {
    console.warn(
      "Warning: one or more per-course assignment fetches failed; week list may be incomplete."
    );
  }

  const universe = dedupeRows(allRows);
  await enrichSignupDescriptions(page, universe);
  return {
    courses,
    universe,
    health,
    perCourse,
    start,
    end,
    today,
    startDay,
    endDay,
  };
}

/** Rows with a real due date inside [today, today+daysAhead] (Denver days). */
export function filterDatedInWindow(universe, { today, daysAhead, includeComplete = false } = {}) {
  const startDay = today || schoolLocalDay();
  const endDay = addSchoolDays(startDay, Number(daysAhead || 14));

  return (universe || []).filter((r) => {
    if (!r.due) return false;
    if (!includeComplete && r.complete) return false;
    const dueDay = schoolLocalDay(new Date(r.due));
    return dueDay >= startDay && dueDay <= endDay;
  });
}

/** Collect human-readable truncation warnings from sync health. */
export function collectTruncationWarnings(health) {
  const warnings = [];
  if (!health) return warnings;
  const labels = {
    courses: "courses",
    planner: "planner",
    planner_incomplete: "planner_incomplete",
    todo: "todo",
    calendar_assignments: "calendar_assignments",
    calendar_events: "calendar_events",
    assignments: "assignments",
    discussions: "discussions",
    syllabus: "syllabus",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (health[key]?.truncated) {
      warnings.push(`${label} (count=${health[key].count ?? 0})`);
    }
  }
  return warnings;
}
