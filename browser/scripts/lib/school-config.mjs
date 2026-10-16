/**
 * Load the student's school config for browser SSO scripts.
 *
 * Resolution (docs/architecture/school-personalization.md):
 *   1. SCHOOL_SLUG env naming a curated schools/{slug}.yaml (dev, tests, plugins)
 *   2. the school the student chose at onboarding ({user_root}/school/profile.json),
 *      with any curated yaml whose canvas_base_url host matches layered on top
 *   3. otherwise an error: no school is ever assumed.
 * Prefer SCHOOLS_DIR override for tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCanvasHost, readSchoolProfile } from "./school-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function schoolsDir() {
  return process.env.SCHOOLS_DIR || path.join(REPO_ROOT, "schools");
}

/** Minimal YAML subset parser for our school files (no nested lists of maps beyond course_file_map). */
function parseSchoolYaml(text) {
  const lines = text.split(/\r?\n/);
  const out = {
    slug: "",
    display_name: "",
    canvas_base_url: "",
    sso_idp: "",
    timezone: "UTC",
    term_dates: {},
    lti_catalog: [],
    engagement_platform: null,
    course_file_map: [],
    grade_scale: {},
    policy_links: {},
  };
  let section = null;
  let currentMap = null;
  let engagement = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    if (indent === 0 && line.endsWith(":") && !line.includes(" ")) {
      section = line.slice(0, -1);
      currentMap = null;
      if (section === "engagement_platform") engagement = {};
      if (section === "course_file_map") out.course_file_map = [];
      if (section === "term_dates") out.term_dates = {};
      if (section === "lti_catalog") out.lti_catalog = [];
      if (section === "grade_scale") out.grade_scale = {};
      if (section === "policy_links") out.policy_links = {};
      continue;
    }

    if (section === "course_file_map" && line.startsWith("- code:")) {
      currentMap = { code: line.replace("- code:", "").trim(), patterns: [] };
      out.course_file_map.push(currentMap);
      continue;
    }
    if (section === "course_file_map" && currentMap && line.startsWith("patterns:")) {
      continue;
    }
    if (section === "course_file_map" && currentMap && line.startsWith("- ")) {
      const pat = line.slice(2).replace(/^["']|["']$/g, "");
      currentMap.patterns.push(pat);
      continue;
    }

    if (section === "lti_catalog" && line.startsWith("- ")) {
      out.lti_catalog.push(line.slice(2).trim());
      continue;
    }

    if (section === "term_dates" && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      out.term_dates[k.trim()] = rest.join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }

    if (section === "grade_scale" && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      const raw = rest.join(":").trim().replace(/^["']|["']$/g, "");
      const n = Number(raw);
      if (Number.isFinite(n)) out.grade_scale[k.trim()] = n;
      continue;
    }

    if (section === "policy_links" && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim().replace(/^["']|["']$/g, "");
      if (v) out.policy_links[k.trim()] = v;
      continue;
    }

    if (section === "engagement_platform" && engagement && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim().replace(/^["']|["']$/g, "");
      if (v === "null") engagement[k.trim()] = null;
      else engagement[k.trim()] = v;
      continue;
    }

    if (indent === 0 && line.includes(":")) {
      section = null;
      const [k, ...rest] = line.split(":");
      const key = k.trim();
      let v = rest.join(":").trim().replace(/^["']|["']$/g, "");
      if (v === "null") v = null;
      out[key] = v;
    }
  }
  if (engagement && engagement.host) out.engagement_platform = engagement;
  return out;
}

let _cached = null;

/** Slugs are file stems under schools/; refuse anything that could name another path. */
const SLUG = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/;

function yamlPath(slug) {
  if (!SLUG.test(String(slug || ""))) throw new Error(`Invalid school slug: ${JSON.stringify(slug)}`);
  return path.join(schoolsDir(), `${slug}.yaml`);
}

function loadYaml(slug) {
  if (!slug || slug.startsWith("_") || !SLUG.test(String(slug))) return null;
  const file = yamlPath(slug);
  if (!fs.existsSync(file)) return null;
  return parseSchoolYaml(fs.readFileSync(file, "utf8"));
}

/** Curated yaml slug whose canvas_base_url host matches, or "". */
export function findCuratedSlugForHost(host) {
  let want;
  try {
    want = normalizeCanvasHost(host);
  } catch {
    return "";
  }
  const dir = schoolsDir();
  if (!fs.existsSync(dir)) return "";
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".yaml") || name.startsWith("_")) continue;
    const raw = parseSchoolYaml(fs.readFileSync(path.join(dir, name), "utf8"));
    try {
      if (raw.canvas_base_url && normalizeCanvasHost(raw.canvas_base_url) === want) return name.replace(/\.yaml$/, "");
    } catch {
      /* malformed curated file: ignore for matching */
    }
  }
  return "";
}

/** Slug in effect: explicit env, else the school the student chose. Never a default school. */
export function getSchoolSlug() {
  const env = (process.env.SCHOOL_SLUG || "").trim();
  if (env && env !== "waitlist") return env;
  const profile = readSchoolProfile();
  return profile ? String(profile.slug || "") : "";
}

/** Generic defaults every school starts from (US 4.0 scale, common LTI tools, legal notice). */
function baseDefaults() {
  const file = yamlPath("_template");
  const tpl = parseSchoolYaml(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  return {
    timezone: "UTC",
    term_dates: {},
    lti_catalog: tpl.lti_catalog || [],
    engagement_platform: null,
    course_file_map: [],
    grade_scale: tpl.grade_scale || {},
    policy_links: {},
    legal_notice: tpl.legal_notice || "",
    sso_idp: "",
  };
}

/** Build a config from the onboarding profile, overlaying a curated yaml when one matches. */
export function configFromProfile(profile) {
  const curatedSlug = findCuratedSlugForHost(profile.canvas_host);
  const curated = curatedSlug ? loadYaml(curatedSlug) : null;
  const found = profile.discovered || {};
  const out = {
    ...baseDefaults(),
    ...(curated || {}),
    slug: curatedSlug || profile.slug,
    display_name: (curated && curated.display_name) || profile.display_name,
    canvas_base_url: `https://${normalizeCanvasHost(profile.canvas_host)}`,
    discovered: found,
  };
  // Canvas is the source of truth for time zone and term when the curated file does not pin them.
  if (found.timezone && (!curated || !curated.timezone || curated.timezone === "UTC")) out.timezone = found.timezone;
  if (found.term && !(curated && curated.term_dates && Object.keys(curated.term_dates).length)) {
    out.term_dates = { current_name: found.term.name, current_start: found.term.start_at, current_end: found.term.end_at || "" };
  }
  return out;
}

function finalize(raw) {
  if (!raw.canvas_base_url) {
    throw new Error(`School config missing canvas_base_url: ${raw.slug}`);
  }
  raw.canvas_base_url = String(raw.canvas_base_url).replace(/\/$/, "");
  raw.course_file_map = (raw.course_file_map || []).map((e) => ({
    code: e.code,
    patterns: (e.patterns || []).map((p) => (p instanceof RegExp ? p : new RegExp(p, "i"))),
  }));
  return raw;
}

export function getSchoolConfig(slug = getSchoolSlug()) {
  if (_cached && _cached.slug === slug) return _cached;
  const curated = loadYaml(slug);
  if (curated) {
    _cached = finalize({ ...curated, slug: curated.slug || slug });
    return _cached;
  }
  const profile = readSchoolProfile();
  if (profile) {
    _cached = finalize(configFromProfile(profile));
    return _cached;
  }
  throw new Error(
    slug
      ? `Unknown school: ${slug}. Finish onboarding (pick your school) or add schools/${slug}.yaml.`
      : "No school chosen yet. Finish onboarding to pick your school."
  );
}

export function clearSchoolConfigCache() {
  _cached = null;
}

export function schoolDay(d = new Date(), timezone) {
  const tz = timezone || getSchoolConfig().timezone || "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
