// Purpose: weekly capacity and planned days
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCalendarEvent,
  dismissCalendarSuggestion,
  removeCalendarEvent,
  restoreCalendarSuggestion,
  onFreshnessUpdated,
  onInboxUpdated,
  openExternalUrl,
  readCalendarSurface,
  readFreshness,
  readSemester,
  readSkipCosts,
  type FreshnessChange,
  type SemesterSurface,
  type SemesterTick,
} from "../ipc";
import { kindLabel } from "../semesterTicks";
import { friendlyRelative, friendlyWhen } from "../format";
import { consequenceSentence, skipCostFor, type SkipCosts } from "../consequence";
import { useFlip, type FlipCue } from "../motion";
import { Crossfade, MotionDialog } from "../components/MotionDialog";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { ItemSheet } from "../components/ItemSheet";
import type { ToastState } from "../components/Toast";
import { ChangeRows } from "./TodayView";
import { onPlanChanged, weekPlan, WeekPlanError } from "../week/api";
import {
  PILE_LABEL,
  addDays,
  buildWeek,
  capacitySentence,
  couldWait,
  dayKey,
  dayLabel,
  formatMinutes,
  pileFor,
  proposePlan,
  type Pile,
  type PlanRow,
  type WeekModel,
  type WeekSnapshot,
} from "../week/plan";

/*
 * Week (MASTER §10): one capacity sentence, the piles of what arrived from
 * Canvas, then the days as hairline sections. Defer is a plain action with
 * undo. "Plan this week" proposes an order and only uses it after a yes; an
 * accepted plan never reorders itself.
 */

export type Suggestion = {
  id: string;
  title: string;
  start: string;
  end: string;
  why: string;
  dismissId?: string;
  /** Confirmed in place. Stays until the student leaves the week. */
  added?: boolean;
  /** Declined. Collapsed to one line that still carries the way back. */
  collapsed?: boolean;
};

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

export function WeekView({
  surface: surfaceProp,
  changes: changesProp,
  snapshot: snapProp,
  suggestions: suggestionsProp,
  now: nowProp,
  onToast,
  onStudy,
}: {
  surface?: SemesterSurface;
  changes?: FreshnessChange[];
  snapshot?: WeekSnapshot;
  suggestions?: Suggestion[];
  now?: Date;
  onToast: (t: ToastState) => void;
  onStudy: (tick: SemesterTick) => void;
}) {
  const [surface, setSurface] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [changes, setChanges] = useState<FreshnessChange[]>(changesProp ?? []);
  const [snap, setSnap] = useState<WeekSnapshot | null>(snapProp ?? null);
  const [costs, setCosts] = useState<SkipCosts>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>(suggestionsProp ?? []);
  const [error, setError] = useState("");
  const [synced, setSynced] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [confirm, setConfirm] = useState<Suggestion | null>(null);
  const [sheet, setSheet] = useState<SemesterTick | null>(null);
  const [hoursDraft, setHoursDraft] = useState("");
  const flipCue = useRef<FlipCue>({ holdId: null, instant: false });
  const live = !surfaceProp;
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) return;
    const subs = [onInboxUpdated(() => setSynced((n) => n + 1)), onFreshnessUpdated(() => setSynced((n) => n + 1))];
    return () => {
      for (const s of subs) void s.then((fn) => fn());
    };
  }, [live]);

  // Capture from ⌘K writes the plan without going through this view.
  useEffect(() => onPlanChanged(() => setSynced((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    if (live) {
      readSemester("1m", new Date().toISOString())
        .then((s) => alive && setSurface(s))
        .catch(() => alive && setError("Couldn't read your Canvas copy."));
      readFreshness()
        .then((d) => {
          if (!alive) return;
          setChanges(d?.changes ?? []);
          const fromDash: Suggestion[] = (d?.agent_can_do ?? []).map((a) => ({
            id: a.id,
            title: a.suggestion.title,
            start: a.suggestion.start,
            end: a.suggestion.end,
            why: a.why,
          }));
          setSuggestions((prev) => merge(prev, fromDash));
        })
        .catch(() => undefined);
      readSkipCosts()
        .then((c) => alive && setCosts(c || {}))
        .catch(() => undefined);
      readCalendarSurface()
        .then((cal) => {
          if (!alive) return;
          const queued: Suggestion[] = cal.suggestions.map((s) => ({
            id: s.source_message_id,
            dismissId: s.source_message_id,
            title: s.title,
            start: s.start,
            end: s.end,
            why: s.why,
          }));
          setSuggestions((prev) => merge(prev, queued));
        })
        .catch(() => undefined);
    }
    if (!snapProp) {
      weekPlan("show")
        .then((r) => alive && setSnap(r))
        .catch(() => alive && setError("Couldn't read your week plan."));
    }
    return () => {
      alive = false;
    };
  }, [live, snapProp, synced]);

  const ticks = useMemo(() => (surface ? surface.courses.flatMap((c) => c.ticks) : []), [surface]);
  const model: WeekModel | null = useMemo(() => (snap ? buildWeek(ticks, snap, now) : null), [ticks, snap, now]);

  const run = useCallback(
    async (cmd: string, params: Record<string, unknown>, message?: string, undo?: () => Promise<unknown>) => {
      setError("");
      try {
        const next = await weekPlan(cmd, params);
        setSnap(next);
        if (message) {
          onToast({
            message,
            id: Date.now(),
            undo: undo
              ? async () => {
                  try {
                    await undo();
                    setSnap(await weekPlan("show"));
                  } catch {
                    setError("Undo didn't save.");
                  }
                }
              : undefined,
          });
        }
        return next;
      } catch (e) {
        setError(e instanceof WeekPlanError ? e.message : "The plan didn't save.");
        return null;
      }
    },
    [onToast]
  );

  const deferRow = useCallback(
    (row: PlanRow, to?: string, fromKey = false) => {
      flipCue.current = fromKey ? { holdId: null, instant: true } : { holdId: row.id, instant: false };
      const target = to ?? addDays(row.day, 1);
      const prior = snap?.state.deferrals[row.id];
      void run("defer", { item_id: row.id, to: target }, `${row.title} moved to ${dayLabel(target, dayKey(now)).toLowerCase()}.`, () =>
        prior ? weekPlan("defer", { item_id: row.id, to: prior.to }) : weekPlan("undefer", { item_id: row.id })
      ).then((next) => {
        if (!next) flipCue.current = { holdId: null, instant: false };
      });
    },
    [run, snap, now]
  );

  const piles = useMemo(() => {
    const out: Record<Pile, FreshnessChange[]> = { needs_you: [], changed: [], fyi: [] };
    if (!snap) return out;
    for (const c of changes) out[pileFor(c, snap)].push(c);
    return out;
  }, [changes, snap]);

  const flipSig = model
    ? [
        model.days.map((d) => d.rows.map((r) => r.id).join(",")).join("|"),
        model.done.map((r) => r.id).join(","),
        (["needs_you", "changed", "fyi"] as const).map((p) => piles[p].map((c) => c.key).join(",")).join("|"),
      ].join(";")
    : "";
  const flipRef = useFlip<HTMLElement>(flipSig, flipCue);

  if (error && !model) {
    return (
      <section className="week scene-paper">
        <h1>This week</h1>
        <p role="alert">
          {error}{" "}
          <button type="button" className="link" onClick={() => setSynced((n) => n + 1)}>
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (!model || !snap) {
    return (
      <section className="week scene-paper">
        <h1>This week</h1>
        <p className="muted">Loading your week…</p>
      </section>
    );
  }

  const wait = couldWait(model);
  const nextMonday = addDays(model.week, 7);
  const weekEnd = addDays(model.week, 6);

  return (
    <section className="week scene-paper" aria-labelledby="week-heading" ref={flipRef}>
      <header className="week-head">
        <div>
          <h1 id="week-heading">This week</h1>
          <p className="muted week-range">
            {rangeLabel(model.week, weekEnd)}
            {model.accepted ? `. You planned it ${friendlyWhen(model.accepted.at)}.` : "."}
          </p>
        </div>
        <button type="button" onClick={() => setPlanning(true)}>
          {model.accepted ? "Replan this week" : "Plan this week"}
        </button>
      </header>

      <p className="week-capacity">{capacitySentence(model)}</p>
      {error && (
        <p role="alert" className="ask-error">
          {error}
        </p>
      )}

      {model.hours == null && (
        <form
          className="week-hours"
          onSubmit={(e) => {
            e.preventDefault();
            void run("hours", { week: model.week, hours: Number(hoursDraft) });
          }}
        >
          <label htmlFor="week-hours-input">How many hours outside class can you give schoolwork this week?</label>
          <div className="row">
            <input
              id="week-hours-input"
              type="number"
              min={0}
              max={112}
              step={1}
              inputMode="numeric"
              value={hoursDraft}
              onChange={(e) => setHoursDraft(e.target.value)}
              required
            />
            <button type="submit">Save</button>
          </div>
          <p className="muted">Kairos uses it to say when a week is too full. It carries over until you change it.</p>
        </form>
      )}

      {wait.length > 0 && (
        <section className="week-wait" aria-labelledby="wait-heading">
          <h2 id="wait-heading" className="today-section-title">
            Could wait
          </h2>
          <ul className="rows">
            {wait.map((r) => {
              const cons = r.tick ? consequenceSentence(skipCostFor(costs, r.tick), r.course ?? undefined) : null;
              const late = r.due_at && nextMonday > dayKey(new Date(r.due_at));
              return (
                <li key={r.id}>
                  <div className="row">
                    <span className="row-main">
                      <strong>{r.title}</strong>
                      <span className="row-meta">
                        {[r.course, `about ${formatMinutes(r.minutes)}`].filter(Boolean).join(", ")}
                        {late ? ". Next week is after it's due." : ""}
                      </span>
                      {cons && (
                        <span className="row-meta">
                          <Crossfade text={cons} />
                        </span>
                      )}
                    </span>
                    <button type="button" onClick={() => deferRow(r, nextMonday)}>
                      Do it next week
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <PileSection piles={piles} onMove={(c, pile, always) =>
        void run(
          "pile",
          { key: c.key, pile, always, course: c.course ?? "", kind: c.kind },
          always ? `${c.course} ${c.label.toLowerCase()} will go to ${PILE_LABEL[pile].toLowerCase()} from now on.` : undefined
        )
      } />

      {model.leftovers.length > 0 && (
        <section aria-labelledby="left-heading">
          <h2 id="left-heading" className="today-section-title">
            Left from before today
          </h2>
          <PlanRows rows={model.leftovers} now={now} onDefer={(r, fromKey) => deferRow(r, model.today, fromKey)} deferLabel="Do it today" onOpen={(r) => open(r)} onDone={(r) => done(r)} onEstimate={estimate} />
        </section>
      )}

      {model.newSincePlan.length > 0 && (
        <div className="today-line-row">
          <p className="today-row-title">
            {model.newSincePlan.length === 1 ? "1 new thing" : `${model.newSincePlan.length} new things`} arrived after you planned. They're on their due days until you replan.
          </p>
          <button type="button" onClick={() => setPlanning(true)}>
            Fit them in
          </button>
        </div>
      )}

      <div className="week-days">
        {model.days.map((d) => {
          const total = d.rows.reduce((s, r) => s + r.minutes, 0);
          return (
            <section key={d.day} className={d.day === model.today ? "week-day is-today" : "week-day"} aria-labelledby={`day-${d.day}`}>
              <h2 id={`day-${d.day}`} className="week-day-title">
                <span>{d.label}</span>
                {total > 0 && <span className="muted">about {formatMinutes(total)}</span>}
              </h2>
              {d.rows.length === 0 ? (
                <p className="muted week-empty">Nothing planned.</p>
              ) : (
                <PlanRows rows={d.rows} now={now} onDefer={(r, fromKey) => deferRow(r, undefined, fromKey)} deferLabel="Defer" onOpen={(r) => open(r)} onDone={(r) => done(r)} onEstimate={estimate} />
              )}
            </section>
          );
        })}
      </div>

      {model.done.length > 0 && (
        <section aria-labelledby="done-heading">
          <h2 id="done-heading" className="today-section-title">
            Done
          </h2>
          <ul className="rows plan-rows">
            {model.done.map((r) => (
              <li key={r.id} data-flip={r.id} aria-label={r.title}>
                <div className="row">
                  <span className="row-main">
                    <strong className="row-title">{r.title}</strong>
                    <span className="row-meta">{[r.course, "you added this"].filter(Boolean).join(", ")}</span>
                  </span>
                  <button type="button" onClick={() => undone(r)}>
                    Not done
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section aria-labelledby="blocks-heading">
          <h2 id="blocks-heading" className="today-section-title">
            Suggested work blocks
          </h2>
          <p className="muted">Each one waits for your yes, and only goes on your Kairos calendar.</p>
          <ul className="rows">
            {suggestions.map((s) =>
              s.collapsed ? (
                // The row that leaves still holds the way back. A toast can be
                // queued behind another Undo, so it is never the only one (§16.4).
                <li key={s.id} className="suggestion is-declined">
                  <div className="row">
                    <span className="row-main">
                      <span className="row-meta">{s.title} won't be suggested again.</span>
                    </span>
                    <button type="button" className="link" onClick={() => undecline(s)}>
                      Undo
                    </button>
                  </div>
                </li>
              ) : (
                <li key={s.id} className="suggestion">
                  <div className="row">
                    <span className="row-main">
                      <strong>{s.title}</strong>
                      <span className="row-meta">
                        {friendlyWhen(s.start)}. {s.why}
                      </span>
                    </span>
                    <span className="row-actions">
                      <button type="button" disabled={s.added} onClick={() => setConfirm(s)}>
                        {s.added ? "Added" : "Add it"}
                      </button>
                      <button type="button" className="ghost" disabled={s.added} onClick={() => decline(s)}>
                        Not now
                      </button>
                    </span>
                  </div>
                </li>
              )
            )}
          </ul>
        </section>
      )}

      {planning && (
        <PlanSheet
          model={model}
          piles={piles}
          now={now}
          onClose={() => setPlanning(false)}
          onAccept={async (days) => {
            const prior = snap.state.weeks[model.week]?.accepted;
            const ok = await run("accept", { week: model.week, days }, "Your plan for the week is set. It stays put until you change it.", () =>
              prior ? weekPlan("accept", { week: model.week, days: prior.days }) : weekPlan("unaccept", { week: model.week })
            );
            if (ok) setPlanning(false);
          }}
        />
      )}

      {confirm && (
        <ConfirmSheet
          title="Add this work block?"
          yes="Add to my calendar"
          onNo={() => setConfirm(null)}
          onYes={async () => {
            const s = confirm;
            setConfirm(null);
            try {
              const saved = await addCalendarEvent({ kind: "personal", title: s.title, start: s.start, end: s.end, note: s.why });
              setSuggestions((all) => all.map((x) => (x.id === s.id ? { ...x, added: true } : x)));
              if (s.dismissId) void dismissCalendarSuggestion(s.dismissId);
              onToast({
                message: `Added ${s.title} to your Kairos calendar.`,
                id: Date.now(),
                undo: async () => {
                  await removeCalendarEvent(saved.id);
                  if (s.dismissId) await restoreCalendarSuggestion(s.dismissId);
                  setSuggestions((all) => all.map((x) => (x.id === s.id ? { ...x, added: false } : x)));
                },
              });
            } catch {
              setError("The block didn't save.");
            }
          }}
        >
          <p>
            <strong>{confirm.title}</strong>
          </p>
          <p>
            {friendlyWhen(confirm.start)} to {new Date(confirm.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
          </p>
          <p className="muted">One block on your Kairos calendar. Nothing else moves, and it won't move on its own later.</p>
        </ConfirmSheet>
      )}

      {sheet && (
        <ItemSheet
          tick={sheet}
          today={now}
          map={null}
          grades={null}
          consequence={consequenceSentence(skipCostFor(costs, sheet), sheet.course_label)}
          onClose={() => setSheet(null)}
          onPlan={() => {
            onStudy(sheet);
            setSheet(null);
          }}
        />
      )}
    </section>
  );

  function open(r: PlanRow) {
    if (r.tick) setSheet(r.tick);
    else if (r.html_url) void openExternalUrl(r.html_url);
  }

  function done(r: PlanRow) {
    if (!r.captured) return;
    flipCue.current = { holdId: r.id, instant: false };
    void run("done", { item_id: r.id }, `Marked ${r.title} done.`, () => weekPlan("done", { item_id: r.id, undo: true })).then((next) => {
      if (!next) flipCue.current = { holdId: null, instant: false };
    });
  }

  function undone(r: PlanRow) {
    flipCue.current = { holdId: r.id, instant: false };
    void run("done", { item_id: r.id, undo: true }, `${r.title} is back on the week.`, () => weekPlan("done", { item_id: r.id })).then((next) => {
      if (!next) flipCue.current = { holdId: null, instant: false };
    });
  }

  function decline(s: Suggestion) {
    setSuggestions((all) => all.map((x) => (x.id === s.id ? { ...x, collapsed: true } : x)));
    if (s.dismissId) void dismissCalendarSuggestion(s.dismissId);
    onToast({ message: `${s.title} won't be suggested again.`, id: Date.now(), undo: () => undecline(s) });
  }

  function undecline(s: Suggestion) {
    if (s.dismissId) {
      void restoreCalendarSuggestion(s.dismissId).catch(() => setError("That suggestion didn't come back."));
    }
    setSuggestions((all) => all.map((x) => (x.id === s.id ? { ...x, collapsed: false } : x)));
  }

  function estimate(r: PlanRow, minutes: number) {
    void run("estimate", { item_id: r.id, minutes });
  }
}

function merge(prev: Suggestion[], next: Suggestion[]): Suggestion[] {
  const seen = new Set(prev.map((s) => s.title.toLowerCase()));
  return [...prev, ...next.filter((s) => !seen.has(s.title.toLowerCase()) && Date.parse(s.start) > Date.now())];
}

function rangeLabel(start: string, end: string): string {
  const fmt = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return `${fmt(start)} to ${fmt(end)}`;
}

function PlanRows({
  rows,
  now,
  onDefer,
  deferLabel,
  onOpen,
  onDone,
  onEstimate,
}: {
  rows: PlanRow[];
  now: Date;
  onDefer: (r: PlanRow, fromKey?: boolean) => void;
  deferLabel: string;
  onOpen: (r: PlanRow) => void;
  onDone: (r: PlanRow) => void;
  onEstimate: (r: PlanRow, minutes: number) => void;
}) {
  const list = useRef<HTMLUListElement | null>(null);
  // J/K move between rows, D defers the focused row (MASTER §06 command bar keys).
  const onKey = (e: React.KeyboardEvent<HTMLLIElement>, r: PlanRow) => {
    if ((e.target as HTMLElement).tagName === "SELECT") return;
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>("li[data-row]") ?? []);
    const i = items.indexOf(e.currentTarget);
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      items[i + 1]?.focus();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      items[i - 1]?.focus();
    } else if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onDefer(r, true);
    } else if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen(r);
    }
  };
  return (
    <ul className="rows plan-rows" ref={list}>
      {rows.map((r) => (
        <li
          key={r.id}
          data-row
          data-flip={r.id}
          tabIndex={0}
          onKeyDown={(e) => onKey(e, r)}
          style={{ ["--course" as string]: r.color ?? undefined }}
          aria-label={r.title}
        >
          <div className="row">
            <span className="row-main">
              {r.tick || r.html_url ? (
                <button type="button" className="link row-title" onClick={() => onOpen(r)}>
                  {r.title}
                </button>
              ) : (
                <strong className="row-title">{r.title}</strong>
              )}
              <span className="row-meta">
                {r.color && <span className="course-dot" aria-hidden="true" />}
                {[
                  r.course,
                  r.captured ? "you added this" : kindLabel(r.kind).toLowerCase(),
                  r.due_at ? `due ${friendlyRelative(r.due_at, now)}` : null,
                  r.why === "deferred" ? "you moved it here" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
            <span className="row-actions">
              <label className="visually-hidden" htmlFor={`est-${r.id}`}>
                Time for {r.title}
              </label>
              <select
                id={`est-${r.id}`}
                className="estimate"
                value={ESTIMATES.includes(r.minutes) ? r.minutes : ""}
                onChange={(e) => onEstimate(r, Number(e.target.value))}
              >
                {!ESTIMATES.includes(r.minutes) && <option value="">about {formatMinutes(r.minutes)}</option>}
                {ESTIMATES.map((m) => (
                  <option key={m} value={m}>
                    about {formatMinutes(m)}
                  </option>
                ))}
              </select>
              {r.captured && (
                <button type="button" onClick={() => onDone(r)}>
                  Done
                </button>
              )}
              <button type="button" onClick={() => onDefer(r)} title="Defer (D)">
                {deferLabel}
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PileSection({ piles, onMove }: { piles: Record<Pile, FreshnessChange[]>; onMove: (c: FreshnessChange, pile: Pile, always: boolean) => void }) {
  const order: Pile[] = ["needs_you", "changed", "fyi"];
  if (order.every((p) => piles[p].length === 0)) return null;
  return (
    <section className="week-piles" aria-label="From Canvas">
      {order.map((p) =>
        piles[p].length === 0 ? null : (
          <section key={p} aria-labelledby={`pile-${p}`}>
            <h2 id={`pile-${p}`} className="pile-title">
              {PILE_LABEL[p]}, {piles[p].length}
            </h2>
            <ChangeRows changes={piles[p]} />
            <PileMover changes={piles[p]} current={p} onMove={onMove} />
          </section>
        )
      )}
    </section>
  );
}

/** Correcting a pile: pick the row, pick the pile, optionally "always" for that course (asked once, never guessed). */
function PileMover({ changes, current, onMove }: { changes: FreshnessChange[]; current: Pile; onMove: (c: FreshnessChange, pile: Pile, always: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(changes[0]?.key ?? "");
  const [always, setAlways] = useState(false);
  const target = changes.find((c) => c.key === key) ?? changes[0];
  if (!open) {
    return (
      <button type="button" className="link pile-move" onClick={() => setOpen(true)}>
        Something in the wrong pile?
      </button>
    );
  }
  return (
    <div className="pile-mover">
      <label>
        Move
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {changes.map((c) => (
            <option key={c.key} value={c.key}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        {(Object.keys(PILE_LABEL) as Pile[])
          .filter((p) => p !== current)
          .map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                if (target) onMove(target, p, always);
                setOpen(false);
              }}
            >
              To {PILE_LABEL[p].toLowerCase()}
            </button>
          ))}
      </div>
      {target?.course && (
        <label className="pile-always">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always put {target.course}{" "}
          {target.label.toLowerCase()} rows there
        </label>
      )}
    </div>
  );
}

/** "Plan this week": what changed, what's left over, the proposed order, then one yes. */
function PlanSheet({
  model,
  piles,
  now,
  onClose,
  onAccept,
}: {
  model: WeekModel;
  piles: Record<Pile, FreshnessChange[]>;
  now: Date;
  onClose: () => void;
  onAccept: (days: Record<string, string>) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [bring, setBring] = useState<Set<string>>(() => new Set(model.leftovers.map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const include = model.leftovers.filter((r) => bring.has(r.id));
  const proposal = useMemo(() => proposePlan(model, include), [model, include]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = [...include, ...model.days.flatMap((d) => d.rows)];
  const byDay = model.days.map((d) => ({ ...d, rows: all.filter((r) => proposal[r.id] === d.day) }));
  const steps = ["What changed", "Left over", "Proposed order"];

  return (
    <MotionDialog onClose={onClose} className="plan-sheet sheet" labelledBy="plan-title">
      {(close) => (
        <>
        <header className="ask-sheet-head">
          <h2 id="plan-title">Plan this week</h2>
          <button type="button" className="ghost" onClick={close}>
            Close
          </button>
        </header>
        <p className="muted">
          {steps[step]}, step {step + 1} of 3. Skip any week you like; nothing counts it.
        </p>

        {step === 0 &&
          (piles.needs_you.length + piles.changed.length === 0 ? (
            <p>Nothing in Canvas needs you since the last sync.</p>
          ) : (
            <ChangeRows changes={[...piles.needs_you, ...piles.changed]} now={now.getTime()} />
          ))}

        {step === 1 &&
          (model.leftovers.length === 0 ? (
            <p>Nothing left over from before today.</p>
          ) : (
            <ul className="rows">
              {model.leftovers.map((r) => (
                <li key={r.id}>
                  <label className="row">
                    <span className="row-main">
                      <strong>{r.title}</strong>
                      <span className="row-meta">{[r.course, r.due_at ? `was due ${friendlyRelative(r.due_at, now)}` : null].filter(Boolean).join(", ")}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={bring.has(r.id)}
                      onChange={(e) =>
                        setBring((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                      aria-label={`Bring ${r.title} into this week`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          ))}

        {step === 2 && (
          <div className="plan-proposal">
            {byDay
              .filter((d) => d.rows.length > 0)
              .map((d) => (
                <section key={d.day}>
                  <h3 className="week-day-title">
                    <span>{d.label}</span>
                    <span className="muted">about {formatMinutes(d.rows.reduce((s, r) => s + r.minutes, 0))}</span>
                  </h3>
                  <ul className="rows">
                    {d.rows.map((r) => (
                      <li key={r.id}>
                        <div className="row">
                          <span className="row-main">
                            <strong>{r.title}</strong>
                            <span className="row-meta">
                              {[r.course, r.day !== d.day ? `moves from ${dayLabel(r.day, model.today).toLowerCase()}` : null].filter(Boolean).join(", ")}
                            </span>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            <p className="muted">Once you use it, this order stays put. New work shows up on its due day until you replan.</p>
          </div>
        )}

        <div className="sheet-actions">
          {step < 2 ? (
            <button type="button" className="primary" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onAccept(proposal);
                setBusy(false);
              }}
            >
              {busy ? "Saving" : "Use this plan"}
            </button>
          )}
          {step > 0 && (
            <button type="button" className="ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
        </div>
        </>
      )}
    </MotionDialog>
  );
}
