import { useState, type ReactNode } from "react";
import { MotionDialog } from "./MotionDialog";

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
  match,
  onYes,
  onNo,
}: {
  title: string;
  children: ReactNode;
  yes: string;
  no?: string;
  busy?: boolean;
  /** Rung 3: the primary stays disabled until this matches, aside from surrounding whitespace. */
  match?: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = match == null || typed.trim() === match.trim();
  return (
    // A typed confirmation opens on its field. Without this the first focusable
    // element happens to be the field only because the primary starts disabled.
    <MotionDialog
      onClose={onNo}
      className="confirm-sheet sheet"
      labelledBy="confirm-title"
      initialFocus={match != null ? ".confirm-match input" : undefined}
    >
      {(close) => (
        <>
          <h2 id="confirm-title">{title}</h2>
          <div className="confirm-body">
            {children}
            {match != null && (
              <label className="confirm-match">
                Type {match} to continue
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
              </label>
            )}
          </div>
          <div className="sheet-actions">
            <button type="button" className="primary" disabled={busy || !confirmed} onClick={onYes}>
              {busy ? "Saving" : yes}
            </button>
            <button type="button" className="ghost" onClick={close}>
              {no}
            </button>
          </div>
        </>
      )}
    </MotionDialog>
  );
}
