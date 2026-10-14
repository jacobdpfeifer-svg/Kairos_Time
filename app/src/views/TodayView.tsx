import { useEffect, useMemo, useState } from "react";
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
import { kindLabel } from "../semesterTicks";
import { rankOpenWork } from "../ask/rank";
import { SyncHealthBanner } from "../components/SyncHealthBanner";
import { ItemSheet } from "../components/ItemSheet";
import { SemesterLine } from "../components/SemesterLine";
import { friendlyDue, friendlyRelative } from "../format";
import { consequenceSentence, skipCostFor, type SkipCosts } from "../consequence";
import type { AskEnvelope } from "../study/types";

/*
 * Today (MASTER §10): the date, one focus block for the single next move with
 * what it is worth, one line for what changed in Canvas, the rest of the week
 * as quiet rows, then the semester line. Ask opens as a sheet over this page.
 */

const DAY = 86_400_000;
const SEEN_KEY = "pn_changes_seen_at";

const isAssessment = (tick: SemesterTick) => tick.kind === "exam" || tick.kind === "quiz";

/**
 * Exam-week mode (MASTER §10): the next exam, or a quiz worth at least a tenth
 * of the course, three days out or less. Watch Duty's rule: under stress the
 * page shows less.
 */
export function examWeekFocus(ticks: SemesterTick[], now: Date): { exam: SemesterTick; daysLeft: number } | null {
  const soon = ticks
    .filter((t) => !t.completed && t.due_at && (t.kind === "exam" || (t.kind === "quiz" && (t.weight_share || 0) >= 0.1)))
    .map((t) => ({ t, ms: Date.parse(t.due_at as string) }))
    .filter(({ ms }) => ms >= now.getTime() && ms - now.getTime() <= 3 * DAY)
    .sort((a, b) => a.ms - b.ms)[0];
  if (!soon) return null;
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysLeft = Math.round((start(new Date(soon.ms)) - start(now)) / DAY);
  return { exam: soon.t, daysLeft };
}

const EXAM_MODE_KEY = "pn_exam_mode_off";

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
  health?: SyncHealth;
  map?: CourseMap;
  grades?: GradeTruth;
  skipCosts?: SkipCosts;
  changes?: FreshnessChange[];
  /** Rows the student typed. Tests pass them in; the live app reads the week plan. */
  captures?: Capture[];
  lastAsk?: AskEnvelope | null;
  /** Deep link or ⌘K: open this item's sheet on arrival. */
  openItem?: { courseId?: string; itemId: string } | null;
  onStudy: (tick: SemesterTick) => void;
  onAsk: (initial?: AskEnvelope | null) => void;
  onOpenWeek?: () => void;
}) {
  const [loaded, setLoaded] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [failed, setFailed] = useState(false);
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
  const [examModeOff, setExamModeOff] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(EXAM_MODE_KEY);
    } catch {
      return null;
    }
  });
  // Bumped when a Canvas sync or a freshness tick finishes.
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
      .then((s) => {
        if (!alive) return;
        setLoaded(s);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
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
  const lead = useMemo(() => rankOpenWork(ticks).recommendation, [ticks]);
  const week = useMemo(() => {
    const end = today.getTime() + 7 * DAY;
    return ticks
      .filter((t) => !t.completed && t.due_at && t.id !== lead?.id)
      .filter((t) => {
        const due = Date.parse(t.due_at as string);
        return due >= today.getTime() - DAY && due <= end;
      })
      .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  }, [ticks, lead, today]);
  const fresh = changes.filter((c) => changeTime(c) > seenAt);
  const hasCourses = Boolean(surface && surface.courses.length > 0);

  const openTick = (tick: SemesterTick) => {
    if (tick.course_id !== courseId) setCourseId(tick.course_id);
    setPopup(tick);
  };

  // Deep links and ⌘K land on an item's sheet.
  useEffect(() => {
    if (!openItem || !surface) return;
    const hit = ticks.find((t) => t.id === openItem.itemId && (!openItem.courseId || t.course_id === openItem.courseId));
    if (hit) openTick(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItem, surface]);

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
  const added = captures.filter((c) => !c.done_at);

  const examWeek = useMemo(() => examWeekFocus(ticks, today), [ticks, today]);
  const examMode = examWeek && examModeOff !== examWeek.exam.id ? examWeek : null;
  const dueSoonCount = examMode
    ? ticks.filter((t) => !t.completed && t.due_at && t.id !== examMode.exam.id && Date.parse(t.due_at) - today.getTime() <= 2 * DAY && Date.parse(t.due_at) >= today.getTime()).length
    : 0;

  const leadMoved = lead ? changes.find((c) => c.kind === "due_changed" && c.title === lead.title) : undefined;
  const leadConsequence = lead ? consequenceSentence(skipCostFor(costs, lead), lead.course_label) : null;
  const captureFocus = !examMode && !lead ? (added.find((c) => captureOn(c) === todayKey) ?? null) : null;
  const addedWeek = added.filter((c) => {
    if (captureFocus && c.id === captureFocus.id) return false;
    const day = captureOn(c);
    return day >= todayKey && day < addDays(todayKey, 7);
  });

  useEffect(() => {
    if (!surface && !failed) return;
    const title = examMode?.exam.title ?? lead?.title ?? captureFocus?.title ?? "";
    void setTrayNext(title);
  }, [surface, failed, examMode, lead, captureFocus]);

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

      {failed && !surface && (
        <p role="alert" className="today-error">
          Couldn't read your Canvas copy.{" "}
          <button type="button" className="link" onClick={() => setSynced((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {!surface && !failed && <p className="muted">Loading your classes…</p>}
      {surface && !hasCourses && !captureFocus && <p className="today-empty">No classes yet. Once Canvas finishes syncing they show up here.</p>}
      {hasCourses && !lead && !examMode && !captureFocus && (
        <div className="home-focus today-focus">
          <h2 className="home-statement">Nothing due in the next month.</h2>
          <p className="home-when">Go outside. Kairos will say when something lands in Canvas.</p>
        </div>
      )}

      {examMode && (
        <section className="home-focus today-focus exam-mode" aria-labelledby="exam-focus-title" style={{ ["--course" as string]: examMode.exam.color }}>
          <span className="kind-badge">
            {examMode.exam.course_label}, {kindLabel(examMode.exam.kind).toLowerCase()}
          </span>
          <h2 id="exam-focus-title">
            <button type="button" className="home-statement" onClick={() => openTick(examMode.exam)}>
              {examMode.exam.title}
            </button>
          </h2>
          <p className="home-when">
            {examMode.daysLeft === 0
              ? `It's today at ${new Date(examMode.exam.due_at as string).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`
              : `${examMode.daysLeft === 1 ? "Tomorrow" : `In ${examMode.daysLeft} days`}. Day ${4 - examMode.daysLeft} of 3 before it.`}
          </p>
          <p className="consequence">
            {examMode.daysLeft === 0
              ? "A last light review, then rest. Nothing new today."
              : "Kairos is keeping today about this. Everything else is small or can wait."}
          </p>
          <div className="focus-actions">
            <button type="button" className="primary" onClick={() => onStudy(examMode.exam)}>
              {examMode.daysLeft === 0 ? "Do a last review" : "Study for it"}
            </button>
          </div>
        </section>
      )}
      {examMode && (
        <div className="today-line-row">
          <p className="today-row-title">
            {dueSoonCount === 0
              ? "Nothing else is due in the next two days."
              : `${dueSoonCount === 1 ? "1 other thing is" : `${dueSoonCount} other things are`} due in the next two days.`}
          </p>
          <button
            type="button"
            className="link"
            onClick={() => {
              setExamModeOff(examMode.exam.id);
              try {
                sessionStorage.setItem(EXAM_MODE_KEY, examMode.exam.id);
              } catch {
                /* the whole day shows for this visit only */
              }
            }}
          >
            Show my whole day
          </button>
        </div>
      )}

      {captureFocus && (
        <section className="home-focus today-focus" aria-labelledby="focus-title">
          <span className="kind-badge">{captureFocus.course ? `${captureFocus.course}, you added this` : "You added this"}</span>
          <h2 id="focus-title" className="home-statement">
            {captureFocus.title}
          </h2>
          <p className="home-when">Planned for today.</p>
          {onOpenWeek && (
            <div className="focus-actions">
              <button type="button" className="primary" onClick={onOpenWeek}>
                See it in the week
              </button>
            </div>
          )}
        </section>
      )}

      {lead && !examMode && (
        <section className="home-focus today-focus" aria-labelledby="focus-title" style={{ ["--course" as string]: lead.color }}>
          <span className="kind-badge">
            {lead.course_label}, {kindLabel(lead.kind).toLowerCase()}
          </span>
          <h2 id="focus-title">
            <button type="button" className="home-statement" onClick={() => openTick(lead)}>
              {lead.title}
            </button>
          </h2>
          <p className="home-when">
            {lead.due_at ? `Due ${friendlyDue(lead.due_at, today)}.` : "No due date in Canvas."}
            {leadMoved ? " The due date moved." : ""}
          </p>
          {leadConsequence && <p className="consequence">{leadConsequence}</p>}
          <div className="focus-actions">
            {isAssessment(lead) ? (
              <button type="button" className="primary" onClick={() => onStudy(lead)}>
                Start studying
              </button>
            ) : lead.html_url ? (
              <button type="button" className="primary" onClick={() => void openExternalUrl(lead.html_url as string)}>
                Open in Canvas
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => openTick(lead)}>
                See what's involved
              </button>
            )}
          </div>
        </section>
      )}

      {fresh.length > 0 && (
        <section className="today-changes" aria-labelledby="changes-heading">
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

      {addedWeek.length > 0 && !examMode && (
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

      {week.length > 0 && !examMode && (
        <section className="today-week" aria-labelledby="week-heading">
          <h2 id="week-heading" className="today-section-title">
            Also this week
          </h2>
          <ul className="rows">
            {week.slice(0, 6).map((t) => (
              <li key={t.id} style={{ ["--course" as string]: t.color }}>
                <button type="button" className="row" onClick={() => openTick(t)}>
                  <span className="row-main">
                    <strong>{t.title}</strong>
                    <span className="row-meta">
                      <span className="course-dot" aria-hidden="true" /> {t.course_label}, {kindLabel(t.kind).toLowerCase()}
                    </span>
                  </span>
                  <span className="row-when">{t.due_at ? friendlyRelative(t.due_at, today) : "No date"}</span>
                </button>
              </li>
            ))}
          </ul>
          {(week.length > 6 || onOpenWeek) && onOpenWeek && (
            <button type="button" className="link" onClick={onOpenWeek}>
              See the whole week
            </button>
          )}
        </section>
      )}

      {hasCourses && !examMode && <SemesterLine surface={surfaceProp} synced={synced} onOpen={openTick} />}

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
        <li key={c.key}>
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
