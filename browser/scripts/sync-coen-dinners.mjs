// Purpose: runs the dinner events sync
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentCampusGroupsAllowed } from './lib/school-gate.mjs';
if (!currentCampusGroupsAllowed()) {
  console.error('CampusGroups runs only when the school is cu-boulder. Refusing before a browser or account call.');
  process.exit(2);
}
const plugin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'cu-boulder-campusgroups', 'sync-coen-dinners.mjs');
const child = spawn(process.execPath, [plugin, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
child.on('exit', (c) => process.exit(c ?? 1));
