import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { StudyRequestError, aiStudy, study, type AiFeedback } from "../study/api";
import { AskPanel } from "../ask/AskPanel";
import { EVIDENCE_LABEL, OUTCOME_LABEL, STABILITY_LABEL, fmtSeconds, fmtWhen } from "../study/format";
import { LetterFlip } from "../components/LetterFlip";
import { IconLearn, IconPause, IconPractice, IconQuiz, IconStop } from "../components/Icons";
import type { Assessed, Example, Mode, Offer, PublicItem, Revealed, Started } from "../study/types";

type Phase =
  | { kind: "loading" }
  | { kind: "offer"; offer: Offer }
  | { kind: "attempt"; started: Started; item: PublicItem }
  | { kind: "feedback"; result: Assessed; item: PublicItem }
  | { kind: "error"; error: StudyRequestError; retry: () => void };

const MINUTES_KEY = "pn_study_minutes";

function useFocusOnChange<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [dep]);
  return ref;
}

export function StudyView({
  onGoToSources,
  preselect,
}: {
  onGoToSources: () => void;
  preselect?: { course?: string; examId?: string } | null;
}) {
  const [minutes, setMinutes] = useState<number>(() => {
    const raw = localStorage.getItem(MINUTES_KEY);
    return raw === "10" ? 10 : 5;
  });
  const [course, setCourse] = useState<string | null>(preselect?.course ?? null);
  const [courses, setCourses] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [live, setLive] = useState("");

  const loadOffer = useCallback(
    async (opts: { mode?: string | null; itemId?: string | null; newSession?: boolean } = {}) => {
      setPhase({ kind: "loading" });
      try {
        const [offer, status] = await Promise.all([
          study.offer({ course, minutes, mode: opts.mode ?? null, itemId: opts.itemId ?? null, newSession: opts.newSession }),
          study.status(),
        ]);
        setCourses(status.courses);
        setPhase({ kind: "offer", offer });
      } catch (e) {
        const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
        setPhase({ kind: "error", error, retry: () => void loadOffer(opts) });
      }
    },
    [course, minutes]
  );

  useEffect(() => {
    void loadOffer();
  }, [loadOffer]);

  useEffect(() => {
    localStorage.setItem(MINUTES_KEY, String(minutes));
  }, [minutes]);

  const start = async (item: PublicItem, mode: Mode) => {
    setPhase({ kind: "loading" });
    try {
      const started = await study.start(item.id, mode, minutes);
      setLive(started.resumed ? "Draft restored with its study history." : "");
      setPhase({ kind: "attempt", started, item: started.item });
    } catch (e) {
      const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
      setPhase({ kind: "error", error, retry: () => void start(item, mode) });
    }
  };

  return (
    <section className="study scene-paper" aria-labelledby="study-heading">
      <header className="study-header">
        <h1 id="study-heading">Study</h1>
        <div className="study-controls">
          <fieldset className="segmented minutes" aria-label="Session length" disabled={phase.kind === "attempt"}>
            <legend className="visually-hidden">Session length</legend>
            {[5, 10].map((m) => (
              <label key={m} className={minutes === m ? "on" : undefined}>
                <input type="radio" name="minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} />
                {m} min
              </label>
            ))}
          </fieldset>
          {courses.length > 1 && (
            <label className="course-pick">
              <span className="visually-hidden">Course</span>
              <select value={course ?? ""} disabled={phase.kind === "attempt"} onChange={(e) => setCourse(e.target.value || null)}>
                <option value="">All courses</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">
        {live}
      </p>

      {phase.kind === "loading" && <p className="page index-label">Loading</p>}
      {phase.kind === "error" && <ErrorPanel error={phase.error} retry={phase.retry} onGoToSources={onGoToSources} />}
      {phase.kind === "offer" && (
        <OfferPanel
          offer={phase.offer}
          onStart={start}
          onPractice={(itemId) => void loadOffer({ mode: "practice", itemId })}
          onGoToSources={onGoToSources}
          onNewSession={() => void loadOffer({ newSession: true })}
        />
      )}
      {phase.kind === "attempt" && (
        <AttemptPanel
          started={phase.started}
          item={phase.item}
          minutes={minutes}
          announce={setLive}
          onAssessed={(result) => setPhase({ kind: "feedback", result, item: phase.item })}
          onSkipped={() => void loadOffer()}
          onError={(error, retry) => setPhase({ kind: "error", error, retry })}
        />
      )}
      {phase.kind === "feedback" && (
        <FeedbackPanel result={phase.result} item={phase.item} announce={setLive} onNext={() => void loadOffer()} />
      )}
    </section>
  );
}

function ErrorPanel({ error, retry, onGoToSources }: { error: StudyRequestError; retry: () => void; onGoToSources: () => void }) {
  const heading = useFocusOnChange<HTMLHeadingElement>(error);
  const unreachable = error.code === "unreachable";
  return (
    <div className="page page-quiet" role="alert">
      <h2 ref={heading} tabIndex={-1}>
        {unreachable ? "Kairos couldn't open your study notes" : "Something went wrong on our side"}
      </h2>
      <p>{unreachable ? "The study helper isn't answering. Try again, or quit and reopen Kairos." : error.message}</p>
      {error.code === "persistence_failed" && (
        <p>Your answer was not saved. Check free disk space, then retry with the same attempt.</p>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={retry}>
          Retry
        </button>
        <button type="button" onClick={onGoToSources}>
          Canvas data
        </button>
      </div>
    </div>
  );
}

function OfferPanel({
  offer,
  onStart,
  onPractice,
  onGoToSources,
  onNewSession,
}: {
  offer: Offer;
  onStart: (item: PublicItem, mode: Mode) => void;
  onPractice: (itemId: string) => void;
  onGoToSources: () => void;
  onNewSession: () => void;
}) {
  const heading = useFocusOnChange<HTMLHeadingElement>(offer);
  if (offer.kind === "missing_source") {
    return (
      <div className="page page-quiet">
        <p className="index-label">Study</p>
        <h2 ref={heading} tabIndex={-1}>
          No practice item is ready
        </h2>
        <p>{offer.reason} Pick which Canvas material to practice from, or start with a practice packet.</p>
        <button type="button" className="primary" onClick={onGoToSources}>
          Choose material
        </button>
      </div>
    );
  }
  if (offer.kind === "no_eligible_item") {
    return (
      <div className="page page-quiet">
        <p className="index-label">Study</p>
        <h2 ref={heading} tabIndex={-1}>
          {offer.action === "stop" ? "That is everything for this session" : "Nothing is ready yet"}
        </h2>
        <p>{offer.reason}</p>
        <div className="row">
          {offer.action === "stop" ? (
            <button type="button" onClick={onNewSession}>
              Start a new session
            </button>
          ) : (
            <button type="button" className="primary" onClick={onGoToSources}>
              {offer.action === "create" ? "Write a question" : "Choose material"}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (offer.kind === "needs_exam_date" || offer.kind === "no_pre_exam_slot") {
    return (
      <div className="page page-quiet">
        <p className="index-label">Study</p>
        <h2 ref={heading} tabIndex={-1}>
          {offer.kind === "needs_exam_date" ? "Add the exam date first" : "No slot before the exam"}
        </h2>
        <p>{offer.reason}</p>
        <button type="button" onClick={onGoToSources}>
          Set the exam date
        </button>
      </div>
    );
  }
  if (offer.kind === "no_review_needed") {
    const alt = offer.alternatives[0];
    return (
      <div className="page page-quiet">
        <p className="index-label">Study</p>
        <h2 ref={heading} tabIndex={-1}>
          Nothing is due right now
        </h2>
        <p>
          {offer.reason} Next offer {fmtWhen(offer.next_at)}.
        </p>
        <div className="row">
          {alt && (
            <button type="button" onClick={() => onPractice(alt.item_id)}>
              {alt.label}
            </button>
          )}
        </div>
      </div>
    );
  }
  const item = offer.item!;
  return <EligibleOffer offer={offer} item={item} headingRef={heading} onStart={onStart} onPractice={onPractice} />;
}

function EligibleOffer({
  offer,
  item,
  headingRef,
  onStart,
  onPractice,
}: {
  offer: Offer;
  item: PublicItem;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onStart: (item: PublicItem, mode: Mode) => void;
  onPractice: (itemId: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(offer.mode ?? "review");
  const total = offer.timeline.reduce((sum, b) => sum + b.seconds, 0);
  return (
    <div className="page offer">
      <p className="eyebrow">
        {item.course} · {item.objective_label}
      </p>
      <h2 ref={headingRef} tabIndex={-1}>
        {mode === "learn" ? "Learn with one example" : mode === "practice" ? "Practice" : "One check"}
      </h2>
      <div className="mode-rail" role="group" aria-label="Study mode">
        {(
          [
            ["review", "Check", IconQuiz],
            ["learn", "Learn", IconLearn],
            ["practice", "Practice", IconPractice],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={mode === id} aria-label={label} onClick={() => setMode(id)}>
            <Icon />
          </button>
        ))}
      </div>
      <p className="why">
        <strong>Why this:</strong> {offer.why}
      </p>
      {offer.eligibility_note && <p className="muted">{offer.eligibility_note}</p>}
      {offer.resume && offer.resume.status !== "assessed" && (
        <p className="notice">A saved draft from {fmtWhen(offer.resume.started_at)} will be restored.</p>
      )}
      <ol className="timeline" aria-label={`Planned ${fmtSeconds(total)} — a scope, not a cutoff`}>
        {offer.timeline.map((block) => (
          <li key={block.label}>
            <span>{block.label}</span>
            <span className="mono">{fmtSeconds(block.seconds)}</span>
          </li>
        ))}
      </ol>
      <p className="muted">Planned {fmtSeconds(total)}. Nothing submits or ends on a timer.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => onStart(item, mode)}>
          {mode === "learn" ? "Start with the example" : "Answer now"}
        </button>
        <AskPanel
          label="Ask about this item"
          seed={{ content: item.stem, courseHint: item.course, assignmentHint: item.objective_label }}
        />
        {mode !== "learn" && item.has_example && (
          <button type="button" onClick={() => onStart(item, "learn")}>
            Show an example first
          </button>
        )}
      </div>
      {offer.alternatives.length > 0 && (
        <details>
          <summary>Other items ready now</summary>
          <ul>
            {offer.alternatives.map((alt) => (
              <li key={alt.item_id}>
                <button type="button" className="link" onClick={() => onPractice(alt.item_id)}>
                  {alt.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function courseColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % 360;
  return `hsl(${h} 42% 52%)`;
}

function NowPlaying({
  title,
  course,
  startedAt,
  plannedSeconds,
  onStop,
}: {
  title: string;
  course: string;
  startedAt: string;
  plannedSeconds: number;
  onStop: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const frozen = useRef(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => {
      const n = Math.max(0, Math.round((Date.now() - start) / 1000));
      if (paused) return;
      frozen.current = n;
      setElapsed(n);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, paused]);
  const pct = plannedSeconds > 0 ? Math.min(100, (elapsed / plannedSeconds) * 100) : 0;
  return (
    <div className="tape" data-now-playing="" style={{ ["--course" as string]: courseColor(course) }}>
      <div
        className="tape-track"
        role="progressbar"
        aria-label="Session position"
        aria-valuemin={0}
        aria-valuemax={plannedSeconds}
        aria-valuenow={Math.min(elapsed, plannedSeconds)}
        aria-valuetext={`${fmtSeconds(elapsed)} of ${fmtSeconds(plannedSeconds)} planned`}
      >
        <span className="tape-head" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>
      <p className="mono tape-readout">
        <span className="np-title">{title}</span>
        <span className="np-elapsed">
          {fmtSeconds(elapsed)} / {fmtSeconds(plannedSeconds)}
          {paused ? " · paused" : ""}
        </span>
      </p>
      <div className="tape-controls">
        <button type="button" className="btn-icon" aria-label={paused ? "Resume" : "Pause"} onClick={() => setPaused((p) => !p)}>
          <IconPause />
        </button>
        <button type="button" className="btn-icon ghost stop" aria-label="Stop" onClick={onStop}>
          <IconStop />
        </button>
      </div>
    </div>
  );
}

function AttemptPanel({
  started,
  item,
  minutes,
  announce,
  onAssessed,
  onSkipped,
  onError,
}: {
  started: Started;
  item: PublicItem;
  minutes: number;
  announce: (text: string) => void;
  onAssessed: (result: Assessed) => void;
  onSkipped: () => void;
  onError: (error: StudyRequestError, retry: () => void) => void;
}) {
  const attempt = started.attempt;
  const heading = useFocusOnChange<HTMLHeadingElement>(attempt.attempt_id);
  const [fields, setFields] = useState<Record<string, string>>(() => {
    if (Object.keys(attempt.fields).length) return attempt.fields;
    return parseDraft(attempt.draft, item);
  });
  const [saveState, setSaveState] = useState<string>(attempt.draft_saved_at ? `Draft restored (${fmtWhen(attempt.draft_saved_at)})` : "");
  const [hint, setHint] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selfOutcome, setSelfOutcome] = useState<string>("");
  const [example, setExample] = useState<Example | null>(started.example ?? null);
  const [exampleOpen, setExampleOpen] = useState(true);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const revision = useRef<number>(attempt.draft_revision);
  const lastSaved = useRef<string>(attempt.draft);
  const latest = useRef<string>("");
  const scored = item.fields.filter((f) => f.scored);
  const needsSelf = scored.length === 0;

  const serialized = serializeDraft(fields, item);
  latest.current = serialized;

  const persist = useCallback(
    async (text: string) => {
      if (text === lastSaved.current) return;
      try {
        const saved = await study.draft(attempt.attempt_id, text, revision.current);
        revision.current = saved.revision;
        lastSaved.current = text;
        setSaveState(`Saved ${fmtWhen(saved.saved_at)}`);
      } catch (e) {
        const code = e instanceof StudyRequestError ? e.code : "";
        setSaveState(code === "draft_revision_conflict" ? "Not saved — this attempt was edited elsewhere; reload" : "Not saved — check disk space");
        console.error(e);
      }
    },
    [attempt.attempt_id]
  );

  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(serialized), 800);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [serialized, persist]);

  // Unmount (tab switch, window close) flushes instead of cancelling the
  // pending save, so the last 800ms of typing are not lost (audit A finding).
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (dirty.current) void persist(latest.current);
    },
    [persist]
  );

  const update = (id: string, value: string) => {
    dirty.current = true;
    setSaveState("Saving…");
    setFields((prev) => ({ ...prev, [id]: value }));
  };

  const submit = async () => {
    if (busy) return;
    if (needsSelf && !selfOutcome) {
      announce("Choose how your answer compares with the rubric before saving.");
      return;
    }
    setBusy(true);
    announce("Checking your answer…");
    // The submit carries the answer; a pending draft save would land on an
    // attempt that is already assessed (the core rejects it).
    if (timer.current) window.clearTimeout(timer.current);
    try {
      const result = await study.submit(attempt.attempt_id, serialized, fields, needsSelf ? selfOutcome : null);
      dirty.current = false;
      announce(`${OUTCOME_LABEL[result.assessment.outcome]}. ${result.assessment.copy}`);
      onAssessed(result);
    } catch (e) {
      const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
      onError(error, submit);
    } finally {
      setBusy(false);
    }
  };

  const askHint = async () => {
    try {
      const res = await study.hint(attempt.attempt_id);
      setHint(res.hint);
      announce("Hint shown. This attempt now counts as assisted.");
    } catch (e) {
      const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
      onError(error, askHint);
    }
  };

  const doReveal = async () => {
    try {
      const res = await study.reveal(attempt.attempt_id);
      setRevealed(res);
      setConfirmReveal(false);
      announce("Source and solution shown. This attempt no longer earns delayed credit.");
    } catch (e) {
      const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
      onError(error, doReveal);
    }
  };

  const skip = async () => {
    try {
      await study.skip(attempt.attempt_id);
      onSkipped();
    } catch (e) {
      const error = e instanceof StudyRequestError ? e : new StudyRequestError("internal", String(e));
      onError(error, skip);
    }
  };

  const planned = started.timeline.reduce((s, b) => s + b.seconds, 0);

  return (
    <form
      className="page attempt"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="eyebrow">
        {item.course} · {item.neutral_locator} · {attempt.mode === "learn" ? "learning" : attempt.mode === "practice" ? "practice" : "check"}
        {attempt.clock_status !== "trusted" ? " · clock uncertain" : ""}
      </p>
      <h2 ref={heading} tabIndex={-1}>
        {item.stem}
      </h2>
      <NowPlaying title={item.stem} course={item.course} startedAt={attempt.started_at} plannedSeconds={planned} onStop={() => void skip()} />

      {example && (
        <details className="example" open={exampleOpen} onToggle={(e) => setExampleOpen((e.target as HTMLDetailsElement).open)}>
          <summary>{example.title ?? "Worked example"}</summary>
          <p>{example.text}</p>
          {example.faded_step && <p className="muted">Faded step: {example.faded_step}</p>}
          <button type="button" className="link" onClick={() => setExample(null)}>
            Hide the example while I answer
          </button>
        </details>
      )}

      {item.fields.map((field) => (
        <FieldInput key={field.id} field={field} value={fields[field.id] ?? ""} onChange={(v) => update(field.id, v)} />
      ))}

      {needsSelf && (
        <fieldset className="self-check">
          <legend>Compare your answer with the rubric — this is your own check, not a verified score</legend>
          {["correct", "partial", "incorrect"].map((value) => (
            <label key={value}>
              <input type="radio" name="self-outcome" value={value} checked={selfOutcome === value} onChange={() => setSelfOutcome(value)} />
              {OUTCOME_LABEL[value]}
            </label>
          ))}
        </fieldset>
      )}

      {hint && (
        <p className="notice" role="note">
          <strong>Hint:</strong> {hint}
        </p>
      )}
      {revealed && (
        <section className="revealed" aria-label="Source and solution">
          {revealed.sources.map((s) => (
            <details key={s.id} open>
              <summary>{s.locator}</summary>
              <pre className="source-text">{s.text}</pre>
            </details>
          ))}
          <KeyBlock keyView={revealed.key} />
        </section>
      )}

      <p className="save-state" aria-live="polite">
        {saveState}
      </p>
      <div className="row actions">
        <button type="submit" className="primary" disabled={busy}>
          {needsSelf ? "Save my check" : "Check my answer"}
        </button>
        {item.has_hint && !hint && (
          <button type="button" onClick={() => void askHint()} disabled={busy}>
            Hint
          </button>
        )}
        {!revealed && !confirmReveal && (
          <button type="button" onClick={() => setConfirmReveal(true)} disabled={busy}>
            Show source
          </button>
        )}
        {confirmReveal && (
          <span className="confirm">
            Showing the source ends delayed credit for this attempt.{" "}
            <button type="button" onClick={() => void doReveal()}>
              Show it
            </button>{" "}
            <button type="button" onClick={() => setConfirmReveal(false)}>
              Keep going
            </button>
          </span>
        )}
        <button type="button" className="ghost" onClick={() => void skip()} disabled={busy}>
          Skip
        </button>
      </div>
      <p className="muted">
        Session: {minutes} min. Your draft is saved as you type; closing the app keeps this attempt and its history.
      </p>
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: { id: string; label: string; kind: string; options: string[]; scored: boolean }; value: string; onChange: (v: string) => void }) {
  const id = `field-${field.id}`;
  if (field.kind === "choice" && field.options.length) {
    return (
      <fieldset className="field">
        <legend>
          {field.label}
          {!field.scored && <span className="muted"> (not scored)</span>}
        </legend>
        {field.options.map((opt) => (
          <label key={opt}>
            <input type="radio" name={id} value={opt} checked={value === opt} onChange={() => onChange(opt)} />
            {opt}
          </label>
        ))}
      </fieldset>
    );
  }
  if (field.kind === "long_text" || field.kind === "text" && !field.scored) {
    return (
      <div className="field">
        <label htmlFor={id}>
          {field.label}
          {!field.scored && <span className="muted"> (not scored)</span>}
        </label>
        <textarea id={id} rows={field.kind === "long_text" ? 6 : 3} value={value} onChange={(e) => onChange(e.target.value)} spellCheck />
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
    </div>
  );
}

function KeyBlock({ keyView }: { keyView: Assessed["key"] }) {
  const hidden = ["explanation", "support_refs", "provenance_label", "reference", "provenance", "validated_by", "historical_version"];
  const entries = Object.entries(keyView).filter(([k]) => !hidden.includes(k));
  return (
    <div className="key">
      <p className="eyebrow">Solution · {keyView.provenance_label}</p>
      {typeof keyView.historical_version === "number" && (
        <p className="notice">This source changed after you started; shown as it was (version {keyView.historical_version}). Nothing was scored.</p>
      )}
      {entries.map(([k, v]) => (
        <p key={k}>
          <strong>{k.replace(/_/g, " ")}:</strong> {String(v)}
        </p>
      ))}
      {keyView.reference && (
        <p>
          <strong>Reference response:</strong> {keyView.reference}
        </p>
      )}
      {keyView.explanation && <p>{keyView.explanation}</p>}
      {keyView.support_refs && keyView.support_refs.length > 0 && <p className="muted">Support: {keyView.support_refs.join(", ")}</p>}
    </div>
  );
}

function FeedbackPanel({ result, item, announce, onNext }: { result: Assessed; item: PublicItem; announce: (t: string) => void; onNext: () => void }) {
  const heading = useFocusOnChange<HTMLHeadingElement>(result.attempt.attempt_id);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [ai, setAi] = useState<AiFeedback | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    aiStudy
      .status()
      .then((st) => setAiConnected(Boolean(st.connected)))
      .catch(() => setAiConnected(false));
  }, []);
  const askAi = async (regenerate = false) => {
    setAiBusy(true);
    try {
      const res = await aiStudy.feedback(result.attempt.attempt_id, regenerate);
      setAi(res);
      announce(res.copy);
    } catch (e) {
      setAi({ status: "failed", request_id: "", proposal: null, support_rows: [], model_id: null, copy: e instanceof Error ? e.message : String(e) });
    } finally {
      setAiBusy(false);
    }
  };
  const [reported, setReported] = useState(result.attempt.assistance === "unknown");
  const [disagreed, setDisagreed] = useState(result.attempt.outcome === "uncertain");
  const [evidence, setEvidence] = useState(result.assessment.evidence);
  const [state, setState] = useState(result.state);
  const a = result.assessment;

  const reportHelp = async () => {
    try {
      const res = (await study.reportHelp(result.attempt.attempt_id, "student report")) as { attempt: { evidence: string }; state: Assessed["state"] };
      setReported(true);
      setEvidence(res.attempt.evidence as Assessed["assessment"]["evidence"]);
      setState(res.state);
      announce("Help noted; a later independent check will be more informative.");
    } catch (e) {
      console.error(e);
    }
  };
  const disagree = async () => {
    try {
      const res = (await study.disagree(result.attempt.attempt_id, "student disagrees")) as { attempt: { evidence: string }; state: Assessed["state"] };
      setDisagreed(true);
      setEvidence(res.attempt.evidence as Assessed["assessment"]["evidence"]);
      setState(res.state);
      announce("Saved as uncertain. Both your answer and the key are kept.");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="page feedback">
      <aside className="margin-note">
      <p className="eyebrow">
        {item.course} · {item.neutral_locator}
      </p>
      <h2
        ref={heading}
        tabIndex={-1}
        aria-label={disagreed ? "Saved as uncertain" : OUTCOME_LABEL[a.outcome]}
      >
        {disagreed ? "Saved as uncertain" : <LetterFlip text={OUTCOME_LABEL[a.outcome]} />}
        {a.scope ? <span className="scope"> — checked: {a.scope}</span> : null}
      </h2>
      <p className="evidence">
        <span className={`chip chip-${evidence}`}>{EVIDENCE_LABEL[evidence] ?? evidence}</span> {a.copy}
      </p>
      {a.grader === "student_self" && <p className="muted">Recorded as your own check; it does not change the schedule.</p>}
      {a.grader === "abstained" && <p className="muted">Nothing here can be checked automatically.</p>}
      </aside>
      <div className="feedback-body">
      {a.checker && a.checker.fields.some((f) => f.scored) && (
        <ul className="field-results grouped">
          {a.checker.fields
            .filter((f) => f.scored)
            .map((f) => (
              <li key={f.field_id} className={f.passed ? "pass" : "miss"}>
                <span aria-hidden="true">{f.passed ? "✓" : "✕"}</span> {f.label}
                {f.note ? ` — ${f.note}` : ""}
              </li>
            ))}
        </ul>
      )}
      {result.feedback && <p className="feedback-text">{result.feedback}</p>}
      <KeyBlock keyView={result.key} />
      <details>
        <summary>Source</summary>
        {result.sources.map((s) => (
          <div key={s.id}>
            <p className="eyebrow">{s.locator}</p>
            <pre className="source-text">{s.text}</pre>
          </div>
        ))}
      </details>
      <div className="next">
        <p>
          <strong>Stability:</strong> {STABILITY_LABEL[state.stability]} · {state.hits} counted {state.hits === 1 ? "check" : "checks"}
        </p>
        {state.schedule_status === "no_pre_exam_slot" ? (
          <p>No slot remains before the exam; practice stays available.</p>
        ) : (
          state.effective_due && <p>Next offer {fmtWhen(state.effective_due)}.</p>
        )}
        {state.independent_check_no_earlier_than && <p className="muted">An independent check counts no earlier than {fmtWhen(state.independent_check_no_earlier_than)}.</p>}
      </div>
      {aiConnected && (
        <section className="ai" aria-label="AI feedback (provisional)">
          {!ai && (
            <button type="button" disabled={aiBusy} onClick={() => void askAi()}>
              {aiBusy ? "Asking…" : "Ask for AI feedback (provisional)"}
            </button>
          )}
          {ai && (
            <>
              <p className="eyebrow">AI feedback · provisional{ai.model_id ? ` · ${ai.model_id}` : ""}</p>
              {ai.proposal && ai.status === "complete" && (
                <>
                  <p>
                    <strong>Suggested reading:</strong> {OUTCOME_LABEL[ai.proposal.outcome] ?? ai.proposal.outcome}. {ai.proposal.feedback}
                  </p>
                  {ai.support_rows.length > 0 && (
                    <ul className="support-rows">
                      {ai.support_rows.map((r, i) => (
                        <li key={i}>
                          <span className="chip">{r.status.replace(/_/g, " ")}</span> {r.locator}: “{r.quote}”
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="muted">{ai.copy}</p>
              <div className="row">
                {(ai.status === "pending_unknown" || ai.status === "billing_unknown") && (
                  <button type="button" disabled={aiBusy} onClick={() => void askAi(false)}>
                    Check again
                  </button>
                )}
                {ai.status !== "refused" && (
                  <button type="button" disabled={aiBusy} onClick={() => void askAi(true)}>
                    Ask again (new request)
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}
      <div className="row actions">
        <button type="button" className="primary" onClick={onNext}>
          Next
        </button>
        {!reported && (
          <button type="button" onClick={() => void reportHelp()}>
            I used outside help
          </button>
        )}
        {!disagreed && a.grader !== "abstained" && (
          <button type="button" onClick={() => void disagree()}>
            I disagree with this grading
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

function serializeDraft(fields: Record<string, string>, item: PublicItem): string {
  return item.fields
    .map((f) => (fields[f.id] ? `${f.label}: ${fields[f.id]}` : ""))
    .filter(Boolean)
    .join("\n");
}

function parseDraft(draft: string, item: PublicItem): Record<string, string> {
  const out: Record<string, string> = {};
  if (!draft) return out;
  const lines = draft.split("\n");
  for (const field of item.fields) {
    const prefix = `${field.label}: `;
    const idx = lines.findIndex((l) => l.startsWith(prefix));
    if (idx >= 0) {
      const rest = [lines[idx].slice(prefix.length)];
      for (let i = idx + 1; i < lines.length; i += 1) {
        if (item.fields.some((f) => lines[i].startsWith(`${f.label}: `))) break;
        rest.push(lines[i]);
      }
      out[field.id] = rest.join("\n");
    }
  }
  if (Object.keys(out).length === 0 && item.fields.length === 1) out[item.fields[0].id] = draft;
  return out;
}
