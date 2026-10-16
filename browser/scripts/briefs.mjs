/**
 * Rebuild the Mission Control brief projection from what's already on disk
 * (no Canvas session, no network): `npm run briefs`.
 * Prints one JSON line: { ok, islands, briefs, rest } or { ok, skipped }.
 */
import { resolveUserRoot } from "./lib/user-root.mjs";
import { writeBriefProjection } from "./lib/briefs/project.mjs";

const userRoot = resolveUserRoot({ create: true });
try {
  console.log(JSON.stringify(writeBriefProjection(userRoot)));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 200) }));
  process.exitCode = 1;
}
