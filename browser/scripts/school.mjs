/**
 * School discovery CLI used by the desktop app (docs/architecture/school-personalization.md).
 *
 *   node scripts/school.mjs search "ohio state"     -> {"schools":[{name,host,account_id}]}
 *   node scripts/school.mjs choose --host osu.instructure.com --name "Ohio State" [--account-id 132008] [--source manual]
 *   node scripts/school.mjs enrich                  -> reads timezone/term/brand from Canvas (needs SSO session)
 *   node scripts/school.mjs show                    -> the resolved school config
 *
 * Always prints one JSON object on stdout. Search is a public Instructure lookup;
 * enrich uses only GETs on the student's own Canvas session.
 */
import {
  buildSchoolProfile,
  enrichFromCanvas,
  readSchoolProfile,
  searchSchools,
  writeSchoolProfile,
} from "./lib/school-discovery.mjs";
import { clearSchoolConfigCache, findCuratedSlugForHost, getSchoolConfig } from "./lib/school-config.mjs";

/**
 * `--flag value` pairs after the subcommand, read left to right. A value is
 * never re-read as a flag, so a school name such as "--account-id" cannot
 * shadow a real option (indexOf would find the value first).
 */
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (typeof key !== "string" || !key.startsWith("--")) break;
    if (!(key.slice(2) in flags)) flags[key.slice(2)] = argv[i + 1];
  }
  return flags;
}
const FLAGS = parseFlags(process.argv.slice(3));

function arg(name) {
  return Object.hasOwn(FLAGS, name) ? FLAGS[name] : undefined;
}

function out(obj, code = 0) {
  console.log(JSON.stringify(obj));
  process.exit(code);
}

const cmd = process.argv[2];
try {
  if (cmd === "search") {
    out({ schools: await searchSchools(process.argv.slice(3).join(" ")) });
  } else if (cmd === "choose") {
    const host = arg("host");
    const curatedSlug = findCuratedSlugForHost(host);
    const profile = buildSchoolProfile({
      host,
      name: arg("name"),
      accountId: arg("account-id") ? Number(arg("account-id")) : null,
      source: arg("source") === "manual" ? "manual" : "instructure-search",
      curatedSlug,
    });
    const file = writeSchoolProfile(profile);
    out({ ok: true, profile, file });
  } else if (cmd === "enrich") {
    const profile = readSchoolProfile();
    if (!profile) out({ ok: false, error: "No school chosen yet." }, 1);
    const { launchCanvasContext, requireLoggedIn, api } = await import("./lib/canvas-session.mjs");
    const { context, page } = await launchCanvasContext({ headless: true });
    try {
      await requireLoggedIn(page);
      const next = await enrichFromCanvas(profile, { getJson: (p) => api(page, p) });
      writeSchoolProfile(next);
      out({ ok: true, discovered: next.discovered });
    } finally {
      await context.close();
    }
  } else if (cmd === "show") {
    clearSchoolConfigCache();
    const cfg = getSchoolConfig();
    out({ ok: true, school: { ...cfg, course_file_map: undefined } });
  } else {
    out({ ok: false, error: "usage: school.mjs search|choose|enrich|show" }, 2);
  }
} catch (e) {
  out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 1);
}
