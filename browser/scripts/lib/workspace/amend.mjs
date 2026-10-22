/**
 * Local amendment proposals. No I/O, no network, no model.
 * Block order is the compiler's `byCapabilityWeight`.
 *
 * Architecture: docs/handoff/generative-workspace-architecture-2026-10-21.md §7.
 */
import { WORKSPACE_CAPABILITIES } from "./catalog.mjs";
import { byCapabilityWeight } from "./compile.mjs";

export { byCapabilityWeight };

export const AMENDMENT_KINDS = Object.freeze(["home", "narrow_interrupts", "remove_unused", "reorder"]);

const SURFACES = Object.freeze(["today", "week", "courses", "study", "advisor"]);
const SURFACE_LABEL = Object.freeze({
  today: "Today",
  week: "Week",
  courses: "Courses",
  study: "Study",
  advisor: "Advisor",
});
const INTERRUPTS = Object.freeze(["due_moved", "high_stakes_48h", "sync_broken"]);
const USAGE_KEYS = new Set(["schema_version", "surfaces", "days", "blocks"]);
const SURFACE_KEYS = new Set(["opens", "first_of_day", "dwell_seconds"]);
const DAY_KEYS = new Set(["date", "first_surface"]);
const BLOCK_KEYS = new Set(["expansions", "last_seen"]);
const LEDGER_KEYS = new Set(["schema_version", "pending", "last_proposed_on", "dismissed", "stopped_kinds"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_ID = /^[a-z][a-z0-9_]{0,31}$/;
const FINGERPRINT = /^[a-z0-9_.:]{1,96}$/;

function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function shift(iso, delta) {
  const n = dayNumber(iso);
  if (n === null) return null;
  const dt = new Date((n + delta) * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey(now) {
  if (typeof now === "string" && DATE.test(now)) return dayNumber(now) === null ? null : now;
  const date = now instanceof Date ? now : typeof now === "string" ? new Date(now) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  return dayNumber(iso) === null ? null : iso;
}

function onlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function whole(value, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function usageTrusted(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  if (!onlyKeys(usage, USAGE_KEYS)) return null;
  if (usage.schema_version !== 1) return null;
  if (!usage.surfaces || typeof usage.surfaces !== "object" || Array.isArray(usage.surfaces)) return null;
  if (!Array.isArray(usage.days) || usage.days.length > 21) return null;
  if (!usage.blocks || typeof usage.blocks !== "object" || Array.isArray(usage.blocks)) return null;

  for (const [name, entry] of Object.entries(usage.surfaces)) {
    if (!SURFACES.includes(name) || !entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (!onlyKeys(entry, SURFACE_KEYS)) return null;
    if (!whole(entry.opens, 100_000) || !whole(entry.first_of_day, 100_000) || !whole(entry.dwell_seconds, 21 * 8 * 3600)) return null;
  }
  const seen = new Set();
  for (const day of usage.days) {
    if (!day || typeof day !== "object" || Array.isArray(day) || !onlyKeys(day, DAY_KEYS)) return null;
    if (typeof day.date !== "string" || !DATE.test(day.date) || dayNumber(day.date) === null) return null;
    if (!SURFACES.includes(day.first_surface) || seen.has(day.date)) return null;
    seen.add(day.date);
  }
  for (const [id, entry] of Object.entries(usage.blocks)) {
    if (!BLOCK_ID.test(id) || !entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (!onlyKeys(entry, BLOCK_KEYS)) return null;
    if (!whole(entry.expansions, 100_000)) return null;
    if (typeof entry.last_seen !== "string" || !DATE.test(entry.last_seen) || dayNumber(entry.last_seen) === null) return null;
  }
  return usage;
}

function ledgerTrusted(ledger) {
  if (ledger == null) {
    return { pending: null, last_proposed_on: null, dismissed: [], stopped_kinds: [] };
  }
  if (typeof ledger !== "object" || Array.isArray(ledger) || !onlyKeys(ledger, LEDGER_KEYS)) return null;
  if (ledger.schema_version !== undefined && ledger.schema_version !== 1) return null;
  if (ledger.pending !== undefined && ledger.pending !== null && (typeof ledger.pending !== "object" || Array.isArray(ledger.pending))) return null;
  if (ledger.last_proposed_on != null && (typeof ledger.last_proposed_on !== "string" || dayNumber(ledger.last_proposed_on) === null)) return null;
  if (ledger.dismissed !== undefined && !Array.isArray(ledger.dismissed)) return null;
  if (ledger.stopped_kinds !== undefined && !Array.isArray(ledger.stopped_kinds)) return null;
  const dismissed = ledger.dismissed ?? [];
  const stopped = ledger.stopped_kinds ?? [];
  if (dismissed.some((item) => typeof item !== "string" || !FINGERPRINT.test(item))) return null;
  if (stopped.some((item) => !AMENDMENT_KINDS.includes(item))) return null;
  return {
    pending: ledger.pending ?? null,
    last_proposed_on: ledger.last_proposed_on ?? null,
    dismissed,
    stopped_kinds: stopped,
  };
}

function specTrusted(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  if (!spec.blocks || typeof spec.blocks !== "object" || Array.isArray(spec.blocks)) return null;
  if (!spec.surfaces || typeof spec.surfaces !== "object" || Array.isArray(spec.surfaces)) return null;
  if (spec.home !== undefined && !SURFACES.includes(spec.home)) return null;
  const interrupts = spec.quiet?.interrupt_for;
  if (interrupts !== undefined) {
    if (!Array.isArray(interrupts) || interrupts.some((kind) => !INTERRUPTS.includes(kind))) return null;
  }
  return spec;
}

function sortedDays(usage) {
  return [...usage.days].sort((a, b) => a.date.localeCompare(b.date));
}

function currentHome(spec) {
  return SURFACES.includes(spec.home) ? spec.home : "today";
}

function blocked(ledger, kind, fingerprint) {
  return ledger.stopped_kinds.includes(kind) || ledger.dismissed.includes(fingerprint);
}

function labelFor(spec, blockId, catalog) {
  const capId = spec.blocks[blockId]?.capability;
  return catalog.find((item) => item.id === capId)?.label || "That block";
}

function weightOf(spec, blockId, catalog) {
  const capId = spec.blocks[blockId]?.capability;
  const cap = catalog.find((item) => item.id === capId);
  return Number.isFinite(cap?.weight) ? cap.weight : 1000;
}

function proposeHome(spec, usage, ledger) {
  if (ledger.stopped_kinds.includes("home")) return null;
  const days = sortedDays(usage);
  if (days.length < 10) return null;
  const recent = days.slice(-10);
  const counts = new Map();
  for (const day of recent) counts.set(day.first_surface, (counts.get(day.first_surface) || 0) + 1);
  let best = null;
  for (const [surface, n] of counts) {
    if (n >= 9 && (!best || n > best.n)) best = { surface, n };
  }
  if (!best || best.surface === currentHome(spec)) return null;
  const fingerprint = `home:${best.surface}`;
  if (blocked(ledger, "home", fingerprint)) return null;
  const label = SURFACE_LABEL[best.surface];
  return {
    kind: "home",
    fingerprint,
    surface: best.surface,
    rationale: `You've opened ${label} first ${best.n} of the last ${recent.length} days. Make ${label} your home screen?`,
    patches: [{ op: "set_home", home: best.surface }],
  };
}

function proposeNarrow(spec, usage, ledger, today) {
  if (ledger.stopped_kinds.includes("narrow_interrupts")) return null;
  const fingerprint = "narrow:due_moved";
  if (blocked(ledger, "narrow_interrupts", fingerprint)) return null;
  const days = sortedDays(usage);
  if (!days.length) return null;
  const oldest = days[0].date;
  if (dayNumber(today) - dayNumber(oldest) < 20) return null;
  const start = shift(today, -20);
  const opened = days.filter((day) => day.date >= start && day.date <= today).length;
  if (opened < 18) return null;
  const current = spec.quiet?.interrupt_for ?? [...INTERRUPTS];
  if (!current.includes("due_moved") || !current.includes("high_stakes_48h") || !current.includes("sync_broken")) return null;
  return {
    kind: "narrow_interrupts",
    fingerprint,
    surface: "today",
    rationale: "You open Kairos most days, so a moved due date can wait until you're here. Stop notifying when a due date moves?",
    patches: [{ op: "set_quiet", interrupt_for: ["high_stakes_48h", "sync_broken"] }],
  };
}

/**
 * `last_seen` is the day that block's *tab* was last shown, so every block on a
 * surface carries the same stamp — it can say the student stopped visiting a tab,
 * never that one block there went untouched. The only per-block signal that can
 * differ is `expansions`, so a removal needs a real gap in it: this block never
 * opened, a neighbour opened repeatedly, on a tab the student still visits.
 *
 * Nothing records an expansion while the screens do not collapse, so this stays
 * dormant until they do. That is the intended shape: a wrong removal costs more
 * than a missed one (Gajos et al. 2009; Findlater and McGrenere 2008).
 */
const MIN_HISTORY_DAYS = 14;
const CLEAR_USE = 3;

function proposeRemove(spec, usage, ledger, today, catalog) {
  if (ledger.stopped_kinds.includes("remove_unused")) return null;
  if (usage.days.length < MIN_HISTORY_DAYS) return null;
  const cutoff = shift(today, -21);
  for (const surface of SURFACES) {
    const slots = spec.surfaces[surface]?.slots;
    if (!Array.isArray(slots) || slots.length < 2) continue;
    for (const id of slots) {
      const block = usage.blocks[id];
      if (!block || block.expansions !== 0) continue;
      // The tab is still part of the student's week, so the block really is on screen and ignored.
      if (!(block.last_seen > cutoff)) continue;
      const sibling = slots.some((other) => other !== id && (usage.blocks[other]?.expansions ?? 0) >= CLEAR_USE);
      if (!sibling) continue;
      const removedCap = spec.blocks[id]?.capability;
      if (!removedCap) continue;
      // Any block anywhere may require this one, not only a block on this surface.
      const remaining = Object.keys(spec.blocks)
        .filter((other) => other !== id)
        .map((other) => spec.blocks[other]?.capability);
      const stillNeeded =
        !remaining.includes(removedCap) &&
        remaining.some((capId) => (catalog.find((item) => item.id === capId)?.requires ?? []).includes(removedCap));
      if (stillNeeded) continue;
      const fingerprint = `remove:${removedCap}`;
      if (blocked(ledger, "remove_unused", fingerprint)) continue;
      return {
        kind: "remove_unused",
        fingerprint,
        surface,
        rationale: `You've never opened ${labelFor(spec, id, catalog)}, but you do open what's beside it. Remove it from ${SURFACE_LABEL[surface]}?`,
        patches: [{ op: "remove", surface, block_id: id }],
      };
    }
  }
  return null;
}

function proposeReorder(spec, usage, ledger, catalog) {
  if (ledger.stopped_kinds.includes("reorder")) return null;
  for (const surface of SURFACES) {
    const slots = spec.surfaces[surface]?.slots;
    if (!Array.isArray(slots) || slots.length < 2) continue;
    for (let index = 1; index < slots.length; index += 1) {
      const lower = slots[index];
      const upper = slots[index - 1];
      const lowerUses = usage.blocks[lower]?.expansions;
      const upperUses = usage.blocks[upper]?.expansions;
      if (!whole(lowerUses, 100_000) || !whole(upperUses, 100_000) || lowerUses <= 0 || upperUses <= 0) continue;
      if (lowerUses < upperUses * 3) continue;
      if (weightOf(spec, lower, catalog) < weightOf(spec, upper, catalog)) continue;
      const fingerprint = `reorder:${surface}:${lower}:${index - 1}`;
      if (blocked(ledger, "reorder", fingerprint)) continue;
      return {
        kind: "reorder",
        fingerprint,
        surface,
        rationale: `You use ${labelFor(spec, lower, catalog)} more than what's above it. Move it up?`,
        patches: [{ op: "reorder", surface, block_id: lower, index: index - 1 }],
      };
    }
  }
  return null;
}

/**
 * One suggestion, or null. Pending, a proposal inside the last 7 days,
 * a dismissed fingerprint, and a stopped kind all return null.
 * Garbage usage returns null rather than a repaired suggestion.
 *
 * @param {unknown} spec
 * @param {unknown} usage
 * @param {{ now?: Date | string, ledger?: unknown, catalog?: readonly { id: string, label?: string, weight?: number, requires?: readonly string[] }[] }} [options]
 */
export function proposeAmendment(spec, usage, options = {}) {
  const trustedSpec = specTrusted(spec);
  const trustedUsage = usageTrusted(usage);
  const ledger = ledgerTrusted(options.ledger);
  const today = todayKey(options.now ?? new Date());
  if (!trustedSpec || !trustedUsage || !ledger || !today) return null;
  if (ledger.pending) return null;
  if (ledger.last_proposed_on) {
    const since = dayNumber(today) - dayNumber(ledger.last_proposed_on);
    if (since < 7) return null;
  }
  const catalog = options.catalog ?? WORKSPACE_CAPABILITIES;
  return (
    proposeHome(trustedSpec, trustedUsage, ledger) ||
    proposeNarrow(trustedSpec, trustedUsage, ledger, today) ||
    proposeRemove(trustedSpec, trustedUsage, ledger, today, catalog) ||
    proposeReorder(trustedSpec, trustedUsage, ledger, catalog) ||
    null
  );
}
