/**
 * One freshness tick: classify queued extension deltas, poll due feeds,
 * rebuild inbox/freshness/dashboard.json. No Canvas session needed.
 *
 *   node scripts/freshness-tick.mjs              # once (the Tauri daemon calls this)
 *   node scripts/freshness-tick.mjs --loop 120   # keep going (no desktop app)
 *   node scripts/freshness-tick.mjs --force-feeds
 *
 * Prints one JSON line per tick: { ok, new_events, briefs_changed, deltas_processed, feeds_polled, ... }.
 */
import { resolveUserRoot } from "./lib/user-root.mjs";
import { runFreshnessTick } from "./lib/freshness-run.mjs";

const args = process.argv.slice(2);
const loopIdx = args.indexOf("--loop");
const loopSeconds = loopIdx >= 0 ? Math.max(60, Number(args[loopIdx + 1]) || 120) : 0;
const forceFeeds = args.includes("--force-feeds");
const userRoot = resolveUserRoot({ create: true });

async function once() {
  try {
    const result = await runFreshnessTick({ userRoot, forceFeeds });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 200) }));
    if (!loopSeconds) process.exitCode = 1;
  }
}

await once();
while (loopSeconds) {
  await new Promise((resolve) => setTimeout(resolve, loopSeconds * 1000));
  await once();
}
