import { useEffect, useRef, useState } from "react";
import { useExit } from "../motion";

export type ToastState = {
  message: string;
  /** Shown as a quiet "Undo" button; runs once. */
  undo?: () => void | Promise<void>;
  /** Changes when a new toast replaces an old one with the same text. */
  id?: number;
};

export type ToastQueue = { current: ToastState | null; waiting: ToastState | null };

/**
 * One toast at a time. A toast with Undo stays until it closes; the next one
 * waits. A toast without Undo may replace another without Undo. One waiter is
 * enough, and a waiter that itself has Undo is not replaced.
 */
export function offerToast(state: ToastQueue, incoming: ToastState): ToastQueue {
  if (state.current?.undo) {
    if (state.waiting?.undo) return state;
    return { current: state.current, waiting: incoming };
  }
  return { current: incoming, waiting: null };
}

export function advanceToast(state: ToastQueue): ToastQueue {
  return { current: state.waiting, waiting: null };
}

/**
 * Undo toast (MASTER §06): one sentence and one quiet Undo, bottom center,
 * six seconds, paused while the pointer or focus is on it.
 */
export function Toast({ toast, onDone, ms = 6000 }: { toast: ToastState; onDone: () => void; ms?: number }) {
  const [paused, setPaused] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const exit = useExit(() => done.current());

  // One mounted Toast serves every toast in turn. A new one arriving during an
  // exit has to re-open it, or it would leave with the old one's transition and
  // never be read.
  const key = toast.id ?? toast.message;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    exit.reopen();
  }

  useEffect(() => {
    if (paused || exit.phase === "closed") return;
    const t = window.setTimeout(() => exit.requestClose(), ms);
    return () => window.clearTimeout(t);
  }, [paused, ms, toast.message, toast.id, exit.phase, exit.requestClose]);

  return (
    <div
      ref={(el) => {
        exit.node.current = el;
      }}
      className="toast sheet"
      data-phase={exit.phase}
      role="status"
      onTransitionEnd={exit.onTransitionEnd}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          className="link"
          onClick={() => {
            const undo = toast.undo;
            void undo?.();
            exit.requestClose();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
