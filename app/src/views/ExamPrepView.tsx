// Purpose: shows a drafted exam plan
import { useMemo, useState } from "react";
import type { SemesterTick } from "../ipc";
import { buildExamPlan } from "../examPlan";

export function ExamPrepView({
  tick,
  sources,
  hasPractice,
  onBack,
  onTest,
  scope,
  scopeNote,
  onAddMaterial,
}: {
  tick: SemesterTick;
  sources: { title: string; text?: string; kind?: string; exam_relevant?: boolean; scope_topics?: string[] }[];
  hasPractice: boolean;
  onBack: () => void;
  onTest: () => void;
  /** What the exam covers, from the study core's exam record when it has one. */
  scope?: string[];
  /** Where the topics came from, in one plain sentence. */
  scopeNote?: string;
  /** Empty practice: go where material for this course is added. */
  onAddMaterial?: () => void;
}) {
  const [seed, setSeed] = useState(1);
  const today = useMemo(() => new Date(), []);
  const plan = useMemo(
    () =>
      buildExamPlan(
        {
          id: tick.id,
          title: tick.title,
          due_at: tick.due_at,
          course_label: tick.course_label,
          description: tick.description,
          objective_scope: scope,
        },
        sources,
        today,
        seed
      ),
    [tick, sources, today, seed, scope]
  );

  const dueLabel = tick.due_at
    ? new Date(tick.due_at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "No date";
  const daysLeft = tick.due_at ? Math.round((Date.parse(tick.due_at) - today.getTime()) / 86_400_000) : null;

  return (
    <section className="exam-prep scene-paper" style={{ ["--course" as string]: tick.color }}>
      <header className="exam-index">
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
        <span className="exam-when">
          {tick.course_label}, {dueLabel}
          {daysLeft === null
            ? ""
            : daysLeft === 0
              ? ". That's today."
              : daysLeft < 0
                ? `. That was ${-daysLeft} ${daysLeft === -1 ? "day" : "days"} ago.`
                : `. ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go.`}
        </span>
      </header>
      <h1 className="display exam-title">{tick.title}</h1>
      <p className="muted">A day-by-day plan up to the exam. Today is highlighted.</p>
      {scopeNote && <p className="exam-scope-note">{scopeNote}</p>}
      <ol className="ledger prep-days">
        {plan.days.map((d) => (
          <li key={d.date} className={`prep-day${d.isToday ? " today" : ""}`} aria-current={d.isToday ? "date" : undefined}>
            <span className="rail-body">
              <strong>{d.label}</strong>
              <span className="muted">{d.mode === "review" ? "Review" : "Study"}</span>
              <ul>
                {d.topics.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </span>
          </li>
        ))}
      </ol>
      <div className="stack-actions">
        {hasPractice ? (
          <button type="button" className="primary" onClick={onTest}>
            Practice for it
          </button>
        ) : (
          <p className="empty">
            No practice questions for this course yet. Add notes or a study guide and Kairos builds them.{" "}
            {onAddMaterial && (
              <button type="button" className="link" onClick={onAddMaterial}>
                Add material
              </button>
            )}
          </p>
        )}
        <button type="button" className="ghost" onClick={() => setSeed((s) => s + 1)}>
          Shuffle this plan
        </button>
        <p className="muted">Shuffles the order of topics across the days.</p>
      </div>
    </section>
  );
}
