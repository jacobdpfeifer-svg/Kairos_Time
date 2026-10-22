// Purpose: the profile's accepted workspace, shared by the shell and Settings
import { useCallback, useEffect, useState } from "react";
import { readWorkspaceSpec, revertWorkspace, type WorkspaceHistoryEntry } from "../ipc";
import { DEFAULT_SPEC, FALLBACK_NOTICE, WORKSPACE_CAPABILITIES, validateWorkspaceSpec, type WorkspaceSpec } from "./contracts";

export type WorkspaceState = {
  spec: WorkspaceSpec;
  notice: string | null;
  fromDisk: boolean;
  history: WorkspaceHistoryEntry[];
  /** False until the first read finishes, so the studio does not propose the default by mistake. */
  loaded: boolean;
};

const listeners = new Set<(state: WorkspaceState) => void>();

let current: WorkspaceState = { spec: DEFAULT_SPEC, notice: null, fromDisk: false, history: [], loaded: false };

function emit() {
  for (const listener of listeners) listener(current);
}

export function workspaceState(): WorkspaceState {
  return current;
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  try {
    const read = await readWorkspaceSpec();
    const history = read.history ?? [];
    const checked = read.spec ? validateWorkspaceSpec(read.spec, { capabilities: WORKSPACE_CAPABILITIES }) : null;
    if (checked?.ok && checked.spec) {
      current = { spec: checked.spec, notice: read.notice, fromDisk: true, history, loaded: true };
    } else if (read.spec || read.notice) {
      current = { spec: DEFAULT_SPEC, notice: read.notice ?? FALLBACK_NOTICE, fromDisk: false, history, loaded: true };
    } else {
      current = { spec: DEFAULT_SPEC, notice: null, fromDisk: false, history, loaded: true };
    }
  } catch {
    current = { spec: DEFAULT_SPEC, notice: null, fromDisk: false, history: [], loaded: true };
  }
  emit();
  return current;
}

export async function revertTo(ts: string): Promise<void> {
  await revertWorkspace(ts);
  await loadWorkspace();
}

export function noteInvalidWorkspace(notice: string) {
  if (current.notice === notice && current.spec === DEFAULT_SPEC) return;
  current = { ...current, spec: DEFAULT_SPEC, notice, fromDisk: false };
  emit();
}

export function useWorkspace(): WorkspaceState & { revert: (ts: string) => Promise<void> } {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    void loadWorkspace();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  const revert = useCallback((ts: string) => revertTo(ts), []);
  return { ...state, revert };
}

/** Tests share this module. Put it back before the next case. */
export function resetWorkspaceStore() {
  current = { spec: DEFAULT_SPEC, notice: null, fromDisk: false, history: [], loaded: false };
  emit();
}
