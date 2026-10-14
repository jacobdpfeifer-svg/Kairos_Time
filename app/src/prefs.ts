import { useEffect, useState } from "react";
import { DEFAULT_APP_PREFS, readAppPrefs, setAppPrefs, type AppPrefs } from "./ipc";

/*
 * The native opt-ins (keep running, notifications, capture shortcut) as one
 * shared value: Settings writes it, App and the notification runner follow it.
 */

const listeners = new Set<(p: AppPrefs) => void>();
let current: AppPrefs | null = null;

export async function savePrefs(next: AppPrefs): Promise<AppPrefs> {
  const saved = await setAppPrefs(next);
  current = saved;
  for (const l of listeners) l(saved);
  return saved;
}

export function usePrefs(): AppPrefs | null {
  const [prefs, setPrefs] = useState<AppPrefs | null>(current);
  useEffect(() => {
    let alive = true;
    listeners.add(setPrefs);
    if (!current) {
      readAppPrefs()
        .then((p) => {
          current = p;
          if (alive) setPrefs(p);
        })
        .catch(() => alive && setPrefs(DEFAULT_APP_PREFS));
    }
    return () => {
      alive = false;
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}
