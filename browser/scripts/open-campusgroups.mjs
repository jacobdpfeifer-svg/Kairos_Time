// Purpose: runs the campus groups opener
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const plugin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'cu-boulder-campusgroups', 'open-campusgroups.mjs');
const child = spawn(process.execPath, [plugin, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (c) => process.exit(c ?? 1));
