import { useEffect, useState } from "react";
import { readWorkspaceAmendments, readWorkspaceUsage, writeWorkspaceAmendments } from "../ipc";
import { proposeAmendment, type AmendmentKind, type AmendmentProposal } from "./amend";
import { commitAccepted, specAfterAmendment } from "./accept";
import type { Surface, WorkspaceSpec } from "./contracts";
import type { Patch } from "./patch";
import { localDay } from "./usage";

type Ledger = {
  schema_version: 1;
  pending: (AmendmentProposal & { proposed_on?: string }) | null;
  last_proposed_on: string | null;
  dismissed: string[];
  stopped_kinds: AmendmentKind[];
};

const EMPTY: Ledger = { schema_version: 1, pending: null, last_proposed_on: null, dismissed: [], stopped_kinds: [] };

function asLedger(value: unknown): Ledger {
  if (!value || typeof value !== "object") return EMPTY;
  const raw = value as Partial<Ledger>;
  return {
    schema_version: 1,
    pending: raw.pending ?? null,
    last_proposed_on: raw.last_proposed_on ?? null,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed : [],
    stopped_kinds: Array.isArray(raw.stopped_kinds) ? raw.stopped_kinds : [],
  };
}

function settle(ledger: Ledger, action: "yes" | "no" | "stop", proposal: AmendmentProposal, day: string): Ledger {
  return {
    schema_version: 1,
    pending: null,
    last_proposed_on: day,
    dismissed: action === "no" ? [...ledger.dismissed, proposal.fingerprint] : ledger.dismissed,
    stopped_kinds: action === "stop" ? [...new Set([...ledger.stopped_kinds, proposal.kind])] : ledger.stopped_kinds,
  };
}

export function WorkspaceAmendment({ spec, surface }: { spec: WorkspaceSpec; surface: Surface }) {
  const [row, setRow] = useState<AmendmentProposal | null>(null);
  const [ledger, setLedger] = useState<Ledger>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [usage, stored] = await Promise.all([
        readWorkspaceUsage().catch(() => null),
        readWorkspaceAmendments().catch(() => null),
      ]);
      if (!alive) return;
      const base = asLedger(stored);
      const pending = base.pending;
      if (pending?.patches) {
        const fits = specAfterAmendment(spec, pending.patches as Patch[], new Date().toISOString());
        if (!fits) {
          const cleared = { ...base, pending: null };
          await writeWorkspaceAmendments(cleared).catch(() => undefined);
          if (!alive) return;
          setLedger(cleared);
          setRow(null);
          return;
        }
        setLedger(base);
        setRow(pending.surface === surface ? pending : null);
        return;
      }
      const proposal = proposeAmendment(spec, usage, { now: new Date(), ledger: base });
      if (!proposal) {
        setLedger(base);
        setRow(null);
        return;
      }
      const day = localDay();
      const next: Ledger = {
        schema_version: 1,
        pending: { ...proposal, proposed_on: day },
        last_proposed_on: day,
        dismissed: base.dismissed,
        stopped_kinds: base.stopped_kinds,
      };
      try {
        await writeWorkspaceAmendments(next);
      } catch {
        if (alive) setRow(null);
        return;
      }
      if (!alive) return;
      setLedger(next);
      setRow(proposal.surface === surface ? proposal : null);
    })();
    return () => {
      alive = false;
    };
  }, [spec, surface]);

  if (!row) return null;

  const choose = async (action: "yes" | "no" | "stop") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "yes") {
        const next = specAfterAmendment(spec, row.patches as Patch[], new Date().toISOString());
        if (!next) return;
        await commitAccepted(next);
      }
      const nextLedger = settle(ledger, action, row, localDay());
      await writeWorkspaceAmendments(nextLedger);
      setLedger(nextLedger);
      setRow(null);
    } catch {
      /* The workspace on disk is unchanged when the write fails. The row stays. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="amend-row" role="group" aria-label="Workspace suggestion">
      <p>{row.rationale}</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void choose("yes")}>
        Yes
      </button>
      <button type="button" disabled={busy} onClick={() => void choose("no")}>
        No
      </button>
      <button type="button" disabled={busy} onClick={() => void choose("stop")}>
        Stop suggesting this
      </button>
    </div>
  );
}
