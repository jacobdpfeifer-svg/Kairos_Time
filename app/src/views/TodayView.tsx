// Purpose: today page over mission control
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CourseMap, FreshnessChange, GradeTruth, SemesterSurface, SemesterTick, SyncHealth } from "../ipc";
import {
  onFreshnessUpdated,
  onInboxUpdated,
  onSyncFailed,
  openExternalUrl,
  readCourseMap,
  readFreshness,
  readGradeTruth,
  readSemester,
  readSkipCosts,
  readSyncHealth,
  setTrayNext,
} from "../ipc";
import { onPlanChanged, weekPlan } from "../week/api";
import { addDays, dayKey, dayLabel, type Capture } from "../week/plan";
import { SyncHealthBanner } from "../components/SyncHealthBanner";
import { ItemSheet } from "../components/ItemSheet";
import { SemesterLine } from "../components/SemesterLine";
import { consequenceSentence, skipCostFor, type SkipCosts } from "../consequence";
import type { AskEnvelope } from "../study/types";
import { MissionControlView } from "../missionControl/MissionControlView";
import type { MissionControlSurface } from "../missionControl/contracts";
import type { BriefRead } from "../missionControl/api";

/*
 * Today is Mission Control (docs/handoff/mission-control-assignment-briefs-
 * architecture-2026-10-15.md): the date, sync health, the operations and
 * brief islands, one line for what changed in Canvas, the student's own rows,
 * then the semester line. Ranking, exam-week focus, and briefs are prepared
 * locally by the brief assembler; this view only renders them.
 */

const SEEN_KEY = "pn_changes_seen_at";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

function loadSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function changeTime(c: FreshnessChange): number {
  return Date.parse(c.detected_at || c.at || "") || 0;
}

export function TodayView({
  surface: surfaceProp,
  mission,
  loadBrief,
  health: healthProp,
  map: mapProp,
  grades: gradesProp,
  skipCosts: costsProp,
  changes: changesProp,
  captures: capturesProp,
  lastAsk,
  openItem,
  onStudy,
  onAsk,
  onOpenWeek,
}: {
  surface?: SemesterSurface;
  /** Tests pass the Mission Control surface; the live app reads the brief projection. */
  mission?: MissionControlSurface;
  loadBrief?: (courseId: string, assignmentId: string) => Promise<BriefRead>;
  health?: SyncHealth;
  map?: CourseMap;
  grades?: GradeTruth;
  skipCosts?: SkipCosts;
  changes?: FreshnessChange[];
  /** Rows the student typed. Tests pass them in; the live app reads the week plan. */
  captures?: Capture[];
  lastAsk?: AskEnvelope | null;
  /** Deep link or ⌘K: open this item's brief (or its sheet) on arrival. */
  openItem?: { courseId?: string; itemId: string } | null;
  /** A semester tick id (exam track), or null for Study's front page. */
  onStudy: (target: { id: string } | null) => void;
  onAsk: (initial?: AskEnvelope | null) => void;
  onOpenWeek?: () => void;
}) {
  const [loaded, setLoaded] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [popup, setPopup] = useState<SemesterTick | null>(null);
  const [health, setHealth] = useState<SyncHealth | null>(healthProp ?? null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string>("");
  const [map, setMap] = useState<CourseMap | null>(mapProp ?? null);
  const [grades, setGrades] = useState<GradeTruth | null>(gradesProp ?? null);
  const [costs, setCosts] = useState<SkipCosts>(costsProp ?? {});
  const [changes, setChanges] = useState<FreshnessChange[]>(changesProp ?? []);
  const [loadedCaptures, setLoadedCaptures] = useState<Capture[]>([]);
  const [seenAt, setSeenAt] = useState<number>(loadSeen);
  const [showChanges, setShowChanges] = useState(false);
  // Bumped when a Canvas sync, a freshness tick, or a brief rebuild finishes.
  const [synced, setSynced] = useState(0);
  const live = !surfaceProp;

  useEffect(() => {
    if (!live) return;
    const subs = [
      onInboxUpdated(() => {
        setSyncFailure(null);
        setSynced((n) => n + 1);
      }),
      onFreshnessUpdated(() => setSynced((n) => n + 1)),
      onSyncFailed((message) => setSyncFailure(message || "Try Sync now.")),
    ];
    return () => {
      for (const sub of subs) void sub.then((fn) => fn());
    };
  }, [live]);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    readSemester("1m", new Date().toISOString())
      .then((s) => alive && setLoaded(s))
      .catch(() => undefined);
    readSyncHealth()
      .then((h) => alive && setHealth(h))
      .catch(() => undefined);
    readSkipCosts()
      .then((c) => alive && setCosts(c || {}))
      .catch(() => undefined);
    readFreshness()
      .then((d) => alive && setChanges(d?.changes ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [live, synced]);

  useEffect(() => {
    if (!live || capturesProp) return;
    let alive = true;
    const load = () => {
      void weekPlan("show")
        .then((r) => alive && setLoadedCaptures(r.items))
        .catch(() => undefined);
    };
    load();
    const stop = onPlanChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [live, capturesProp, synced]);

  useEffect(() => {
    if (healthProp) setHealth(healthProp);
  }, [healthProp]);

  // The course map and grade truth follow whichever item the student opened.
  useEffect(() => {
    if (mapProp || !courseId || !health?.surfaces_enabled) return;
    let alive = true;
    readCourseMap(courseId)
      .then((m) => alive && setMap(m))
      .catch(() => undefined);
    readGradeTruth(courseId)
      .then((g) => alive && setGrades(g))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, health, mapProp]);

  const surface = surfaceProp ?? loaded;
  const today = useMemo(() => new Date(Date.parse(surface?.today || "") || Date.now()), [surface?.today]);
  const ticks = useMemo(() => (surface ? surface.courses.flatMap((c) => c.ticks) : []), [surface]);
  const fresh = changes.filter((c) => changeTime(c) > seenAt);
  const freshSig = fresh.map((c) => c.key).join("|");
  const seenFresh = useRef<string | null>(null);
  const changesRef = useRef<HTMLElement | null>(null);
  const [settleKey, setSettleKey] = useState(0);
  useEffect(() => {
    if (!freshSig) return;
    if (seenFresh.current === null) {
      seenFresh.current = freshSig;
      return;
    }
    if (seenFresh.current === freshSig) return;
    seenFresh.current = freshSig;
    // The settle needs a fresh element for @starting-style, which means a
    // remount. A sync is a background event, so it may not take the keyboard
    // out of a list the student is reading: when focus is in here, the new
    // rows simply appear.
    const node = changesRef.current;
    if (node && node.contains(document.activeElement)) return;
    setSettleKey((n) => n + 1);
  }, [freshSig]);
  const hasCourses = Boolean(surface && surface.courses.length > 0);

  const openTick = (tick: SemesterTick) => {
    if (tick.course_id !== courseId) setCourseId(tick.course_id);
    setPopup(tick);
  };

  // Deep links and ⌘K: a brief island if the item has one; otherwise its sheet.
  const openAssignmentId = openItem ? openItem.itemId.replace(/^item-/, "") : null;
  const [briefIds, setBriefIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!openItem || !surface || briefIds === null) return;
    if (openAssignmentId && briefIds.includes(openAssignmentId)) return;
    const hit = ticks.find((t) => t.id === openItem.itemId && (!openItem.courseId || t.course_id === openItem.courseId));
    if (hit) openTick(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItem, surface, briefIds]);

  const markSeen = () => {
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      /* not remembered in private mode */
    }
  };

  const captures = capturesProp ?? loadedCaptures;
  const todayKey = dayKey(today);
  const captureOn = (c: Capture) => {
    if (c.day) return c.day;
    if (!c.due_at) return todayKey;
    const parsed = new Date(c.due_at);
    return Number.isNaN(parsed.getTime()) ? todayKey : dayKey(parsed);
  };
  const addedWeek = captures.filter((c) => {
    if (c.done_at) return false;
    const day = captureOn(c);
    return day >= todayKey && day < addDays(todayKey, 7);
  });

  const onLead = useCallback((title: string) => void setTrayNext(title), []);

  return (
    <section className="today scene-paper" aria-labelledby="today-heading">
      <header className="today-head">
        <h1 id="today-heading" className="today-date">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </h1>
        <p className="today-greeting">{greeting(new Date())}</p>
      </header>

      <SyncHealthBanner
        health={health}
        failure={syncFailure}
        inspectUrl={map?.course?.html_url}
        onSynced={() => setSynced((n) => n + 1)}
      />

      <MissionControlView
        surface={mission}
        loadBrief={loadBrief}
        refreshKey={synced}
        openAssignmentId={openAssignmentId}
        onStudy={(id) => onStudy(id ? { id } : null)}
        onAsk={() => onAsk()}
        onOpenWeek={onOpenWeek}
        onOpenUrl={(url) => void openExternalUrl(url)}
        onLead={onLead}
        onIslands={(ids) => setBriefIds(ids)}
        now={today}
      />

      {fresh.length > 0 && (
        <section key={settleKey} ref={changesRef} className="today-changes" aria-labelledby="changes-heading">
          <div className="today-line-row">
            <h2 id="changes-heading" className="today-row-title">
              {fresh.length === 1 ? "1 thing changed in Canvas" : `${fresh.length} things changed in Canvas`} since you last looked.
            </h2>
            {onOpenWeek ? (
              <button
                type="button"
                onClick={() => {
                  markSeen();
                  onOpenWeek();
                }}
              >
                See what changed
              </button>
            ) : (
              <button type="button" aria-expanded={showChanges} onClick={() => setShowChanges((v) => !v)}>
                {showChanges ? "Hide" : "See what changed"}
              </button>
            )}
          </div>
          {showChanges && (
            <>
              <ChangeRows changes={fresh} />
              <button type="button" className="link" onClick={markSeen}>
                Mark these as seen
              </button>
            </>
          )}
        </section>
      )}

      {lastAsk?.response && (
        <div className="today-line-row today-last-ask">
          <p className="today-row-title">
            <span className="muted">Your last question: </span>
            {lastAsk.response.one_sentence}
          </p>
          <button type="button" onClick={() => onAsk(lastAsk)}>
            Open
          </button>
        </div>
      )}

      {addedWeek.length > 0 && (
        <section className="today-week" aria-labelledby="added-heading">
          <h2 id="added-heading" className="today-section-title">
            You added
          </h2>
          <ul className="rows">
            {addedWeek.slice(0, 6).map((c) => (
              <li key={c.id}>
                <button type="button" className="row" onClick={() => onOpenWeek?.()}>
                  <span className="row-main">
                    <strong>{c.title}</strong>
                    <span className="row-meta">{c.course ?? "Your list"}</span>
                  </span>
                  <span className="row-when">{dayLabel(captureOn(c), todayKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasCourses && <SemesterLine surface={surfaceProp} synced={synced} onOpen={openTick} />}

      {popup && (
        <ItemSheet
          tick={popup}
          today={today}
          map={map && (!map.course?.id || map.course.id === popup.course_id) ? map : null}
          grades={grades}
          consequence={consequenceSentence(skipCostFor(costs, popup), popup.course_label)}
          onClose={() => setPopup(null)}
          onPlan={() => {
            onStudy(popup);
            setPopup(null);
          }}
        />
      )}
    </section>
  );
}

export function ChangeRows({ changes, now = Date.now() }: { changes: FreshnessChange[]; now?: number }) {
  return (
    <ul className="rows change-rows">
      {changes.map((c) => (
        <li key={c.key} data-flip={c.key}>
          <div className="row">
            <span className="row-main">
              {c.url ? (
                <button type="button" className="link row-title" onClick={() => void openExternalUrl(c.url as string)}>
                  {c.title}
                </button>
              ) : (
                <strong className="row-title">{c.title}</strong>
              )}
              <span className="row-meta">
                {c.label}
                {c.course ? `, ${c.course}` : ""}
              </span>
            </span>
            <span className="row-when">{relativeAgo(c.at || c.detected_at, now)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function relativeAgo(iso: string | null | undefined, now: number): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const minutes = Math.round((now - t) / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}
