import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { friendlyRelative } from "../format";
import { useDialog } from "../components/useDialog";
import type { AssignmentIsland, BriefKind } from "./contracts";

/*
 * Brief islands: a single-expand accordion (WAI-ARIA APG), not tabs. Each
 * header is a native button inside a heading with aria-expanded and
 * aria-controls; Enter/Space toggles, Up/Down/Home/End move between headers
 * only, Tab enters the open brief. At compact widths the brief opens as the
 * focus-managed sheet and focus returns to its island on close.
 */

export const KIND_LABEL: Record<BriefKind, string> = {
  exam: "Exam",
  quiz: "Quiz",
  math: "Problem set",
  writing: "Paper",
  project: "Project",
  lab: "Lab",
  reading: "Reading",
  discussion: "Discussion",
  assignment: "Assignment",
  unknown: "Assignment",
};

/** Text first, never color alone. */
export function islandStatus(island: AssignmentIsland): string | null {
  if (island.state === "needs_attention") return "Past due";
  if (island.state === "changed") return "Changed";
  if (island.state === "stale" || island.brief_state === "stale") return "May be out of date";
  if (island.brief_state === "needs_source") return "Needs a source";
  return null;
}

function BriefSheet({ titleId, title, onClose, children }: { titleId: string; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} className="sheet mc-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId} className="mc-sheet-title">
          {title}
        </h3>
        {children}
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function BriefIslandList({
  islands,
  expandedId,
  onToggle,
  renderBrief,
  compact = false,
  now = new Date(),
}: {
  islands: AssignmentIsland[];
  expandedId: string | null;
  onToggle: (island: AssignmentIsland, open: boolean) => void;
  renderBrief: (island: AssignmentIsland, headingId: string) => ReactNode;
  /** Narrow window: the brief opens as a sheet instead of inline. */
  compact?: boolean;
  now?: Date;
}) {
  const headers = useRef<(HTMLButtonElement | null)[]>([]);
  const focusMode = islands[0]?.focus === true;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = islands.length;
    const to = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    headers.current[to]?.focus();
  };

  return (
    <ol className={`mc-islands${focusMode ? " mc-focus-mode" : ""}`}>
      {islands.map((island, i) => {
        const open = expandedId === island.island_id;
        const headerId = `${island.island_id}-header`;
        const panelId = `${island.island_id}-panel`;
        const status = islandStatus(island);
        const quiet = focusMode && i > 0;
        return (
          <li
            key={island.island_id}
            className={`mc-island${open ? " is-open" : ""}${quiet ? " is-quiet" : ""}`}
            data-state={island.state}
            style={{ ["--course" as string]: island.course_color }}
          >
            <h3 className="mc-island-heading">
              <button
                ref={(el) => {
                  headers.current[i] = el;
                }}
                id={headerId}
                type="button"
                className="mc-island-header"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggle(island, !open)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="course-dot" aria-hidden="true" />
                <span className="mc-island-main">
                  <span className="mc-island-title">{island.title}</span>
                  <span className="row-meta">
                    {island.course_label}, {KIND_LABEL[island.assignment_kind].toLowerCase()}
                    {!quiet && <>. {island.priority_reason}</>}
                  </span>
                </span>
                <span className="mc-island-side">
                  {status && <span className="mc-status">{status}</span>}
                  <span className="row-when">{island.due_at ? friendlyRelative(island.due_at, now) : "No date"}</span>
                </span>
              </button>
            </h3>
            {open && !compact && (
              <div id={panelId} role="region" aria-labelledby={headerId} className="mc-island-panel">
                {renderBrief(island, headerId)}
              </div>
            )}
            {open && compact && (
              <BriefSheet titleId={panelId} title={island.title} onClose={() => onToggle(island, false)}>
                {renderBrief(island, panelId)}
              </BriefSheet>
            )}
          </li>
        );
      })}
    </ol>
  );
}
