import type { ReactNode } from "react";
import { useDialog } from "./useDialog";

/**
 * A suggestion waits for yes (MASTER §10 calendar suggestions): the sheet says
 * exactly what would change, one primary yes, one way out. Nothing happens
 * until the student picks yes, and nothing moves on its own afterwards.
 */
export function ConfirmSheet({
  title,
  children,
  yes,
  no = "Not now",
  busy = false,
  onYes,
  onNo,
}: {
  title: string;
  children: ReactNode;
  yes: string;
  no?: string;
  busy?: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onNo);
  return (
    <div className="sheet-backdrop" onClick={onNo} role="presentation">
      <div
        ref={ref}
        className="confirm-sheet sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        <div className="sheet-actions">
          <button type="button" className="primary" disabled={busy} onClick={onYes}>
            {busy ? "Saving" : yes}
          </button>
          <button type="button" className="ghost" onClick={onNo}>
            {no}
          </button>
        </div>
      </div>
    </div>
  );
}
