/**
 * Rebuild inbox/work-state/v1 from local artifacts. No network.
 * Usage: node scripts/rebuild-work-state.mjs --user-root <path>
 */
import { rebuildWorkState } from "./lib/work-state.mjs";

const arg = process.argv.indexOf("--user-root");
const userRoot = arg >= 0 ? process.argv[arg + 1] : "";
if (!userRoot) {
  console.error("usage: rebuild-work-state.mjs --user-root <path>");
  process.exit(2);
}

const result = rebuildWorkState(userRoot);
console.log(JSON.stringify({
  ok: Boolean(result.ok),
  unchanged: Boolean(result.unchanged),
  generation_id: result.generation_id || null,
  coverage: result.coverage || null,
  reason: result.reason || null,
}));
if (!result.ok && !result.busy) process.exit(1);
