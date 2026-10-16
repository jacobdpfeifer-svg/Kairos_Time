import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { briefs as briefApi } from "../study/api";
import { AssignmentBriefView } from "./AssignmentBrief";
import { BriefCalibration } from "./BriefCalibration";
import { BriefIslandList } from "./BriefIslandList";
import { CalendarBody, OperationsIslands } from "./OperationsIsland";
import {
  isBrief,
  readAssignmentBrief,
  readBriefPrefs,
  readMissionControl,
  recordBriefFeedback,
  setMissionControlSelection,
  writeBriefPrefs,
  type BriefRead,
} from "./api";
import type { AssignmentBrief, AssignmentIsland, BriefAction, BriefPreferences, MissionControlSurface, OperationsIsland } from "./contracts";

/*
 * Mission Control (Today): operations islands when there is something to
 * review, then the 4–6 brief islands, then the way to the rest of the week.
 * One island open at a time. The brief the student is reading is held here
 * and never swapped under them: a newer version is offered, not imposed.
 */

const VISIT_KEY = "mc_first_open_day";
const COMPACT = "(max-width: 720px)";

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(COMPACT).matches
      : false
  ));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COMPACT);
    const on = () => setCompact(query.matches);
    on();
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, []);
  return compact;
}

/** The first island opens by itself once per day; after that the student's choice stands. */
function firstOpenToday(today: string): boolean {
  try {
    if (sessionStorage.getItem(VISIT_KEY) === today) return false;
    sessionStorage.setItem(VISIT_KEY, today);
  } catch {
    /* private mode: treat as a new visit */
  }
  return true;
}

export function MissionControlView({
  surface: surfaceProp,
  loadBrief = readAssignmentBrief,
  refreshKey = 0,
  openAssignmentId = null,
  enrichEnabled = true,
  onStudy,
  onAsk,
  onOpenWeek,
  onOpenUrl,
  onLead,
  onIslands,
  now = new Date(),
}: {
  surface?: MissionControlSurface;
  loadBrief?: (courseId: string, assignmentId: string) => Promise<BriefRead>;
  refreshKey?: number;
  /** Deep link or ⌘K: open this assignment's island. */
  openAssignmentId?: string | null;
  enrichEnabled?: boolean;
  onStudy: (tickId: string | null) => void;
  onAsk: () => void;
  onOpenWeek?: () => void;
  onOpenUrl: (url: string) => void;
  /** The first island's title, for the menu bar "next". */
  onLead?: (title: string) => void;
  /** Assignment ids with a brief, so a deep link can fall back to the item sheet. */
  onIslands?: (assignmentIds: string[]) => void;
  now?: Date;
}) {
  const [loaded, setLoaded] = useState<MissionControlSurface | null>(surfaceProp ?? null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [held, setHeld] = useState<Record<string, AssignmentBrief>>({});
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [blockFor, setBlockFor] = useState<string | null>(null);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [enrichNote, setEnrichNote] = useState<Record<string, string>>({});
  const fetchGen = useRef<Record<string, number>>({});
  const [prefs, setPrefs] = useState<BriefPreferences | null>(null);
  const compact = useCompact();

  useEffect(() => {
    if (surfaceProp) {
      setLoaded(surfaceProp);
      return;
    }
    let alive = true;
    readMissionControl(now)
      .then((s) => {
        if (!alive) return;
        setLoaded(s);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceProp, refreshKey, reload]);

  useEffect(() => {
    void readBriefPrefs()
      .then(setPrefs)
      .catch(() => undefined);
  }, []);

  const surface = loaded;
  const islands = useMemo(() => surface?.assignments ?? [], [surface]);

  // Initial open island: a deep link, else today's remembered choice, else the first on a new day.
  useEffect(() => {
    if (!surface || initialized) return;
    const byAssignment = (id: string | null | undefined) => islands.find((i) => i.assignment_id === id);
    const pick =
      byAssignment(openAssignmentId) ??
      byAssignment(surface.selected_assignment_id) ??
      // Inline only: at a narrow width that would be a sheet over the page on load.
      (islands.length && !compact && firstOpenToday(surface.today) ? islands[0] : undefined);
    setExpanded(pick?.island_id ?? null);
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, islands, initialized, openAssignmentId]);

  useEffect(() => {
    if (!openAssignmentId || !initialized) return;
    const hit = islands.find((i) => i.assignment_id === openAssignmentId);
    if (hit) setExpanded(hit.island_id);
  }, [openAssignmentId, initialized, islands]);

  useEffect(() => {
    if (!surface) return;
    onLead?.(islands[0]?.title ?? "");
    onIslands?.(islands.map((i) => i.assignment_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [islands, surface]);

  const fetchBrief = useCallback(
    (island: AssignmentIsland) => {
      const gen = (fetchGen.current[island.island_id] ?? 0) + 1;
      fetchGen.current[island.island_id] = gen;
      void loadBrief(island.course_id, island.assignment_id)
        .then((r) => {
          if (fetchGen.current[island.island_id] !== gen) return;
          if (isBrief(r)) {
            setHeld((h) => ({ ...h, [island.island_id]: r }));
            setMissing((m) => {
              const { [island.island_id]: _, ...rest } = m;
              return rest;
            });
          } else setMissing((m) => ({ ...m, [island.island_id]: r.error }));
        })
        .catch(() => {
          if (fetchGen.current[island.island_id] !== gen) return;
          setMissing((m) => ({ ...m, [island.island_id]: "unreadable" }));
        });
    },
    [loadBrief]
  );

  // Load a brief the first time its island opens; keep it while the student reads.
  useEffect(() => {
    const island = islands.find((i) => i.island_id === expanded);
    if (island && !held[island.island_id] && !missing[island.island_id]) fetchBrief(island);
  }, [expanded, islands, held, missing, fetchBrief]);

  const forgetMiss = (islandId: string) => {
    setMissing((m) => {
      if (!m[islandId]) return m;
      const { [islandId]: _, ...rest } = m;
      return rest;
    });
  };

  const toggle = (island: AssignmentIsland, open: boolean) => {
    setExpanded(open ? island.island_id : null);
    setBlockFor(null);
    if (open) forgetMiss(island.island_id);
    void setMissionControlSelection(open ? island.assignment_id : null, now).catch(() => undefined);
  };

  const onAction = (brief: AssignmentBrief, action: BriefAction) => {
    switch (action.kind) {
      case "study":
        onStudy(action.target ?? null);
        return;
      case "open_canvas":
      case "open_source":
        if (action.target) onOpenUrl(action.target);
        return;
      case "ask":
        onAsk();
        return;
      case "calendar_preview":
        setBlockFor(blockFor === brief.id ? null : brief.id);
        return;
      default:
        return; // email_draft lives in the email island
    }
  };

  const enrich = async (island: AssignmentIsland, brief: AssignmentBrief) => {
    setEnriching(island.island_id);
    setEnrichNote((n) => {
      const { [island.island_id]: _, ...rest } = n;
      return rest;
    });
    const note = (text: string) => setEnrichNote((n) => ({ ...n, [island.island_id]: text }));
    try {
      const r = await briefApi.enrich(brief.course_id, brief.assignment_id);
      if (!r.enrichment) note(r.status === "abstained" ? "There wasn't enough in your course materials for more." : "No fuller brief this time. Nothing was changed.");
      fetchBrief(island);
    } catch (e) {
      note(e instanceof Error ? e.message : "AI help isn't available right now.");
    } finally {
      setEnriching(null);
    }
  };

  const blockIsland = (brief: AssignmentBrief): OperationsIsland | null => {
    const due = Date.parse(brief.due_at ?? "");
    if (!Number.isFinite(due)) return null;
    // 90 minutes, the day before it's due (the same rule as the dashboard's study blocks).
    const start = Math.max(due - 26 * 3_600_000, now.getTime() + 3_600_000);
    if (start + 90 * 60_000 > due) return null;
    return {
      kind: "calendar",
      island_id: `block-${brief.id}`,
      title: "Study block",
      summary: "",
      state: "ready",
      action: { id: "add", label: "Add to calendar", kind: "calendar_preview", availability: "available" },
      calendar: {
        suggestion_id: `block:${brief.course_id}:${brief.assignment_id}`,
        summary: `Work on ${brief.title}`,
        start: new Date(start).toISOString(),
        end: new Date(start + 90 * 60_000).toISOString(),
        why: `Due ${new Date(due).toLocaleDateString(undefined, { weekday: "long" })}`,
        course_color: brief.course_color,
      },
    };
  };

  const renderBrief = (island: AssignmentIsland, headingId: string) => {
    const brief = held[island.island_id];
    if (!brief) {
      const err = missing[island.island_id];
      if (!err) return <p className="muted">Opening the brief…</p>;
      return (
        <p className="muted">
          {err === "malformed"
            ? "This brief file couldn't be read. It will be rebuilt on the next sync."
            : "This brief isn't ready. It's prepared after the next sync."}{" "}
          <button type="button" className="link" onClick={() => fetchBrief(island)}>
            Retry
          </button>
        </p>
      );
    }
    const block = blockFor === brief.id ? blockIsland(brief) : null;
    return (
      <>
        <AssignmentBriefView
          brief={brief}
          headingId={headingId}
          now={now}
          updated={
            brief.source_fingerprint !== island.source_fingerprint
            || brief.state !== island.brief_state
            || brief.priority_reason !== island.priority_reason
          }
          onShowUpdated={() => fetchBrief(island)}
          onAction={(a) => onAction(brief, a)}
          onOpenUrl={onOpenUrl}
          onFeedback={(outcome) => void recordBriefFeedback(brief.kind, outcome, now).catch(() => undefined)}
          onEnrich={enrichEnabled ? () => void enrich(island, brief) : undefined}
          enriching={enriching === island.island_id}
        />
        {enrichNote[island.island_id] && enriching !== island.island_id && (
          <p className="muted" role="status">{enrichNote[island.island_id]}</p>
        )}
        {blockFor === brief.id &&
          (block ? (
            <CalendarBody island={block} onDone={() => setReload((n) => n + 1)} />
          ) : (
            <p className="muted" role="status">
              There's no time left before it's due for a study block.
            </p>
          ))}
      </>
    );
  };

  if (failed && !surface) {
    return (
      <p role="alert" className="today-error">
        Couldn't read your briefs.{" "}
        <button type="button" className="link" onClick={() => setReload((n) => n + 1)}>
          Try again
        </button>
      </p>
    );
  }
  if (!surface) return <p className="muted">Loading your briefs…</p>;
  if (!surface.prepared) return <p className="today-empty">Your briefs are prepared after the first Canvas sync.</p>;

  const showCalibration = Boolean(prefs && !prefs.calibrated && islands.length > 0);

  return (
    <div className="mission-control">
      {surface.briefs_error && <p className="muted" role="status">{surface.briefs_error}</p>}
      <OperationsIslands islands={surface.operations} onChanged={() => setReload((n) => n + 1)} />

      {islands.length === 0 ? (
        <div className="home-focus today-focus">
          <h2 className="home-statement">Nothing due that needs a brief.</h2>
          <p className="home-when">Kairos will say when something lands in Canvas.</p>
        </div>
      ) : (
        <section aria-labelledby="mc-heading">
          <h2 id="mc-heading" className="today-section-title">
            {islands[0].focus ? "Today is about this" : "Up next"}
          </h2>
          <BriefIslandList islands={islands} expandedId={expanded} onToggle={toggle} renderBrief={renderBrief} compact={compact} now={now} />
        </section>
      )}

      {onOpenWeek && (surface.rest_count > 0 || islands.length > 0) && (
        <button type="button" className="link mc-rest" onClick={onOpenWeek}>
          {surface.rest_count > 0 ? `See the rest in Week (${surface.rest_count} more)` : "See the whole week"}
        </button>
      )}

      {showCalibration && prefs && (
        <BriefCalibration
          prefs={prefs}
          onSave={(next) => {
            setPrefs(next);
            void writeBriefPrefs(next)
              .then(setPrefs)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
