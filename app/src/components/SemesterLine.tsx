import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readSemester, type SemesterSurface, type SemesterTick } from "../ipc";
import { clusterTicks, kindLabel, loadRange, saveRange, tickHeightPx, type RangeId } from "../semesterTicks";
import { friendlyWhen } from "../format";

/*
 * The semester line (MASTER §06): one lane per course, ticks whose height is
 * the item's weight in the course color, a dashed "today" rule. Read with its
 * own range so Today's lists keep their one-month window.
 */

const RANGES: { id: RangeId; label: string }[] = [
  { id: "1m", label: "1 month" },
  { id: "3m", label: "3 months" },
  { id: "full", label: "Full semester" },
];

export function SemesterLine({
  surface: surfaceProp,
  synced = 0,
  onOpen,
}: {
  surface?: SemesterSurface;
  synced?: number;
  onOpen: (tick: SemesterTick) => void;
}) {
  const [range, setRange] = useState<RangeId>(() => (loadRange() === "2m" ? "3m" : loadRange()));
  const [loaded, setLoaded] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [hover, setHover] = useState<{ tick: SemesterTick; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(640);
  const axis = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveRange(range);
  }, [range]);

  useEffect(() => {
    if (surfaceProp) {
      setLoaded(surfaceProp);
      return;
    }
    let alive = true;
    readSemester(range, new Date().toISOString())
      .then((s) => alive && setLoaded(s))
      .catch(() => alive && setLoaded(null));
    return () => {
      alive = false;
    };
  }, [range, surfaceProp, synced]);

  useLayoutEffect(() => {
    const el = axis.current;
    if (!el) return;
    setWidth(el.clientWidth || 640);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const surface = loaded;
  if (!surface || surface.courses.length === 0) return null;
  const todayMs = Date.parse(surface.today);

  return (
    <section className="semester-section" aria-labelledby="semester-heading">
      <div className="semester-head">
        <h2 id="semester-heading" className="semester-title">
          The rest of the semester
        </h2>
        <fieldset className="segmented home-range" aria-label="Time range">
          {RANGES.map((r) => (
            <label key={r.id} className={range === r.id ? "on" : undefined}>
              <input type="radio" name="semester-range" value={r.id} checked={range === r.id} onChange={() => setRange(r.id)} />
              {r.label}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="muted semester-hint">Taller marks are worth more of the grade.</p>
      <div className="semester bleed" ref={axis}>
        <TodayLine start={surface.window_start} end={surface.window_end} today={surface.today} />
        {surface.courses.map((course) => (
          <div className="course-row" key={course.id} style={{ ["--course" as string]: course.color }}>
            <div className="course-meta">
              <span className="course-dot" aria-hidden="true" />
              <strong>{course.label}</strong>
              {course.term.source === "inferred" && <span className="muted">dates inferred</span>}
            </div>
            <div className="axis" role="group" aria-label={course.label}>
              {clusterTicks(course.ticks, surface.window_start, surface.window_end, width).map((c) => {
                const tick = c.ticks[0];
                const past = Date.parse(c.due_at) < todayMs;
                const grouped = c.ticks.length > 1;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`tick${past ? " past" : ""}${tick.completed ? " done" : ""} tick-${tick.kind}`}
                    style={{ left: `${c.x}px`, height: grouped ? 18 : tickHeightPx(tick), minWidth: 12 }}
                    aria-label={grouped ? `${c.ticks.length} items, first ${tick.title}` : tick.title}
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHover({ tick, x: r.left + r.width / 2, y: r.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHover({ tick, x: r.left + r.width / 2, y: r.top });
                    }}
                    onBlur={() => setHover(null)}
                    onClick={() => onOpen(tick)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                      e.preventDefault();
                      const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll("button") ?? []);
                      const i = buttons.indexOf(e.currentTarget);
                      (buttons[e.key === "ArrowRight" ? i + 1 : i - 1] as HTMLButtonElement | undefined)?.focus();
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {hover && <TickBubble tick={hover.tick} x={hover.x} y={hover.y} />}
    </section>
  );
}

function TodayLine({ start, end, today }: { start: string; end: string; today: string }) {
  const span = Math.max(1, Date.parse(end) - Date.parse(start));
  const pct = ((Date.parse(today) - Date.parse(start)) / span) * 100;
  return (
    <div className="today-line" style={{ left: `${Math.min(100, Math.max(0, pct))}%` }} aria-hidden="true">
      <span>Today</span>
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
