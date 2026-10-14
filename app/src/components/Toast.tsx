import { useEffect, useRef, useState } from "react";

export type ToastState = {
  message: string;
  /** Shown as a quiet "Undo" button; runs once. */
  undo?: () => void | Promise<void>;
  /** Changes when a new toast replaces an old one with the same text. */
  id?: number;
};

/**
 * Undo toast (MASTER §06): one sentence and one quiet Undo, bottom center,
 * six seconds, paused while the pointer or focus is on it.
 */
export function Toast({ toast, onDone, ms = 6000 }: { toast: ToastState; onDone: () => void; ms?: number }) {
  const [paused, setPaused] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => done.current(), ms);
    return () => window.clearTimeout(t);
  }, [paused, ms, toast.message, toast.id]);

  return (
    <div
      className="toast sheet"
      role="status"
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
            done.current();
            void undo?.();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
