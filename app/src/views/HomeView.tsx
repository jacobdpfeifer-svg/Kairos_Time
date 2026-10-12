import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SemesterSurface, SemesterTick, CourseMap, FreshnessChange, GradeTruth, SyncHealth } from "../ipc";
import {
  onFreshnessUpdated,
  onInboxUpdated,
  openExternalUrl,
  readCourseMap,
  readFreshness,
  readGradeTruth,
  readSemester,
  readSyncHealth,
} from "../ipc";
import { ChangesLedger } from "../components/ChangesLedger";
import { SyncHealthBanner } from "../components/SyncHealthBanner";
import { clusterTicks, kindLabel, loadRange, saveRange, tickHeightPx, type RangeId } from "../semesterTicks";
import { rankOpenWork } from "../ask/rank";
import { AskPanel } from "../ask/AskPanel";
import { friendlyDue, friendlyRelative, friendlyWhen } from "../format";
import { study } from "../study/api";
import type { AskEnvelope } from "../study/types";

/*
 * Home (MASTER §10): the date as the page heading, the one most important item
 * in the highlighted focus block, a short "Next up" list beside it, then the
 * semester line and what changed in Canvas. Start/Learn/Do/Check lives in the item sheet.
 */

const RANGES: { id: RangeId; label: string }[] = [
  { id: "1m", label: "1 month" },
  { id: "2m", label: "2 months" },
  { id: "3m", label: "3 months" },
  { id: "full", label: "Full semester" },
];

export function HomeView({
  surface: surfaceProp,
  onExamPrep,
  health: healthProp,
  map: mapProp,
  grades: gradesProp,
}: {
  surface?: SemesterSurface;
  onExamPrep: (tick: SemesterTick) => void;
  health?: SyncHealth;
  map?: CourseMap;
  grades?: GradeTruth;
}) {
  const [range, setRange] = useState<RangeId>(loadRange);
  const [loaded, setLoaded] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [hover, setHover] = useState<{ tick: SemesterTick; x: number; y: number } | null>(null);
  const [popup, setPopup] = useState<SemesterTick | null>(null);
  const [health, setHealth] = useState<SyncHealth | null>(healthProp ?? null);
  const [courseId, setCourseId] = useState<string>("");
  const [map, setMap] = useState<CourseMap | null>(mapProp ?? null);
  const [grades, setGrades] = useState<GradeTruth | null>(gradesProp ?? null);
  const [changes, setChanges] = useState<FreshnessChange[]>([]);
  const [activeAsk, setActiveAsk] = useState<AskEnvelope | null>(null);
  const [askActive, setAskActive] = useState(false);
  const axis = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  // Bumped when a Canvas sync finishes (first-run background read, cadence, tray).
  const [synced, setSynced] = useState(0);

  useEffect(() => {
    if (surfaceProp) return;
    const unlisten = onInboxUpdated(() => setSynced((n) => n + 1));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [surfaceProp]);

  useEffect(() => {
    saveRange(range);
  }, [range]);

  useEffect(() => {
    if (surfaceProp) {
      setLoaded(surfaceProp);
      return;
    }
    const today = new Date().toISOString();
    void readSemester(range, today).then(setLoaded);
  }, [range, surfaceProp, synced]);

  useEffect(() => {
    if (healthProp) {
      setHealth(healthProp);
      return;
    }
    if (surfaceProp) return;
    void readSyncHealth().then(setHealth);
  }, [healthProp, surfaceProp, synced]);

  // What changed in Canvas: refreshed whenever the daemon's freshness tick finds news.
  useEffect(() => {
    if (surfaceProp) return;
    let alive = true;
    const load = () => void readFreshness().then((d) => alive && setChanges(d?.changes ?? []));
    load();
    const unlisten = onFreshnessUpdated(load);
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [surfaceProp]);

  // The course map follows whichever tick the student opened.
  useEffect(() => {
    if (mapProp) return;
    if (!health?.surfaces_enabled) return;
    const id = courseId || loaded?.courses[0]?.id;
    if (!id) return;
    if (!courseId) setCourseId(id);
    void readCourseMap(id).then(setMap);
    void readGradeTruth(id).then(setGrades);
  }, [courseId, loaded, health, mapProp]);

  useEffect(() => {
    if (surfaceProp) return;
    let alive = true;
    void (async () => {
      try {
        const promoted = await study.askPending();
        const current = promoted.ask ? promoted : await study.askCurrent();
        if (alive && current.ask) setActiveAsk(current);
      } catch {
        /* The ranked due item still shows when the study bridge is down. */
      }
    })();
    return () => {
      alive = false;
    };
  }, [surfaceProp]);

  useLayoutEffect(() => {
    const el = axis.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    ro.observe(el);
    setWidth(el.clientWidth || 640);
    return () => ro.disconnect();
  }, [loaded]);

  const surface = surfaceProp ?? loaded;
  const todayMs = Date.parse(surface?.today || new Date().toISOString());
  const today = new Date(todayMs);
  const ranked = surface ? rankOpenWork(surface.courses.flatMap((c) => c.ticks)) : { recommendation: null, alternatives: [] };
  const lead = ranked.recommendation;
  const rail = lead ? ranked.alternatives : [];
  const hasCourses = Boolean(surface && surface.courses.length > 0);
  const askOpen = askActive || Boolean(activeAsk?.response);

  const openTick = (tick: SemesterTick) => {
    if (!mapProp && tick.course_id !== courseId) setCourseId(tick.course_id);
    setPopup(tick);
  };

  return (
    <section className="home scene-paper" aria-labelledby="home-heading">
      <header className="home-index">
        <h1 id="home-heading" className="visually-hidden">
          Home
        </h1>
        <p className="home-date">{new Date(todayMs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
        <fieldset className="segmented home-range" aria-label="Time range">
          {RANGES.map((r) => (
            <label key={r.id} className={range === r.id ? "on" : undefined}>
              <input type="radio" name="range" value={r.id} checked={range === r.id} onChange={() => setRange(r.id)} />
              {r.label}
            </label>
          ))}
        </fieldset>
      </header>

      <SyncHealthBanner health={health} inspectUrl={map?.course?.html_url} />

      <div className="home-stage">
        <div className="home-subject">
          {!surface && <p className="muted">Loading…</p>}
          {!askOpen && surface && !hasCourses && (
            <p className="home-statement display">
              No courses yet.
            </p>
          )}
          {!askOpen && hasCourses && lead && lead.due_at && (
            <div className="home-focus" style={{ ["--course" as string]: lead.color }}>
              <span className="kind-badge">
                {lead.course_label}, {kindLabel(lead.kind).toLowerCase()}
              </span>
              <button type="button" className="home-statement" onClick={() => openTick(lead)}>
                {lead.title}
              </button>
              <p className="home-when">Due {friendlyDue(lead.due_at, today)}</p>
            </div>
          )}
          {!askOpen && hasCourses && !lead && (
            <p className="home-statement display">Nothing due in this window.</p>
          )}
          <AskPanel initial={activeAsk} onResult={setActiveAsk} onActive={setAskActive} />
        </div>

        {!askOpen && rail.length > 0 && (
          <aside className="next-rail" aria-label="Next up">
            <h2>Next up</h2>
            <ol>
              {rail.map((t) => (
                <li key={t.id} style={{ ["--course" as string]: t.color }}>
                  <button type="button" onClick={() => openTick(t)}>
                    <strong>{t.title}</strong>
                    <span className="rail-when">{t.due_at ? friendlyRelative(t.due_at, today) : "No date"}</span>
                    <span className="rail-meta">
                      <span className="course-dot" aria-hidden="true" />
                      {t.course_label}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>

      {hasCourses && surface && (
        <h2 className="semester-title">The rest of the semester</h2>
      )}
      {hasCourses && surface && (
        <div className="semester bleed" ref={axis}>
          <TodayLine start={surface.window_start} end={surface.window_end} today={surface.today} />
          {surface.courses.map((course) => (
            <CourseRow
              key={course.id}
              label={course.label}
              color={course.color}
              inferred={course.term.source === "inferred"}
              clusters={clusterTicks(course.ticks, surface.window_start, surface.window_end, width)}
              todayMs={todayMs}
              onHover={(tick, el) => {
                const r = el.getBoundingClientRect();
                setHover({ tick, x: r.left + r.width / 2, y: r.top });
              }}
              onLeave={() => setHover(null)}
              onOpen={openTick}
            />
          ))}
        </div>
      )}

      <ChangesLedger changes={changes} />

      {hover && <TickBubble tick={hover.tick} x={hover.x} y={hover.y} />}
      {popup && (
        <ItemSheet
          tick={popup}
          today={today}
          map={map && (!map.course?.id || map.course.id === popup.course_id) ? map : null}
          grades={grades}
          onClose={() => setPopup(null)}
          onPlan={() => {
            onExamPrep(popup);
            setPopup(null);
          }}
        />
      )}
    </section>
  );
}

function CourseMapLedger({ map, grades }: { map: CourseMap; grades: GradeTruth | null }) {
  const lead = grades?.lead;
  const startHere = map.start_here || [];
  const learn = map.learn || [];
  const doRows = (map.do || []).slice(0, 12);
  if (startHere.length + learn.length + doRows.length === 0 && !lead && !map.fallback_reason) return null;
  return (
    <div className="course-map ledger">
      {map.fallback_reason && <p className="muted">{map.fallback_reason}</p>}
      {startHere.length > 0 && (
      <section aria-labelledby="map-start">
        <h3 id="map-start" className="index-label">
          Start here
        </h3>
        <ul>
          {startHere.map((row) => (
            <li key={row.title}>
              {row.html_url ? (
                <button type="button" className="link" onClick={() => void openExternalUrl(row.html_url as string)}>
                  {row.title}
                </button>
              ) : (
                row.title
              )}
            </li>
          ))}
        </ul>
      </section>
      )}
      {learn.length > 0 && (
      <section aria-labelledby="map-learn">
        <h3 id="map-learn" className="index-label">
          Learn
        </h3>
        <ul>
          {learn.map((row) => (
            <li key={row.id}>
              {row.title}
              {row.lti && <span className="muted">, opens in the browser</span>}
              {row.locked && <span className="muted">, locked</span>}
            </li>
          ))}
        </ul>
      </section>
      )}
      {doRows.length > 0 && (
      <section aria-labelledby="map-do">
        <h3 id="map-do" className="index-label">
          Do
        </h3>
        <ul>
          {doRows.map((row) => (
            <li key={row.id}>
              {row.title}
              <span className="muted">, {row.submission_state}</span>
            </li>
          ))}
        </ul>
      </section>
      )}
      {lead && (
      <section aria-labelledby="map-check">
        <h3 id="map-check" className="index-label">
          Check
        </h3>
        <p>
          Canvas says {lead.canvas_says ?? "—"}
          {lead.canvas_letter ? ` (${lead.canvas_letter})` : ""}; if the {lead.unsubmitted_due_count ?? 0} unsubmitted
          items count as zero, your estimate is {lead.risk ?? "—"}. {lead.why}
        </p>
      </section>
      )}
    </div>
  );
}

function TodayLine({ start, end, today }: { start: string; end: string; today: string }) {
  const span = Math.max(1, Date.parse(end) - Date.parse(start));
  const pct = ((Date.parse(today) - Date.parse(start)) / span) * 100;
  const left = Math.min(100, Math.max(0, pct));
  return (
    <div className="today-line" style={{ left: `${left}%` }} aria-hidden="true">
      <span>Today</span>
    </div>
  );
}

function CourseRow({
  label,
  color,
  inferred,
  clusters,
  todayMs,
  onHover,
  onLeave,
  onOpen,
}: {
  label: string;
  color: string;
  inferred: boolean;
  clusters: ReturnType<typeof clusterTicks>;
  todayMs: number;
  onHover: (tick: SemesterTick, el: HTMLElement) => void;
  onLeave: () => void;
  onOpen: (tick: SemesterTick) => void;
}) {
  return (
    <div className="course-row" style={{ ["--course" as string]: color }}>
      <div className="course-meta">
        <span className="course-dot" aria-hidden="true" />
        <strong>{label}</strong>
        {inferred && <span className="muted">dates inferred</span>}
      </div>
      <div className="axis" role="listbox" aria-label={label}>
        {clusters.map((c) => {
          const tick = c.ticks[0];
          const past = Date.parse(c.due_at) < todayMs;
          const grouped = c.ticks.length > 1;
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              className={`tick${past ? " past" : ""}${tick.completed ? " done" : ""} tick-${tick.kind}`}
              style={{
                left: `${c.x}px`,
                height: grouped ? 18 : tickHeightPx(tick),
                minWidth: 12,
              }}
              aria-label={grouped ? `${c.ticks.length} items` : tick.title}
              onMouseEnter={(e) => onHover(tick, e.currentTarget)}
              onMouseLeave={onLeave}
              onFocus={(e) => onHover(tick, e.currentTarget)}
              onBlur={onLeave}
              onClick={() => onOpen(tick)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll("button") ?? []);
                  const i = buttons.indexOf(e.currentTarget);
                  const next = e.key === "ArrowRight" ? buttons[i + 1] : buttons[i - 1];
                  (next as HTMLButtonElement | undefined)?.focus();
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function TickBubble({ tick, x, y }: { tick: SemesterTick; x: number; y: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y - 8 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x - r.width / 2;
    let top = y - r.height - 10;
    left = Math.min(window.innerWidth - r.width - 8, Math.max(8, left));
    if (top < 8) top = y + 16;
    setPos({ left, top });
  }, [x, y, tick.id]);
  const weightPct = Math.round((tick.weight_share || 0) * 1000) / 10;
  return (
    <div ref={ref} className="bubble" style={{ left: pos.left, top: pos.top }} role="tooltip">
      <span className="kind-badge">{kindLabel(tick.kind)}</span>
      <strong>{tick.title}</strong>
      <span className="muted">{tick.course_label}</span>
      <span className="muted">{tick.due_at ? friendlyWhen(tick.due_at) : "No due date"}</span>
      <span className="muted">
        {tick.points_possible ?? 0} points, {weightPct}% of the course
      </span>
    </div>
  );
}

function ItemSheet({
  tick,
  today,
  map,
  grades,
  onClose,
  onPlan,
}: {
  tick: SemesterTick;
  today: Date;
  map: CourseMap | null;
  grades: GradeTruth | null;
  onClose: () => void;
  onPlan: () => void;
}) {
  const examish = tick.kind === "exam" || tick.kind === "quiz";
  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="item-popup sheet"
        role="dialog"
        aria-labelledby="item-pop-title"
        style={{ ["--course" as string]: tick.color }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="kind-badge">{kindLabel(tick.kind)}</span>
        <h2 id="item-pop-title" className="editorial">
          {tick.title}
        </h2>
        <p className="item-when">
          {tick.course_label}. {tick.due_at ? `Due ${friendlyDue(tick.due_at, today)}.` : "No due date."}
        </p>
        {tick.description && <p className="cover">{tick.description.slice(0, 600)}</p>}
        <div className="sheet-actions">
          {examish && (
            <button type="button" className="primary" onClick={onPlan}>
              View plan
            </button>
          )}
          {tick.html_url && (
            <button type="button" onClick={() => void openExternalUrl(tick.html_url as string)}>
              Open in Canvas
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {map && <CourseMapLedger map={map} grades={grades} />}
      </div>
    </div>
  );
}
