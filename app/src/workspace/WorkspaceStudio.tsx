// Purpose: the student watches a real spec assemble, then makes it theirs.
// Reorder is Move up / Move down, not a drag handle: the accordion key pattern
// from BriefIslandList already moves between headers, and a drag-only control
// would leave the keyboard behind. APG has no reorderable accordion.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKey } from "react";
import { useDialog } from "../components/useDialog";
import { discardProposedWorkspace, readProposedWorkspace, writeProposedWorkspace } from "../ipc";
import { useTheme } from "../theme";
import { isReviewedConnector } from "../../../browser/scripts/lib/connector-registry-data.mjs";
import { WORKSPACE_CAPABILITIES, type WorkspaceCapability } from "./catalog";
import { SURFACES, type Surface, type WorkspaceSpec } from "./contracts";
import {
  REPLAY_MS,
  SURFACE_LABEL,
  assemblePrefix,
  cloneSpec,
  describeSpecDiff,
  emptyHistory,
  nextBlockId,
  normalizeProposal,
  proposalFromAccepted,
  pushPatch,
  redoPatch,
  studentEditCount,
  undoPatch,
  type PatchHistory,
  type ProposedWorkspace,
} from "./patch";
import { commitAccepted } from "./accept";

type Phase = { mode: "play"; cursor: number } | { mode: "edit"; spec: WorkspaceSpec; history: PatchHistory };

function firstSurface(spec: WorkspaceSpec): Surface {
  return SURFACES.find((surface) => (spec.surfaces[surface]?.slots?.length ?? 0) > 0) ?? "today";
}

function systemReduced(): boolean {
  try {
    if (document.documentElement.dataset.motion === "reduced") return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function useReducedMotion(forced: boolean | undefined): boolean {
  const { motion } = useTheme();
  if (forced !== undefined) return forced;
  return motion === "reduced" || systemReduced();
}

/** Connector chrome only for a capability whose id is in the reviewed registry. */
function showsOptionalConnector(cap: (WorkspaceCapability & { connector?: string }) | undefined): cap is WorkspaceCapability & { connector?: string } {
  if (!cap || cap.availability !== "optional_connector") return false;
  return isReviewedConnector(cap.id) || isReviewedConnector(cap.connector);
}

function connectorWord(cap: WorkspaceCapability, spec: WorkspaceSpec): "Requested" | "Not available" {
  const hit = (spec.requested_integrations ?? []).find((entry) => {
    const name = entry.name?.toLowerCase();
    return name === cap.label.toLowerCase() || name === cap.id.toLowerCase();
  });
  return hit?.state === "requested" ? "Requested" : "Not available";
}

function moveFocus(event: ReactKey, index: number, count: number, focusAt: (index: number) => void) {
  const to =
    event.key === "ArrowDown" ? (index + 1) % count : event.key === "ArrowUp" ? (index - 1 + count) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : -1;
  if (to < 0 || count === 0) return;
  event.preventDefault();
  focusAt(to);
}

function AddSheet({
  surface,
  spec,
  items,
  onAdd,
  onClose,
}: {
  surface: Surface;
  spec: WorkspaceSpec;
  items: { cap: WorkspaceCapability; canAdd: boolean }[];
  onAdd: (cap: WorkspaceCapability) => void;
  onClose: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const options = useRef<(HTMLElement | null)[]>([]);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} className="sheet studio-add" role="dialog" aria-modal="true" aria-labelledby="add-block-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 id="add-block-title">Add to {SURFACE_LABEL[surface]}</h2>
        {items.length === 0 ? (
          <p>Every block for {SURFACE_LABEL[surface]} is already here.</p>
        ) : (
          <div role="listbox" aria-label={`Blocks for ${SURFACE_LABEL[surface]}`}>
            {items.map((item, index) => {
              const word = showsOptionalConnector(item.cap) ? connectorWord(item.cap, spec) : null;
              if (!item.canAdd) {
                return (
                  <div
                    key={item.cap.id}
                    role="option"
                    aria-disabled="true"
                    aria-selected={false}
                    tabIndex={-1}
                    ref={(el) => {
                      options.current[index] = el;
                    }}
                    className="studio-choice"
                    onKeyDown={(event) => moveFocus(event, index, items.length, (to) => options.current[to]?.focus())}
                  >
                    <span className="studio-block-title">{item.cap.label}</span>
                    <span className="muted">{item.cap.blurb}</span>
                    {word && <span>{word}</span>}
                  </div>
                );
              }
              return (
                <button
                  key={item.cap.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  ref={(el) => {
                    options.current[index] = el;
                  }}
                  className="studio-choice"
                  onKeyDown={(event) => moveFocus(event, index, items.length, (to) => options.current[to]?.focus())}
                  onClick={() => onAdd(item.cap)}
                >
                  <span className="studio-block-title">{item.cap.label}</span>
                  <span className="muted">{item.cap.blurb}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceStudio({
  accepted,
  proposal,
  capabilities = WORKSPACE_CAPABILITIES,
  reducedMotion,
  onClose,
  onPlaybackNarration,
}: {
  accepted: WorkspaceSpec;
  proposal: ProposedWorkspace;
  capabilities?: readonly WorkspaceCapability[];
  /** Tests pin this. Otherwise the system setting and the Appearance switch both count. */
  reducedMotion?: boolean;
  onClose: () => void;
  /** Compiler sentence for the block that just landed. Null when playback is idle. */
  onPlaybackNarration?: (line: string | null) => void;
}) {
  const reduced = useReducedMotion(reducedMotion);
  // Only a place op is a frame the student can see land. The compiler's
  // set_density / set_home / set_quiet ops are already true of the baseline the
  // shell is built from, so replaying them would spend the first three ticks
  // showing nothing. They stay in proposal.patches as the record of the compile.
  const stream = proposal.patches.filter((patch) => patch.op === "place");
  const editedOnArrival = JSON.stringify(proposal.spec) !== JSON.stringify(proposal.baseline);
  const [phase, setPhase] = useState<Phase>(() => {
    if (reduced || editedOnArrival || stream.length === 0) {
      return { mode: "edit", spec: editedOnArrival ? cloneSpec(proposal.spec) : cloneSpec(proposal.baseline), history: emptyHistory() };
    }
    return { mode: "play", cursor: 0 };
  });
  const [open, setOpen] = useState<Surface>("today");
  const [nameDraft, setNameDraft] = useState(proposal.baseline.name ?? "");
  const [nudgeShown, setNudgeShown] = useState(proposal.nudge_shown);
  const [showNudge, setShowNudge] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const headers = useRef<(HTMLButtonElement | null)[]>([]);
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const specRef = useRef<WorkspaceSpec>(proposal.baseline);
  const historyRef = useRef<PatchHistory>(emptyHistory());
  const nudgeRef = useRef(proposal.nudge_shown);

  const playing = phase.mode === "play";
  const prefix = playing ? assemblePrefix(proposal.baseline, stream.slice(0, phase.cursor), capabilities) : null;
  const spec = playing ? (prefix?.spec ?? proposal.baseline) : phase.spec;
  const history = playing ? emptyHistory() : phase.history;
  specRef.current = spec;
  historyRef.current = history;
  nudgeRef.current = nudgeShown;

  useEffect(() => {
    if (phase.mode !== "play") return;
    const id = window.setInterval(() => {
      setPhase((current) => {
        if (current.mode !== "play") return current;
        const next = current.cursor + 1;
        if (next >= stream.length) return { mode: "edit", spec: cloneSpec(proposal.baseline), history: emptyHistory() };
        return { mode: "play", cursor: next };
      });
    }, REPLAY_MS);
    return () => window.clearInterval(id);
  }, [phase.mode, stream.length, proposal.baseline]);

  useEffect(() => {
    if (!playing || !prefix?.failed) return;
    setPhase({ mode: "edit", spec: cloneSpec(proposal.baseline), history: emptyHistory() });
  }, [playing, prefix?.failed, proposal.baseline]);

  useEffect(() => {
    if (phase.mode !== "play" || phase.cursor === 0) return;
    const last = [...stream.slice(0, phase.cursor)].reverse().find((patch) => patch.op === "place");
    if (last && last.op === "place") setOpen(last.surface);
  }, [phase, stream]);

  useEffect(() => {
    if (!onPlaybackNarration) return;
    if (phase.mode !== "play" || phase.cursor === 0) {
      if (phase.mode !== "play") onPlaybackNarration(null);
      return;
    }
    const last = [...stream.slice(0, phase.cursor)].reverse().find((patch) => patch.op === "place");
    const line = last && last.op === "place" ? last.narration ?? proposal.rationale[last.block_id] ?? null : null;
    onPlaybackNarration(line ?? null);
  }, [onPlaybackNarration, phase, stream, proposal.rationale]);

  useEffect(() => {
    if (phase.mode !== "edit") return;
    if (phase.history.undo.length || phase.history.redo.length) return;
    setOpen(firstSurface(phase.spec));
  }, [phase.mode]);

  useEffect(() => {
    setNameDraft(spec.name ?? "");
  }, [spec.name]);

  const persist = async (next: WorkspaceSpec, nudge: boolean) => {
    try {
      await writeProposedWorkspace({
        spec: next,
        baseline: proposal.baseline,
        patches: proposal.patches,
        rationale: proposal.rationale,
        nudge_shown: nudge,
      });
      setSaveError(null);
    } catch {
      setSaveError("Kairos couldn't save that draft. Your current workspace is unchanged.");
    }
  };

  const applyName = (draft: string) => {
    const current = specRef.current;
    const hist = historyRef.current;
    const trimmed = draft.trim().slice(0, 80);
    if (trimmed === (current.name ?? "")) return { spec: current, history: hist };
    const result = pushPatch(current, hist, { op: "rename", name: trimmed }, capabilities);
    if (!result.ok) return { spec: current, history: hist };
    specRef.current = result.spec;
    historyRef.current = result.history;
    setPhase({ mode: "edit", spec: result.spec, history: result.history });
    void persist(result.spec, nudgeRef.current);
    return { spec: result.spec, history: result.history };
  };

  const edit = (result: { ok: true; spec: WorkspaceSpec; history: PatchHistory } | { ok: false; error: string }) => {
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    specRef.current = result.spec;
    historyRef.current = result.history;
    setPhase({ mode: "edit", spec: result.spec, history: result.history });
    void persist(result.spec, nudgeRef.current);
  };

  const skip = () => {
    setOpen(firstSurface(proposal.baseline));
    setPhase({ mode: "edit", spec: cloneSpec(proposal.baseline), history: emptyHistory() });
  };

  const move = (id: string, dir: -1 | 1) => {
    const slots = spec.surfaces[open]?.slots ?? [];
    const from = slots.indexOf(id);
    const index = from + dir;
    if (playing || from < 0 || index < 0 || index >= slots.length) return;
    edit(pushPatch(spec, history, { op: "reorder", surface: open, block_id: id, index }, capabilities));
  };

  const remove = (id: string) => {
    if (playing) return;
    edit(pushPatch(spec, history, { op: "remove", surface: open, block_id: id }, capabilities));
  };

  const add = (cap: WorkspaceCapability) => {
    if (playing || cap.availability === "optional_connector") return;
    const size = cap.sizes.includes("full") ? "full" : "half";
    edit(
      pushPatch(
        spec,
        history,
        {
          op: "place",
          surface: open,
          block_id: nextBlockId(spec),
          index: spec.surfaces[open]?.slots?.length ?? 0,
          block: { capability: cap.id, size, props: {}, visible_when: "always" },
        },
        capabilities,
      ),
    );
    setAdding(false);
  };

  const setDensity = (density: "comfortable" | "compact") => {
    if (playing) return;
    edit(pushPatch(spec, history, { op: "set_density", density }, capabilities));
  };

  const undo = () => {
    if (specRef.current === proposal.baseline && historyRef.current.undo.length === 0) return;
    const step = undoPatch(specRef.current, historyRef.current, capabilities);
    specRef.current = step.spec;
    historyRef.current = step.history;
    setPhase({ mode: "edit", spec: step.spec, history: step.history });
    void persist(step.spec, nudgeRef.current);
  };

  const redo = () => {
    const step = redoPatch(specRef.current, historyRef.current, capabilities);
    specRef.current = step.spec;
    historyRef.current = step.history;
    setPhase({ mode: "edit", spec: step.spec, history: step.history });
    void persist(step.spec, nudgeRef.current);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const useThis = async () => {
    if (playing) return;
    const named = applyName(nameDraft);
    const count = studentEditCount(named.history);
    if (count === 0 && !nudgeRef.current) {
      nudgeRef.current = true;
      setNudgeShown(true);
      setShowNudge(true);
      void persist(named.spec, true);
      return;
    }
    const now = new Date().toISOString();
    const edited = count > 0;
    // The provenance line counts the student's labour on this workspace, not in
    // this sitting, so a second visit adds to the count the way an accepted
    // amendment does (see specAfterAmendment).
    const before = named.spec.authorship;
    const renamedNow = (named.spec.name ?? "") !== (proposal.baseline.name ?? "");
    const next: WorkspaceSpec = {
      ...named.spec,
      status: "accepted",
      accepted_by: "student",
      accepted_at: now,
      authorship: {
        student_edits: (before?.student_edits ?? 0) + count,
        renamed: Boolean(before?.renamed) || renamedNow,
        last_edited_at: now,
      },
      origin: edited ? { ...(named.spec.origin ?? { kind: "edit" }), kind: "edit" } : named.spec.origin,
    };
    try {
      await commitAccepted(next);
      await discardProposedWorkspace();
      onClose();
    } catch {
      setSaveError("Kairos couldn't save that workspace. Nothing was changed.");
    }
  };

  const keep = async () => {
    try {
      await discardProposedWorkspace();
    } catch {
      setSaveError("Kairos couldn't set that draft aside. Your current workspace is unchanged.");
      return;
    }
    onClose();
  };

  const startOver = () => {
    if (playing) return;
    const next = cloneSpec(proposal.baseline);
    specRef.current = next;
    historyRef.current = emptyHistory();
    setPhase({ mode: "edit", spec: next, history: emptyHistory() });
    setNameDraft(next.name ?? "");
    void persist(next, nudgeRef.current);
  };

  const placedCaps = new Set(Object.values(spec.blocks).map((block) => block.capability));
  const total = Object.keys(spec.blocks).length;
  const choices = capabilities
    .filter((cap) => cap.surfaces.includes(open))
    .filter((cap) => cap.availability !== "optional_connector" || showsOptionalConnector(cap))
    .map((cap) => {
      const count = Object.values(spec.blocks).filter((block) => block.capability === cap.id).length;
      const room = count < cap.max_instances && (spec.surfaces[open]?.slots?.length ?? 0) < 6 && total < 24;
      const ready = cap.requires.every((id) => placedCaps.has(id));
      const connector = showsOptionalConnector(cap);
      return { cap, canAdd: !connector && room && ready, connector, count };
    })
    .filter((item) => (item.connector ? item.count < item.cap.max_instances : item.canAdd));

  const lastPlaced = playing ? [...stream.slice(0, phase.cursor)].reverse().find((patch) => patch.op === "place") : undefined;
  const landedId = lastPlaced && lastPlaced.op === "place" ? lastPlaced.block_id : null;
  const landedCap = landedId ? capabilities.find((cap) => cap.id === spec.blocks[landedId]?.capability) : undefined;
  const live = playing ? (landedCap ? `${landedCap.label} is in.` : "") : "Your workspace is ready to edit.";
  const diff = playing ? [] : describeSpecDiff(accepted, spec, capabilities);
  const slots = spec.surfaces[open]?.slots ?? [];
  const density = spec.density ?? "comfortable";

  return (
    <section className="studio" aria-labelledby="studio-title">
      <h1 id="studio-title">Design my workspace</h1>
      <p className="muted">Blocks land as they are added. Nothing here changes your workspace until you use it.</p>
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
      <div className="studio-name">
        <label htmlFor="workspace-name">Name</label>
        <input
          id="workspace-name"
          value={nameDraft}
          maxLength={80}
          disabled={playing}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => applyName(nameDraft)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            applyName(nameDraft);
          }}
        />
      </div>
      <fieldset className="segmented" aria-label="Density" disabled={playing}>
        <legend className="visually-hidden">Density</legend>
        {(["comfortable", "compact"] as const).map((value) => (
          <label key={value} className={density === value ? "on" : undefined}>
            <input type="radio" name="density" value={value} checked={density === value} onChange={() => setDensity(value)} />
            {value === "comfortable" ? "Comfortable" : "Compact"}
          </label>
        ))}
      </fieldset>
      <div className="studio-surfaces">
        {SURFACES.map((surface, index) => {
          const expanded = open === surface;
          const headerId = `studio-${surface}-header`;
          const panelId = `studio-${surface}-panel`;
          return (
            <section key={surface} className="studio-surface">
              <h2>
                <button
                  ref={(el) => {
                    headers.current[index] = el;
                  }}
                  id={headerId}
                  type="button"
                  className="studio-surface-header"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(surface)}
                  onKeyDown={(event) => moveFocus(event, index, SURFACES.length, (to) => headers.current[to]?.focus())}
                >
                  {SURFACE_LABEL[surface]}
                </button>
              </h2>
              {expanded && (
                <div id={panelId} role="region" aria-labelledby={headerId}>
                  <div role="list" aria-label={`${SURFACE_LABEL[surface]} blocks`}>
                    {(spec.surfaces[surface]?.slots ?? []).map((id, blockIndex) => {
                      const block = spec.blocks[id];
                      const cap = capabilities.find((item) => item.id === block?.capability);
                      const label = cap?.label ?? id;
                      const connector = showsOptionalConnector(cap);
                      const rationale = proposal.rationale[id];
                      return (
                        <div
                          key={id}
                          role="listitem"
                          tabIndex={focusId === id || (focusId === null && blockIndex === 0) ? 0 : -1}
                          aria-label={label}
                          className={id === landedId ? "studio-block is-new" : "studio-block"}
                          ref={(el) => {
                            blocks.current[blockIndex] = el;
                          }}
                          onKeyDown={(event) =>
                            moveFocus(event, blockIndex, slots.length, (to) => {
                              const next = spec.surfaces[surface]?.slots?.[to];
                              if (next) setFocusId(next);
                              blocks.current[to]?.focus();
                            })
                          }
                        >
                          <p className="studio-block-title">{label}</p>
                          {cap?.blurb && <p className="muted">{cap.blurb}</p>}
                          {rationale && <p>{rationale}</p>}
                          {connector && <p>{connectorWord(cap, spec)}</p>}
                          {!playing && (
                            <div className="studio-block-actions">
                              <button type="button" aria-label={`Move up ${label}`} disabled={blockIndex === 0} onClick={() => move(id, -1)}>
                                Move up
                              </button>
                              <button type="button" aria-label={`Move down ${label}`} disabled={blockIndex === slots.length - 1} onClick={() => move(id, 1)}>
                                Move down
                              </button>
                              <button type="button" className="link" aria-label={`Remove ${label}`} onClick={() => remove(id)}>
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!playing && (
                    <button type="button" onClick={() => setAdding(true)}>
                      Add a block
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {(spec.requested_integrations ?? []).length > 0 && (
        <section className="studio-asked" aria-label="Asked for">
          <h2>Asked for</h2>
          <ul>
            {(spec.requested_integrations ?? []).map((entry) => (
              <li key={`${entry.name ?? "tool"}-${entry.state ?? ""}`}>
                <span>{entry.name}</span>
                <span>{entry.state === "requested" ? "Requested" : "Not available"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.length > 0 && (
        <div className="studio-diff">
          {diff.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {showNudge && (
        <p role="status" className="studio-nudge">
          Move one thing so it's yours.
        </p>
      )}
      {saveError && (
        <p role="status" className="studio-nudge">
          {saveError}
        </p>
      )}
      <div className="studio-actions">
        {playing && (
          <button type="button" onClick={skip}>
            Skip
          </button>
        )}
        <button type="button" className="link" disabled={playing || history.undo.length === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" className="link" disabled={playing || history.redo.length === 0} onClick={redo}>
          Redo
        </button>
        <button type="button" className="primary" disabled={playing} onClick={() => void useThis()}>
          Use this
        </button>
        <button type="button" onClick={() => void keep()}>
          Keep what I have
        </button>
        <button type="button" className="link" disabled={playing} onClick={startOver}>
          Start over
        </button>
      </div>
      {adding && !playing && <AddSheet surface={open} spec={spec} items={choices} onAdd={add} onClose={() => setAdding(false)} />}
    </section>
  );
}

export function WorkspaceStudioScreen({
  accepted,
  loaded,
  onClose,
}: {
  accepted: WorkspaceSpec;
  loaded: boolean;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<ProposedWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void (async () => {
      try {
        const found = await readProposedWorkspace();
        if (!alive) return;
        if (found?.spec?.status === "proposed") {
          setDoc(normalizeProposal(found));
          return;
        }
        const created = proposalFromAccepted(accepted);
        await writeProposedWorkspace(created);
        if (alive) setDoc(created);
      } catch {
        if (alive) setError("Kairos couldn't open that draft. Your current workspace is unchanged.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loaded, accepted]);
  if (!loaded || (!doc && !error)) return <p className="muted">Opening your workspace.</p>;
  if (error || !doc) return <p role="status">{error ?? "Kairos couldn't open that draft. Your current workspace is unchanged."}</p>;
  return <WorkspaceStudio accepted={accepted} proposal={doc} onClose={onClose} />;
}
