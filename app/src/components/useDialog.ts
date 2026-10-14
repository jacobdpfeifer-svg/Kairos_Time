import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one answers Escape and Tab. */
const stack: symbol[] = [];

/**
 * Modal sheet behavior (MASTER §06 sheet): focus moves in on open, Tab stays
 * inside, Escape closes, and focus returns to whatever opened it.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void, { initialFocus }: { initialFocus?: string } = {}) {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol("dialog");
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root) {
      const first = (initialFocus && root.querySelector<HTMLElement>(initialFocus)) || root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      stack.splice(stack.indexOf(id), 1);
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
