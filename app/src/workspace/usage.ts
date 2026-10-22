import { useEffect } from "react";
import { isTauri, recordWorkspaceUsage } from "../ipc";
import type { Surface } from "./contracts";

const BLOCK_ID = /^[a-z][a-z0-9_]{0,31}$/;

export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Explicit only. The current screens do not collapse, so nothing calls this yet. */
export function recordBlockExpand(blockId: string, now = new Date()): void {
  if (!isTauri() || !BLOCK_ID.test(blockId)) return;
  void recordWorkspaceUsage({ event: "expand_block", block_id: blockId, day: localDay(now) });
}

/** One open when a surface is shown. Dwell flushes on leave, on hide, and once a minute. */
export function useWorkspaceUsage(enabled: boolean, surface: Surface | null): void {
  useEffect(() => {
    if (!enabled || !surface) return;
    void recordWorkspaceUsage({ event: "open_surface", surface, day: localDay() });
    let start = Date.now();
    const flush = () => {
      const seconds = Math.min(120, Math.round((Date.now() - start) / 1000));
      start = Date.now();
      if (seconds >= 1) void recordWorkspaceUsage({ event: "dwell", surface, seconds });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") flush();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.clearInterval(timer);
      flush();
    };
  }, [enabled, surface]);
}
