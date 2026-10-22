/**
 * Project the authored workspace catalog into the JSON the app and Rust share.
 *
 *   node tools/emit-workspace-catalog.mjs
 *   node tools/emit-workspace-catalog.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_CAPABILITIES, WORKSPACE_TEMPLATES } from "../browser/scripts/lib/workspace/catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "app/src/workspace/catalog.json");
const body = `${JSON.stringify({ capabilities: WORKSPACE_CAPABILITIES, templates: WORKSPACE_TEMPLATES }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== body) {
    console.error("app/src/workspace/catalog.json does not match browser/scripts/lib/workspace/catalog.mjs");
    console.error("Run: node tools/emit-workspace-catalog.mjs");
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
}
