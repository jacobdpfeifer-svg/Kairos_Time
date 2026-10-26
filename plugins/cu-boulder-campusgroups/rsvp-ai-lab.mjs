/**
 * RSVP to a COEN AI Lab workshop slot.
 * Reads {user_root}/calibration/signup-preferences.md and inbox/coen-ai-labs.md.
 *
 * Usage:
 *   npm run rsvp-ai-lab -- --slot "Wed 2pm" --name "Student Name"                    # preview, no browser
 *   npm run rsvp-ai-lab -- --slot "Wed 2pm" --name "Student Name" --expect 123456 --confirm
 *   npm run rsvp-ai-lab -- --event 123456 --name "Student Name" --confirm
 *
 * Slot matching needs --expect <id> from the preview so the workshop booked is
 * the one the student saw. With an explicit --event, the id is already pinned.
 * Set DEV_USER_ROOT to point at the product user root (calibration + inbox).
 * --confirm is required: RSVP is visible to the event organizer (pivot exception
 * for this CLI escape hatch only — not an MCP tool).
 */
import fs from "node:fs";
import { refuseDirectCampusGroups } from "./require-school.mjs";
import {
  COEN_AI_LABS_PATH,
  SIGNUP_PREFS_PATH,
  dropPastRows,
  runRsvpCli,
  schoolLocalDay,
  shellQuote,
} from "./campusgroups-session.mjs";

refuseDirectCampusGroups(import.meta.url);

function parseArgs(argv) {
  const args = {
    slot: null,
    event: null,
    verify: true,
    name: "",
    log: true,
    confirm: false,
    expect: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slot" && argv[i + 1]) args.slot = argv[++i];
    else if (a === "--event" && argv[i + 1]) args.event = argv[++i];
    else if (a === "--name" && argv[i + 1]) args.name = argv[++i];
    else if (a === "--expect" && argv[i + 1]) args.expect = argv[++i];
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--no-log") args.log = false;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--headed") process.env.HEADLESS = "0";
  }
  return args;
}

function parseAiLabPreferences(md) {
  const prefs = { status: "unconfirmed", preferredSlot: "" };
  const block = String(md || "").match(/## AI Lab workshop[\s\S]*?(?=##|$)/i);
  if (!block) return prefs;
  const status = block[0].match(/\*\*Status:\*\*\s*(\w+)/i);
  if (status) prefs.status = status[1].toLowerCase();
  const slot = block[0].match(/\*\*Preferred slot:\*\*\s*(.+)/i);
  if (slot) prefs.preferredSlot = slot[1].trim();
  return prefs;
}

function parseAiLabsTable(md) {
  const rows = [];
  for (const line of String(md || "").split("\n")) {
    if (!line.startsWith("|") || /^\|\s*Date\s*\|/i.test(line) || /^[-| ]+$/.test(line)) continue;
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 5) continue;
    const [date, time, workshop, rsvpId, cglink] = cols;
    if (!rsvpId || !/^\d+$/.test(rsvpId)) continue;
    rows.push({ date, time, workshop, rsvpId, cglink });
  }
  return rows;
}

function resolveAiLabRows({ slot, prefs }) {
  let md = "";
  try {
    md = fs.readFileSync(COEN_AI_LABS_PATH, "utf8");
  } catch {
    throw new Error(`Missing ${COEN_AI_LABS_PATH} — run: cd browser && npm run sync-ai-labs`);
  }

  const rows = dropPastRows(parseAiLabsTable(md), schoolLocalDay());
  if (!rows.length) {
    throw new Error("No upcoming AI lab rows in coen-ai-labs.md — run npm run sync-ai-labs");
  }

  const needle = (slot || prefs.preferredSlot || "").toLowerCase();
  if (!needle) {
    throw new Error(
      "No workshop slot specified — pass --slot (e.g. --slot \"Wed 2pm\") or --event, or set Preferred slot in calibration/signup-preferences.md"
    );
  }

  const matches = rows.filter(
    (r) =>
      `${r.date} ${r.time} ${r.workshop}`.toLowerCase().includes(needle) ||
      r.workshop.toLowerCase().includes(needle) ||
      r.time.toLowerCase().includes(needle)
  );
  if (!matches.length) {
    throw new Error(`No upcoming AI lab matches slot="${needle}" — check inbox/coen-ai-labs.md`);
  }
  return matches;
}

function labelOf(r) {
  return `AI Lab ${r.date} ${r.time} — ${r.workshop}`;
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, outcome: "not_attempted", message }, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv);
if (!args.name.trim()) {
  console.error(
    'Usage: npm run rsvp-ai-lab -- --name "Student Name" [--slot ... | --event <id>] [--expect <id> --confirm]'
  );
  process.exit(1);
}

let prefs = { status: "unconfirmed", preferredSlot: "" };
try {
  prefs = parseAiLabPreferences(fs.readFileSync(SIGNUP_PREFS_PATH, "utf8"));
} catch {
  console.warn(`Warning: ${SIGNUP_PREFS_PATH} not found`);
}

// An explicit --slot is the student's choice for this run; only the saved
// preference needs Status: confirmed before it can stand in for one.
if (!args.event && !args.slot && prefs.status !== "confirmed") {
  fail(
    "No --slot or --event given and the AI Lab preference isn't confirmed. Pass --slot (e.g. --slot \"Wed 2pm\"), " +
      "or set Status: confirmed and Preferred slot in calibration/signup-preferences.md."
  );
}

let row;
let alternatives = [];
let base;
if (args.event) {
  row = { rsvpId: String(args.event), label: `AI Lab event ${args.event}` };
  base = `npm run rsvp-ai-lab -- --name ${shellQuote(args.name)} --event ${shellQuote(args.event)}`;
} else {
  let matches;
  try {
    matches = resolveAiLabRows({ slot: args.slot, prefs });
  } catch (e) {
    fail(String(e.message || e));
  }
  const [first, ...rest] = matches;
  row = { ...first, label: labelOf(first) };
  base =
    `npm run rsvp-ai-lab -- --name ${shellQuote(args.name)}` +
    (args.slot ? ` --slot ${shellQuote(args.slot)}` : "");
  // Picking an alternative = confirm it by its own event id.
  alternatives = rest.map((r) => ({
    eventId: r.rsvpId,
    label: labelOf(r),
    previewWith: `npm run rsvp-ai-lab -- --name ${shellQuote(args.name)} --event ${r.rsvpId}`,
  }));
}

const { result, exitCode } = await runRsvpCli({
  eventId: row.rsvpId,
  studentName: args.name,
  verify: args.verify,
  confirm: args.confirm,
  expect: args.expect,
  // --event is explicit on the command line; slot matching must be pinned by --expect.
  expectRequired: !args.event,
  event: { label: row.label, ...(row.date ? { date: row.date, time: row.time } : {}) },
  alternatives,
  previewCommand: base,
  confirmCommand: args.event ? `${base} --confirm` : `${base} --expect ${row.rsvpId} --confirm`,
  log: args.log,
});

console.log(JSON.stringify(result, null, 2));
process.exit(exitCode);
