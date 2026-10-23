/**
 * Motion helpers (MASTER §15). CSS tokens live in design-system/kairos/motion.css.
 * Either the OS setting or the student's data-motion switch is enough.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TransitionEvent } from "react";

export const ATTACK_MS = 45;
export const RELEASE_MS = 200;
/** Longer than --t-sheet so a missed transitionend cannot leave a sheet open. */
export const EXIT_FALLBACK_MS = 400;

/**
 * Milliseconds held by a duration token, so JS that has to wait for a CSS
 * exit reads the same number the stylesheet does. Returns 0 when the tokens
 * are not loaded (jsdom), which callers treat as "act now".
 */
export function tokenMs(name: string): number {
  if (typeof document === "undefined") return 0;
  let raw = "";
  try {
    raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return 0;
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return raw.endsWith("ms") ? n : n * 1000;
}

/**
 * Commits after the row's lift-out has played. The data is the authority, so
 * with no tokens loaded, or under a duration too short to see, it commits now.
 * Returns the timer id (0 when it already ran) so a caller can cancel it.
 */
export function leaveThen(go: () => void): number {
  const ms = tokenMs("--t-settle");
  if (ms < 20) {
    go();
    return 0;
  }
  return window.setTimeout(go, ms);
}

export function motionReduced(): boolean {
  if (typeof document === "undefined") return true;
  if (document.documentElement.dataset.motion === "reduced") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Asymmetric envelope: fast attack, slow release. Time constants, not a symmetric lerp. */
export function envelopeStep(current: number, target: number, dtMs: number, attack = ATTACK_MS, release = RELEASE_MS): number {
  const tau = target >= current ? attack : release;
  if (dtMs <= 0) return current;
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dtMs / tau);
  return current + (target - current) * k;
}

export function useMotionReduced(forced?: boolean): boolean {
  const [on, setOn] = useState(motionReduced);
  useEffect(() => {
    const read = () => setOn(motionReduced());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);
  return forced !== undefined ? forced : on;
}

/**
 * Keeps a sheet mounted until its exit transition finishes, so a dismiss
 * during the rise reverses from the current value. With no CSS loaded
 * (tests) the close is immediate.
 */
export function useExit(onClose: () => void) {
  const node = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<"open" | "closed">("open");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (node.current) node.current.style.willChange = "";
    onCloseRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (finished.current) return;
    const el = node.current;
    const dur = el ? parseFloat(getComputedStyle(el).transitionDuration) : NaN;
    if (!el || !Number.isFinite(dur) || dur < 0.02) {
      finish();
      return;
    }
    el.style.willChange = "transform, opacity";
    setPhase("closed");
  }, [finish]);

  const reopen = useCallback(() => {
    finished.current = false;
    setPhase("open");
  }, []);

  useEffect(() => {
    if (phase !== "closed") return;
    const t = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [phase, finish]);

  useEffect(() => {
    const el = node.current;
    if (!el || phase === "closed") return;
    el.style.willChange = "transform, opacity";
    const t = window.setTimeout(() => {
      if (node.current === el && phase === "open") el.style.willChange = "";
    }, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || phase !== "closed") return;
    if (event.propertyName !== "opacity" && event.propertyName !== "transform") return;
    finish();
  };

  return { phase, requestClose, onTransitionEnd, node, reopen };
}

/** What the next FLIP should do. Set it in the same turn as the state write. */
export type FlipCue = { holdId: string | null; instant: boolean };

const IDLE_CUE: FlipCue = { holdId: null, instant: false };

/**
 * FLIP for a row that was already on screen. Transform only, so the move
 * stays on the compositor and the row stays clickable. New rows (no previous
 * box) appear in place.
 *
 * `cue` is read once per signature change. A pointer action sets holdId so
 * that row waits `--t-hold` before it moves. A keyboard action sets instant
 * and nothing travels (§15.1). The data is already committed either way.
 */
export function useFlip<T extends HTMLElement>(signature: string, cue?: { current: FlipCue }) {
  const ref = useRef<T | null>(null);
  const prev = useRef<Map<string, { left: number; top: number }>>(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cueNow = cue?.current ?? IDLE_CUE;
    if (cue) cue.current = { holdId: null, instant: false };
    const instant = cueNow.instant;
    const holdId = instant ? null : cueNow.holdId;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-flip]"));
    const next = new Map<string, { left: number; top: number }>();
    const reduced = motionReduced();
    for (const el of nodes) {
      const id = el.dataset.flip;
      if (!id) continue;
      const box = el.getBoundingClientRect();
      const old = prev.current.get(id);
      if (old && !reduced && !instant) {
        const dx = old.left - box.left;
        const dy = old.top - box.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          el.style.willChange = "transform";
          const held = id === holdId;
          requestAnimationFrame(() => {
            el.style.transition = "transform var(--t-settle) var(--ease-move)";
            if (held) el.style.transitionDelay = "var(--t-hold)";
            el.style.transform = "";
            // One clear per move. Without the guard a later timeout would wipe
            // the transition off a move that started after this one.
            let cleared = false;
            let timer = 0;
            const clear = () => {
              if (cleared) return;
              cleared = true;
              window.clearTimeout(timer);
              el.style.willChange = "";
              el.style.transition = "";
              el.style.transitionDelay = "";
              el.removeEventListener("transitionend", clear);
            };
            el.addEventListener("transitionend", clear);
            timer = window.setTimeout(clear, EXIT_FALLBACK_MS);
          });
        }
      }
      next.set(id, { left: box.left, top: box.top });
    }
    prev.current = next;
  }, [signature, cue]);
  return ref;
}
