/**
 * RSVP to a COEN major dinner by major alias + date.
 * Reads {user_root}/calibration/signup-preferences.md and inbox/coen-major-dinners.md.
 *
 * Usage:
 *   npm run rsvp-dinner -- --major cs --name "Student Name"                       # preview, no browser
 *   npm run rsvp-dinner -- --major cs --name "Student Name" --expect 385793 --confirm
 *
 * The preview prints the exact confirm command. --confirm requires --expect <id>
 * from that preview, so the dinner booked is the dinner the student saw — if
 * the schedule re-synced or prefs changed in between, the run is refused.
 *
 * Set DEV_USER_ROOT to point at the product user root (calibration + inbox).
 * --confirm is required: RSVP is visible to the event organizer (pivot exception
 * for this CLI escape hatch only — not an MCP tool).
 */
import fs from "node:fs";
import { refuseDirectCampusGroups } from "./require-school.mjs";
import {
  COEN_MAJOR_DINNERS_PATH,
  SIGNUP_PREFS_PATH,
  dropPastRows,
  majorMatches,
  parseMajorDinnersTable,
  parseSignupPreferences,
  runRsvpCli,
  schoolLocalDay,
  shellQuote,
} from "./campusgroups-session.mjs";

refuseDirectCampusGroups(import.meta.url);

function parseArgs(argv) {
  const args = {
    major: null,
    date: null,
    verify: true,
    name: "",
    log: true,
    confirm: false,
    expect: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--major" && argv[i + 1]) args.major = argv[++i];
    else if (a === "--date" && argv[i + 1]) args.date = argv[++i];
    else if (a === "--name" && argv[i + 1]) args.name = argv[++i];
    else if (a === "--expect" && argv[i + 1]) args.expect = argv[++i];
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--no-log") args.log = false;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--headed") process.env.HEADLESS = "0";
  }
  return args;
}

function resolveDinnerRows({ major, date }) {
  let md = "";
  try {
    md = fs.readFileSync(COEN_MAJOR_DINNERS_PATH, "utf8");
  } catch {
    throw new Error(
      `Missing ${COEN_MAJOR_DINNERS_PATH} — run: cd browser && npm run sync-dinners`
    );
  }

  const rows = parseMajorDinnersTable(md);
  if (!rows.length) {
    throw new Error("No dinner rows in coen-major-dinners.md — run npm run sync-dinners");
  }

  let candidates = dropPastRows(
    rows.filter((r) => majorMatches(r.major, major)),
    schoolLocalDay()
  );
  if (date) {
    candidates = candidates.filter((r) => r.date === date || r.date.startsWith(date));
  }
  if (!candidates.length) {
    throw new Error(
      `No upcoming dinner for major=${major} date=${date || "any"} — check inbox/coen-major-dinners.md or run npm run sync-dinners`
    );
  }
  return candidates;
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, outcome: "not_attempted", message }, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv);
if (!args.name.trim()) {
  console.error(
    'Usage: npm run rsvp-dinner -- --name "Student Name" [--major ...] [--date ...] [--expect <id> --confirm]'
  );
  process.exit(1);
}

let prefs = { majorDinnerDefault: "Computer Science", majorDinnerStatus: "unconfirmed" };
try {
  prefs = parseSignupPreferences(fs.readFileSync(SIGNUP_PREFS_PATH, "utf8"));
} catch {
  console.warn(`Warning: ${SIGNUP_PREFS_PATH} not found — using defaults`);
}

if (!args.major) {
  if (prefs.majorDinnerStatus !== "confirmed") {
    fail(
      `No --major given and the major-dinner preference isn't confirmed. Pass --major (e.g. --major cs), ` +
        `or set Status: confirmed in calibration/signup-preferences.md (default would be ${prefs.majorDinnerDefault}).`
    );
  }
  args.major = prefs.majorDinnerDefault;
}

let candidates;
try {
  candidates = resolveDinnerRows({ major: args.major, date: args.date });
} catch (e) {
  fail(String(e.message || e));
}

const [row, ...rest] = candidates;
const label = `${row.major} ${row.date} slot ${row.slot}`;
const base =
  `npm run rsvp-dinner -- --name ${shellQuote(args.name)} --major ${shellQuote(args.major)}` +
  (args.date ? ` --date ${shellQuote(args.date)}` : "");
// Picking an alternative = re-preview with its exact date.
const alternatives = rest.map((r) => ({
  eventId: r.rsvpId,
  label: `${r.major} ${r.date} slot ${r.slot}`,
  previewWith: `npm run rsvp-dinner -- --name ${shellQuote(args.name)} --major ${shellQuote(args.major)} --date ${shellQuote(r.date)}`,
}));

const { result, exitCode } = await runRsvpCli({
  eventId: row.rsvpId,
  studentName: args.name,
  verify: args.verify,
  confirm: args.confirm,
  expect: args.expect,
  expectRequired: true,
  event: { label, major: row.major, date: row.date, slot: row.slot },
  alternatives,
  previewCommand: base,
  confirmCommand: `${base} --expect ${row.rsvpId} --confirm`,
  log: args.log,
});

console.log(JSON.stringify(result, null, 2));
process.exit(exitCode);
