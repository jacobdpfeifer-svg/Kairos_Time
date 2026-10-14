import { useState } from "react";
import { openCanvasSso, openExternalUrl, syncCanvas, type SyncHealth } from "../ipc";
import { friendlyWhen } from "../format";

/*
 * Whether Today's data is current, and the one thing that fixes it when it
 * isn't. A warning without its fix is a dead end (MASTER §14).
 */
export function SyncHealthBanner({
  health,
  inspectUrl,
  failure,
  onSynced,
}: {
  health?: SyncHealth | null;
  inspectUrl?: string | null;
  /** A background sync (tray, cadence) failed with this message. */
  failure?: string | null;
  onSynced?: () => void;
}) {
  const [busy, setBusy] = useState<"" | "sync" | "signin">("");
  const [note, setNote] = useState("");

  const sync = async () => {
    setBusy("sync");
    setNote("");
    try {
      const r = await syncCanvas();
      setNote(r.ok ? "Synced." : r.error ? `Sync didn't finish: ${r.error}` : "Sync didn't finish.");
      if (r.ok) onSynced?.();
    } catch {
      setNote("Sync didn't finish. Try again.");
    } finally {
      setBusy("");
    }
  };

  const signIn = async () => {
    setBusy("signin");
    setNote("");
    try {
      await openCanvasSso();
      setNote("Finish signing in to Canvas in Chrome, then sync.");
    } catch {
      setNote("Couldn't open Canvas sign-in. Try again.");
    } finally {
      setBusy("");
    }
  };

  const state = health?.state;
  if (!state && !failure) return null;

  if (state === "fresh_complete" && !failure) {
    return (
      <p className="muted sync-health" data-state={state} title={health?.sync_id ? `Sync ${health.sync_id}` : undefined}>
        {health?.as_of ? `Up to date with Canvas as of ${friendlyWhen(health.as_of)}.` : "Up to date with Canvas."}
        {note && <span role="status"> {note}</span>}
      </p>
    );
  }

  const blocked = state === "blocked";
  const label = failure
    ? "The last background sync didn't finish."
    : blocked
      ? "Kairos can't read Canvas right now. Your Canvas sign-in needs renewing."
      : state === "empty_unverified"
        ? "Kairos hasn't finished reading Canvas yet, so this is not an empty week."
        : state === "fresh_partial"
          ? "Some classes didn't load from Canvas."
          : state === "stale_complete"
            ? "This is an older copy of your Canvas data."
            : state === "stale_partial"
              ? "This is an older, partial copy of your Canvas data."
              : "Canvas data needs a look.";
  return (
    <aside className="sync-health warn" data-state={state ?? "failed"} role="status">
      <p>
        <strong>{label}</strong>
        {health?.as_of && <span> Last read {friendlyWhen(health.as_of)}.</span>}
        {Array.isArray(health?.named_courses_failed) && health.named_courses_failed.length > 0 && (
          <span> Courses: {health.named_courses_failed.join(", ")}.</span>
        )}
        {failure && <span className="muted"> {failure}</span>}
      </p>
      <div className="sync-actions">
        {blocked ? (
          <button type="button" className="primary" disabled={busy !== ""} onClick={() => void signIn()}>
            {busy === "signin" ? "Opening Canvas" : "Sign in again"}
          </button>
        ) : (
          <button type="button" disabled={busy !== ""} onClick={() => void sync()}>
            {busy === "sync" ? "Syncing" : "Sync now"}
          </button>
        )}
        {inspectUrl && (inspectUrl.startsWith("https://") || inspectUrl.startsWith("http://")) && (
          <button type="button" className="link" onClick={() => void openExternalUrl(inspectUrl)}>
            Open Canvas
          </button>
        )}
      </div>
      {note && <p className="muted">{note}</p>}
    </aside>
  );
}
