/**
 * RSVP to a CampusGroups event via Playwright (shared .auth SSO).
 *
 * Usage:
 *   npm run rsvp-campusgroups -- --event 385793 --name "Student Name"            # preview, no browser
 *   npm run rsvp-campusgroups -- --event 385793 --name "Student Name" --confirm  # register
 *
 * Student-operated escape hatch (plugins/README.md): RSVPing is visible to the
 * event organizer, so --confirm must be passed explicitly by whoever runs this
 * — it is not inferred from --event/--name alone, so an agent cannot fire it
 * on the student's behalf without a deliberate, extra signal from the student.
 * The event id is on the command line, so the preview and the confirm run can't
 * drift apart; --expect is not required here.
 */
import { runRsvpCli, shellQuote } from "./campusgroups-session.mjs";
import { refuseDirectCampusGroups } from "./require-school.mjs";

refuseDirectCampusGroups(import.meta.url);

function parseArgs(argv) {
  const args = { event: null, verify: true, name: "", log: false, confirm: false, expect: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--event" && argv[i + 1]) args.event = argv[++i];
    else if (a === "--name" && argv[i + 1]) args.name = argv[++i];
    else if (a === "--expect" && argv[i + 1]) args.expect = argv[++i];
    else if (a === "--verify") args.verify = true;
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--log") args.log = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--headed") process.env.HEADLESS = "0";
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.event || !args.name.trim()) {
  console.error(
    'Usage: npm run rsvp-campusgroups -- --event <id> --name "Student Name" [--confirm] [--log]'
  );
  process.exit(1);
}

const base = `npm run rsvp-campusgroups -- --event ${shellQuote(args.event)} --name ${shellQuote(args.name)}${args.log ? " --log" : ""}`;
const { result, exitCode } = await runRsvpCli({
  eventId: String(args.event),
  studentName: args.name,
  verify: args.verify,
  confirm: args.confirm,
  expect: args.expect,
  expectRequired: false,
  event: { label: `CampusGroups event ${args.event}` },
  previewCommand: base,
  confirmCommand: `${base} --confirm`,
  log: args.log,
});

console.log(JSON.stringify(result, null, 2));
process.exit(exitCode);
