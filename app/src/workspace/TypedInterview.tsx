// Purpose: the typed workspace interview, one approved question per screen.
import { useEffect, useRef, useState } from "react";
import {
  draftFromAnswers,
  emptyAnswers,
  FRICTION_LABEL,
  INTERRUPT_KINDS,
  INTERRUPT_LABEL,
  PREFERENCE_LABEL,
  WORKFLOW_FRICTIONS,
  WORKFLOW_PREFERENCES,
  type InterviewAnswers,
} from "./interview";

const QUESTIONS = [
  "friction",
  "between",
  "canvas",
  "postpone",
  "ideal",
  "preference",
  "interrupt",
  "tools",
  "constraints",
] as const;

type QuestionId = (typeof QUESTIONS)[number];

const PROMPT: Record<QuestionId, string> = {
  friction: "When school feels harder than it needs to, what part of your workflow creates the most friction?",
  between: "What happens between learning about work and actually beginning it?",
  canvas: "When you open Canvas, what are you usually trying to figure out?",
  postpone: "What do you postpone, lose, duplicate, or repeatedly check?",
  ideal: "What would an ideal school-work day look like, from first glance to finished work?",
  preference: "Do you want one next step, a weekly overview, a course-by-course view, a study-first view, or the quietest possible view?",
  interrupt: "What should Kairos never interrupt you for, and which interruptions would actually help?",
  tools: "What inputs do you already rely on?",
  constraints: "What time, energy, attention, privacy, or device constraints should the workspace respect?",
};

export function TypedInterview({
  onDraft,
  onLater,
}: {
  onDraft: (draft: ReturnType<typeof draftFromAnswers>) => void;
  onLater: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<InterviewAnswers>(emptyAnswers);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const id = QUESTIONS[index];
  const last = index === QUESTIONS.length - 1;

  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  const next = () => {
    if (last) onDraft(draftFromAnswers(answers));
    else setIndex((n) => n + 1);
  };

  const toggleFriction = (friction: string) => {
    setAnswers((current) => {
      const has = current.frictions.includes(friction);
      const frictions = has ? current.frictions.filter((item) => item !== friction) : [...current.frictions, friction].slice(0, 3);
      return { ...current, frictions };
    });
  };

  const toggleInterrupt = (kind: string) => {
    setAnswers((current) => {
      const base = current.interrupt_for ?? [...INTERRUPT_KINDS];
      const interrupt_for = base.includes(kind) ? base.filter((item) => item !== kind) : [...base, kind];
      return { ...current, interrupt_for };
    });
  };

  return (
    <section className="nb-step" aria-labelledby="interview-title">
      <h1 id="interview-title" ref={heading} tabIndex={-1}>
        {PROMPT[id]}
      </h1>
      {id === "friction" && (
        <ul className="nb-results" aria-label="Frictions">
          {(WORKFLOW_FRICTIONS as readonly string[]).map((friction) => {
            const pressed = answers.frictions.includes(friction);
            const full = answers.frictions.length >= 3 && !pressed;
            return (
              <li key={friction}>
                <button type="button" aria-pressed={pressed} disabled={full} onClick={() => toggleFriction(friction)}>
                  {FRICTION_LABEL[friction] ?? friction}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {id === "preference" && (
        <ul className="nb-results" aria-label="Starting points">
          {(WORKFLOW_PREFERENCES as readonly string[]).map((preference) => (
            <li key={preference}>
              <button
                type="button"
                aria-pressed={answers.preference === preference}
                onClick={() => setAnswers((current) => ({ ...current, preference }))}
              >
                {PREFERENCE_LABEL[preference] ?? preference}
              </button>
            </li>
          ))}
        </ul>
      )}
      {id === "interrupt" && (
        <>
          <p className="nb-help">Leave a box on if that interruption would help.</p>
          <ul className="nb-results" aria-label="Interruptions">
            {INTERRUPT_KINDS.map((kind) => {
              const selected = (answers.interrupt_for ?? [...INTERRUPT_KINDS]).includes(kind);
              return (
                <li key={kind}>
                  <button type="button" aria-pressed={selected} onClick={() => toggleInterrupt(kind)}>
                    {INTERRUPT_LABEL[kind]}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {(id === "between" || id === "canvas" || id === "postpone" || id === "ideal" || id === "constraints") && (
        <textarea
          aria-label={PROMPT[id]}
          value={answers[id]}
          onChange={(event) => setAnswers((current) => ({ ...current, [id]: event.target.value }))}
        />
      )}
      {id === "tools" && (
        <>
          <p className="nb-help">Name anything you use. Kairos can't connect that.</p>
          <textarea
            aria-label={PROMPT[id]}
            value={answers.tools}
            placeholder="Notion, a paper planner"
            onChange={(event) => setAnswers((current) => ({ ...current, tools: event.target.value }))}
          />
        </>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={next}>
          {last ? "See the workspace" : "Continue"}
        </button>
        {!last && (
          <button type="button" className="link" onClick={() => setIndex((n) => n + 1)}>
            Skip this question
          </button>
        )}
        <button type="button" className="link" onClick={onLater}>
          Do this later
        </button>
      </div>
    </section>
  );
}
