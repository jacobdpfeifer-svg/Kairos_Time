import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc";
import { EMPTY_STATE, type Capture, type WeekSnapshot } from "./plan";

/*
 * Bridge to `week_plan.py` (Tauri `week_plan`). Outside the desktop app (Vite
 * preview, tests) the same commands run against a small in-memory store so
 * the Week page can be seen and tested without the Python core.
 */

export type WeekReply = WeekSnapshot & { ok: boolean; error?: string; saved?: Capture };

export class WeekPlanError extends Error {}

const planListeners = new Set<() => void>();

/** Fired after a plan write, so Today and Week refresh without a remount. */
export function onPlanChanged(listener: () => void): () => void {
  planListeners.add(listener);
  return () => planListeners.delete(listener);
}

function notifyPlanChanged(cmd: string) {
  if (cmd === "show") return;
  for (const listener of planListeners) listener();
}

export async function weekPlan(cmd: string, params: Record<string, unknown> = {}): Promise<WeekReply> {
  const reply = isTauri() ? await invoke<WeekReply>("week_plan", { request: { cmd, params } }) : memory(cmd, params);
  if (!reply.ok) throw new WeekPlanError(reply.error || "The plan didn't save.");
  notifyPlanChanged(cmd);
  return reply;
}

// ---------------------------------------------------------------- preview store

let store: WeekSnapshot = { state: structuredClone(EMPTY_STATE), items: [], piles: { courses: {} } };

export function resetPreviewStore(seed?: Partial<WeekSnapshot>) {
  store = { state: structuredClone(EMPTY_STATE), items: [], piles: { courses: {} }, ...seed };
}

function now() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function memory(cmd: string, p: Record<string, unknown>): WeekReply {
  const s = store.state;
  const id = String(p.item_id ?? "");
  switch (cmd) {
    case "show":
      break;
    case "hours": {
      const week = String(p.week);
      s.weeks[week] = { ...s.weeks[week], hours: Number(p.hours) };
      s.default_hours = Number(p.hours);
      break;
    }
    case "estimate":
      if (p.minutes == null) delete s.estimates[id];
      else s.estimates[id] = Number(p.minutes);
      break;
    case "defer":
      s.deferrals[id] = { to: String(p.to), at: now() };
      break;
    case "undefer":
      delete s.deferrals[id];
      break;
    case "accept": {
      const week = String(p.week);
      const days = p.days as Record<string, string>;
      s.weeks[week] = { ...s.weeks[week], accepted: { at: now(), days } };
      for (const k of Object.keys(days)) delete s.deferrals[k];
      break;
    }
    case "unaccept": {
      const week = String(p.week);
      if (s.weeks[week]) delete s.weeks[week].accepted;
      break;
    }
    case "capture": {
      const row: Capture = {
        id: `cap-${Math.random().toString(16).slice(2, 14)}`,
        title: String(p.title ?? "").trim(),
        course: (p.course as string) || null,
        due_at: (p.due_at as string) || null,
        day: (p.day as string) || null,
        source: String(p.source ?? "typed"),
        created_at: now(),
      };
      if (!row.title) return { ...store, ok: false, error: "title is required" };
      store.items = [...store.items, row];
      return { ...structuredClone(store), ok: true, saved: row };
    }
    case "done":
      store.items = store.items.map((r) => (r.id === id ? { ...r, done_at: p.undo ? null : now() } : r));
      break;
    case "remove":
      store.items = store.items.filter((r) => r.id !== id);
      break;
    case "pile": {
      s.pile_moves[String(p.key)] = p.pile as never;
      if (p.always && p.course && p.kind) {
        const c = String(p.course);
        store.piles.courses[c] = { ...store.piles.courses[c], [String(p.kind)]: p.pile as never };
      }
      break;
    }
    default:
      return { ...store, ok: false, error: `unknown command ${cmd}` };
  }
  return { ...structuredClone(store), ok: true };
}
