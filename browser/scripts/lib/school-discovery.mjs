/**
 * School discovery — the student's school is found, never hard-coded.
 *
 *   1. search: Instructure's public account search (the same lookup the Canvas
 *      Student mobile app uses) turns "ohio state" into `osu.instructure.com`.
 *   2. choose: the pick is saved to `{user_root}/school/profile.json`.
 *   3. enrich: after SSO, Canvas itself tells us the timezone, current term and
 *      brand color (`enrichFromCanvas`).
 *
 * A curated `schools/{slug}.yaml` whose `canvas_base_url` host matches is layered
 * on top for things Canvas cannot know (policy links, campus plugins, legal notice).
 * See docs/architecture/school-personalization.md.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveUserRoot } from "./user-root.mjs";

export const INSTRUCTURE_SEARCH = "https://canvas.instructure.com/api/v1/accounts/search";
export const PROFILE_VERSION = 1;

/** Accept "osu.instructure.com", "https://canvas.colorado.edu/courses", etc. Returns a bare lowercase host. */
export function normalizeCanvasHost(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Enter your school's Canvas address.");
  let host;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    throw new Error(`"${raw}" is not a web address.`);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes("..")) {
    throw new Error(`"${raw}" is not a Canvas address.`);
  }
  return host;
}

/** Stable slug for a school with no curated yaml: canvas.colorado.edu -> canvas-colorado-edu. */
export function hostSlug(host) {
  return normalizeCanvasHost(host).replace(/\./g, "-");
}

/**
 * Search Instructure-hosted and self-hosted Canvas schools by name.
 * @returns {Promise<Array<{ name: string, host: string, account_id: number | null }>>}
 */
export async function searchSchools(term, { fetchImpl = globalThis.fetch, limit = 8 } = {}) {
  const q = String(term || "").trim();
  if (q.length < 2) return [];
  const url = `${INSTRUCTURE_SEARCH}?search_term=${encodeURIComponent(q)}&per_page=${Math.max(limit * 2, 10)}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`School search failed (${res.status}).`);
  const rows = await res.json();
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.domain || !row.name) continue;
    let host;
    try {
      host = normalizeCanvasHost(row.domain);
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ name: String(row.name).trim(), host, account_id: Number.isFinite(row.id) ? row.id : null });
    if (out.length >= limit) break;
  }
  return out;
}

export function schoolProfilePath(root = resolveUserRoot()) {
  return path.join(root, "school", "profile.json");
}

export function readSchoolProfile(root = resolveUserRoot()) {
  const file = schoolProfilePath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && data.canvas_host ? data : null;
  } catch {
    return null;
  }
}

export function writeSchoolProfile(profile, root = resolveUserRoot()) {
  const file = schoolProfilePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

/**
 * The record onboarding saves when the student picks (or pastes) their school.
 * `curatedSlug` comes from `findCuratedSlugForHost` when a reviewed yaml exists.
 */
export function buildSchoolProfile({ host, name, accountId = null, source = "instructure-search", curatedSlug = "" }, now = new Date()) {
  const canvasHost = normalizeCanvasHost(host);
  return {
    version: PROFILE_VERSION,
    slug: curatedSlug || hostSlug(canvasHost),
    display_name: String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || canvasHost,
    canvas_host: canvasHost,
    canvas_base_url: `https://${canvasHost}`,
    instructure_account_id: accountId,
    source,
    chosen_at: now.toISOString(),
    discovered: {},
  };
}

/** Pick the current term: the most recent start that has not ended. */
export function currentTerm(courses, now = new Date()) {
  const t = now.getTime();
  const terms = [];
  for (const c of courses || []) {
    const term = c && c.term;
    if (!term || !term.start_at) continue;
    const start = Date.parse(term.start_at);
    const end = term.end_at ? Date.parse(term.end_at) : NaN;
    if (Number.isNaN(start)) continue;
    terms.push({ name: String(term.name || ""), start_at: term.start_at, end_at: term.end_at || null, start, end });
  }
  const live = terms.filter((x) => x.start <= t && (Number.isNaN(x.end) || x.end >= t));
  const pool = live.length ? live : terms;
  pool.sort((a, b) => b.start - a.start);
  const pick = pool[0];
  return pick ? { name: pick.name, start_at: pick.start_at, end_at: pick.end_at } : null;
}

/** Most common course time zone, else the student's profile zone. */
export function dominantTimeZone(courses, profileZone = "") {
  const counts = new Map();
  for (const c of courses || []) {
    const z = c && typeof c.time_zone === "string" ? c.time_zone.trim() : "";
    if (z) counts.set(z, (counts.get(z) || 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [z, k] of counts) if (k > n) [best, n] = [z, k];
  return best || String(profileZone || "").trim();
}

/**
 * Fill `profile.discovered` from Canvas. `getJson(pathAndQuery)` is an authenticated
 * GET on the student's own session (canvas-session `api(page, ...)`); `fetchPublic(url)`
 * fetches the unauthenticated brand file. Every lookup is best-effort.
 */
export async function enrichFromCanvas(profile, { getJson, fetchPublic = globalThis.fetch, now = new Date() }) {
  const discovered = { ...(profile.discovered || {}) };
  let courses = [];
  try {
    courses = await getJson("/api/v1/courses?enrollment_state=active&include[]=term&per_page=50");
  } catch {
    courses = [];
  }
  let selfProfile = {};
  try {
    selfProfile = await getJson("/api/v1/users/self/profile");
  } catch {
    selfProfile = {};
  }
  const zone = dominantTimeZone(courses, selfProfile && selfProfile.time_zone);
  if (zone) discovered.timezone = zone;
  const term = currentTerm(courses, now);
  if (term) discovered.term = term;
  try {
    const res = await fetchPublic(`${profile.canvas_base_url}/api/v1/brand_variables`, { redirect: "follow" });
    if (res.ok) {
      const brand = await res.json();
      const primary = brand["ic-brand-button--primary-bgd"] || brand["ic-brand-primary"];
      if (typeof primary === "string" && /^#[0-9a-f]{3,8}$/i.test(primary)) discovered.brand_color = primary;
    }
  } catch {
    /* brand color is decoration; skip quietly */
  }
  discovered.checked_at = now.toISOString();
  return { ...profile, discovered };
}
