import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { tokenMs, useExit } from "../motion";
import { useDialog } from "./useDialog";

/**
 * A dialog whose enter and exit are transitions, so closing during the
 * rise reverses from where it is. `rise` comes up from below; otherwise
 * the sheet fades in place. The command bar does not use this.
 */
export function MotionDialog({
  onClose,
  rise = false,
  className,
  label,
  labelledBy,
  initialFocus,
  style,
  children,
}: {
  onClose: () => void;
  rise?: boolean;
  className: string;
  label?: string;
  labelledBy?: string;
  initialFocus?: string;
  style?: CSSProperties;
  children: (close: () => void) => ReactNode;
}) {
  const exit = useExit(onClose);
  const dialog = useDialog<HTMLDivElement>(exit.requestClose, { initialFocus });
  return (
    <div className="sheet-backdrop" data-phase={exit.phase} onClick={exit.requestClose} role="presentation">
      <div
        ref={(el) => {
          dialog.current = el;
          exit.node.current = el;
        }}
        className={`${className} ${rise ? "motion-rise" : "motion-place"}`}
        data-phase={exit.phase}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={style}
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={exit.onTransitionEnd}
      >
        {children(exit.requestClose)}
      </div>
    </div>
  );
}

/** Opacity cross-fade when a fact changes. No count-up. */
export function Crossfade({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text === shown) return;
    // --t-near is the fade out; the same token fades the new text back in.
    // With no tokens loaded the text swaps at once rather than staying hidden.
    const ms = tokenMs("--t-near");
    if (ms < 20) {
      setShown(text);
      return;
    }
    const t = window.setTimeout(() => setShown(text), ms);
    return () => window.clearTimeout(t);
  }, [text, shown]);
  return <span className={text === shown ? "crossfade" : "crossfade is-out"}>{shown}</span>;
}
