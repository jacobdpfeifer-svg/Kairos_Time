// Purpose: the one sentence about the saved workspace, on Settings → Appearance.
// A sentence, not the middle-dot chain from the architecture note: MASTER §13
// treats that chain as an instant fail, and the same facts read clearly as prose.
import { useState } from "react";
import { ConfirmSheet } from "../components/ConfirmSheet";
import type { WorkspaceHistoryEntry } from "../ipc";
import type { WorkspaceState } from "./store";

function builtOn(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function historyWhen(ts: string): string {
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function workspaceLine(spec: WorkspaceState["spec"]): string {
  const name = spec.name?.trim();
  const when = builtOn(spec.accepted_at || spec.created_at);
  const edits = spec.authorship?.student_edits ?? 0;
  const edited = edits === 0 ? "with no edits" : `with ${edits} ${edits === 1 ? "edit" : "edits"}`;
  if (name && when) return `Your workspace, ${name}, was built ${when}, ${edited}.`;
  if (when) return `Your workspace was built ${when}, ${edited}.`;
  if (name) return `Your workspace, ${name}, is saved on this profile, ${edited}.`;
  return "Your workspace is saved on this profile.";
}

export function WorkspaceAppearance({
  state,
  onRevert,
}: {
  state: WorkspaceState;
  onRevert: (ts: string) => void;
}) {
  const [pending, setPending] = useState<WorkspaceHistoryEntry | null>(null);
  if (!state.notice && !state.fromDisk && state.history.length === 0) return null;
  const pendingName = pending?.name?.trim() || "the previous workspace";
  return (
    <div className="settings-workspace">
      {state.notice && (
        <p className="muted" role="status">
          {state.notice}
        </p>
      )}
      {state.fromDisk && <p className="muted">{workspaceLine(state.spec)}</p>}
      {state.history.length > 0 && (
        <ul className="settings-history">
          {state.history.map((entry) => {
            const when = historyWhen(entry.ts);
            const name = entry.name?.trim() || "Previous workspace";
            return (
              <li key={entry.ts}>
                <span>
                  {name}
                  {when ? `, ${when}` : ""}
                </span>
                <button type="button" className="link" aria-label={`Revert to ${name}`} onClick={() => setPending(entry)}>
                  Revert
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pending && (
        <ConfirmSheet title={`Restore ${pendingName}?`} yes="Revert" no="Keep this one" onYes={() => { onRevert(pending.ts); setPending(null); }} onNo={() => setPending(null)}>
          The workspace you have now is kept, so you can come back to it.
        </ConfirmSheet>
      )}
    </div>
  );
}
