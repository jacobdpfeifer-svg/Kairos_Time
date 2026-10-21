// Purpose: runs the notification check loop
import { useEffect } from "react";
import {
  isTauri,
  onFreshnessUpdated,
  onInboxUpdated,
  readCalendarSurface,
  readFreshness,
  readSemester,
  readSyncHealth,
} from "../ipc";
import { EMPTY_NOTIFY_STATE, candidates, decide, type NotifyState } from "./policy";

const STATE_KEY = "pn_notify_state";
const EVERY_MS = 15 * 60 * 1000;

function loadState(): NotifyState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    return raw && typeof raw === "object" && raw.sent ? raw : EMPTY_NOTIFY_STATE;
  } catch {
    return EMPTY_NOTIFY_STATE;
  }
}

function saveState(state: NotifyState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* a lost record only risks one repeat */
  }
}

/** One pass: read what Kairos already knows, apply the policy, send what's due. */
export async function checkOnce(now = new Date()): Promise<number> {
  const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
  if (!(await isPermissionGranted())) return 0;
  const [dash, semester, health, calendar] = await Promise.all([
    readFreshness().catch(() => null),
    readSemester("1m", now.toISOString()).catch(() => null),
    readSyncHealth().catch(() => null),
    readCalendarSurface().catch(() => null),
  ]);
  const notes = candidates({
    changes: dash?.changes ?? [],
    ticks: semester ? semester.courses.flatMap((c) => c.ticks) : [],
    health,
    now,
  });
  const classes = (calendar?.canvas_events ?? []).map((e) => ({ start: e.start, end: e.end }));
  const { send, state } = decide(notes, loadState(), now, classes);
  saveState(state);
  for (const n of send) sendNotification({ title: n.title, body: n.body });
  return send.length;
}

/** Runs only while the student has notifications on; checks after each sync and every 15 minutes. */
export function useNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let busy = false;
    const run = () => {
      if (busy) return;
      busy = true;
      void checkOnce()
        .catch(() => 0)
        .finally(() => {
          busy = false;
        });
    };
    run();
    const timer = window.setInterval(run, EVERY_MS);
    const subs = [onFreshnessUpdated(run), onInboxUpdated(run)];
    return () => {
      window.clearInterval(timer);
      for (const s of subs) void s.then((fn) => fn());
    };
  }, [enabled]);
}
