/**
 * Study-source adapter. Never starts a second Canvas fetch when a fresh
 * canonical generation already exists. A generation past the soft-stale
 * window is fetched again: re-projecting it would only yield a stale health
 * state, which onboarding (correctly) refuses to treat as a finished sync.
 */
import { resolveUserRoot } from "./lib/user-root.mjs";
import { readCurrentRaw } from "./lib/canvas-store.mjs";
import { SOFT_STALE_MS } from "./lib/canvas-model.mjs";

const userRoot = resolveUserRoot({ create: true, announce: false });
const finishedAt = Date.parse(readCurrentRaw(userRoot)?.generation?.manifest?.finished_at || "");
if (Number.isFinite(finishedAt) && Date.now() - finishedAt <= SOFT_STALE_MS) {
  process.env.CANVAS_ADAPTERS_ONLY = "1";
}
await import("./sync-canvas-canonical.mjs");
