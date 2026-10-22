// Purpose: tools the student named that Kairos does not connect.
import { useCallback, useEffect, useState } from "react";
import { integrationRequestState, requestSentence } from "../../../browser/scripts/lib/tool-request-state.mjs";
import { readWorkflowDraft, readWorkspaceSpec, writeAcceptedSpec, writeWorkflowDraft } from "../ipc";
import type { WorkspaceSpec } from "../workspace/contracts";

type Row = { name: string; state: "requested" | "not_available" };

function itemName(item: unknown): string {
  if (typeof item === "string") return item.replace(/\s+/g, " ").trim();
  if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
    return (item as { name: string }).name.replace(/\s+/g, " ").trim();
  }
  return "";
}

function collectRows(spec: WorkspaceSpec | null, draft: Record<string, unknown> | null): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ name, state: integrationRequestState(name) });
  };
  for (const item of spec?.requested_integrations ?? []) push(itemName(item));
  if (draft?.status === "draft" && Array.isArray(draft.requested_integrations)) {
    for (const item of draft.requested_integrations) push(itemName(item));
  }
  return rows;
}

/** Quiet list of tools the student asked for. Removal stays on this Mac. */
export function AskedFor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [spec, setSpec] = useState<WorkspaceSpec | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    let failed = false;
    const [workspace, rawDraft] = await Promise.all([
      readWorkspaceSpec().catch(() => {
        failed = true;
        return null;
      }),
      readWorkflowDraft().catch(() => {
        failed = true;
        return null;
      }),
    ]);
    const nextSpec = workspace?.spec ?? null;
    const nextDraft = rawDraft && typeof rawDraft === "object" ? (rawDraft as Record<string, unknown>) : null;
    setSpec(nextSpec);
    setDraft(nextDraft);
    setRows(collectRows(nextSpec, nextDraft));
    setError(failed && !nextSpec && !nextDraft ? "Kairos couldn't read what you've asked for." : "");
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (name: string) => {
    const key = name.toLowerCase();
    setBusy(true);
    setError("");
    try {
      const draftNames = Array.isArray(draft?.requested_integrations) ? draft.requested_integrations : [];
      const draftHas = draftNames.some((item) => itemName(item).toLowerCase() === key);
      const specHas = (spec?.requested_integrations ?? []).some((item) => itemName(item).toLowerCase() === key);
      if (draftHas && draft) {
        await writeWorkflowDraft({
          ...draft,
          requested_integrations: draftNames.filter((item) => itemName(item).toLowerCase() !== key),
        });
      }
      if (specHas && spec?.status === "accepted" && spec.accepted_by === "student") {
        await writeAcceptedSpec({
          ...spec,
          requested_integrations: (spec.requested_integrations ?? []).filter((item) => itemName(item).toLowerCase() !== key),
        });
      }
      await refresh();
    } catch {
      setError("Kairos couldn't update that list.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready || (rows.length === 0 && !error)) return null;

  return (
    <section className="asked-for" aria-label="Asked for">
      {rows.length > 0 && (
        <>
          <h2>Asked for</h2>
          <ul>
            {rows.map((row) => (
              <li key={row.name.toLowerCase()}>
                <div>
                  <p>{row.name}</p>
                  <p>{row.state === "not_available" ? "Not available" : "Requested"}</p>
                  <p className="muted">{requestSentence(row.name)}</p>
                </div>
                <button type="button" className="link" disabled={busy} aria-label={`Remove ${row.name}`} onClick={() => void remove(row.name)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
