/**
 * Direct `node plugins/cu-boulder-campusgroups/<cli>.mjs` must hit the same
 * school gate as the browser/scripts shims. Importing this file does nothing;
 * the caller passes its own module URL and we refuse only when that file is
 * the process entry.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentCampusGroupsAllowed } from "../../browser/scripts/lib/school-gate.mjs";

export function refuseDirectCampusGroups(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return;
  let here = "";
  try {
    here = fileURLToPath(metaUrl);
  } catch {
    return;
  }
  if (path.resolve(entry) !== here) return;
  if (!currentCampusGroupsAllowed()) {
    console.error("CampusGroups runs only when the school is cu-boulder. Refusing before a browser or account call.");
    process.exit(2);
  }
}
