// Purpose: study question form and modes
import { useEffect, useState } from "react";
import { StudyRequestError, study } from "../study/api";
import type { AskEnvelope, AskResponse } from "../study/types";

const MODES = [
  ["answer_now", "Answer now"],
  ["walkthrough", "Walk me through it"],
  ["mastery", "Help me learn it"],
  ["make_handle", "Draft or checklist"],
] as const;

const BOUNDARIES = [
  ["open_practice", "Practice"],
  ["open_homework", "Homework"],
  ["live_assessment", "A quiz or exam I'm taking"],
  ["administration", "A form or admin task"],
  ["external_tool", "Work in an outside tool"],
] as const;

export function AskPanel({
  onResult,
  onActive,
  seed,
  label = "Ask",
  initial = null,
  onConnectAi,
  startOpen = false,
  onCancel,
  onNextStep,
}: {
  onResult?: (result: AskEnvelope | null) => void;
  onActive?: (active: boolean) => void;
  seed?: { content: string; courseHint?: string; assignmentHint?: string };
  label?: string;
  initial?: AskEnvelope | null;
  /** Opens Settings → AI help; shown when an answer stayed local because AI help isn't connected. */
  onConnectAi?: () => void;
  /** Start on the question form (the Ask sheet). */
  startOpen?: boolean;
  /** Leave Ask without asking; shown as Cancel next to the submit button. */
  onCancel?: () => void;
  /** Turn the answer's next step into a row the student keeps. */
  onNextStep?: (title: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [content, setContent] = useState(seed?.content ?? "");
  const [result, setResult] = useState<AskEnvelope | null>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [course, setCourse] = useState(initial?.context?.course_label ?? "");
  const [assignment, setAssignment] = useState(initial?.context?.assignment_label ?? "");
  const [boundary, setBoundary] = useState(initial?.classification?.boundary || "open_practice");
  const [due, setDue] = useState(initial?.context?.due ?? "");

  const apply = (next: AskEnvelope | null) => {
    setResult(next);
    onResult?.(next);
  };

  const run = async (params: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      apply(await study.askCreate(params));
    } catch (err) {
      setError(err instanceof StudyRequestError ? err.message : "Ask did not save.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial?.input_id) setResult(initial);
  }, [initial]);

  const response: AskResponse | undefined = result?.response;
  const active = open || Boolean(response);

  useEffect(() => {
    onActive?.(active);
  }, [active, onActive]);

  useEffect(() => {
    if (!result) return;
    setCourse(result.context?.course_label ?? "");
    setAssignment(result.context?.assignment_label ?? "");
    setBoundary(result.classification?.boundary || "open_practice");
    setDue(result.context?.due ?? "");
  }, [result]);

  const saveChip = () => {
    if (!result?.input_id) return;
    setBusy(true);
    setError("");
    void study
      .askCorrect(result.input_id, { course, assignment, boundary, due })
      .then((next) => apply(next))
      .catch((err: unknown) => setError(err instanceof StudyRequestError ? err.message : "Chip did not update."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ask-panel">
      {!open && !response && (
        <button type="button" onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      {open && !response && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              content,
              content_kind: "text",
              session_goal: "unknown",
              course_hint: seed?.courseHint ?? "",
              assignment_hint: seed?.assignmentHint ?? "",
            });
          }}
        >
          <label>
            <span className="index-label">What do you need help with?</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={4}
              required
              data-autofocus
            />
          </label>
          <div className="row ask-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Working" : "Get a next step"}
            </button>
            {(onCancel || !startOpen) && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setOpen(false);
                  onCancel?.();
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {response && result?.input_id && (
        <article className="ask-result" aria-live="polite">
          <h2>{response.one_sentence}</h2>
          <p>{response.explanation}</p>
          <p className="muted ask-chip">{response.context_chip}</p>
          <details className="ask-correct">
            <summary>Not the right class or assignment?</summary>
          <div className="ask-chip-fields">
            <label>
              Course
              <input value={course} onChange={(event) => setCourse(event.target.value)} />
            </label>
            <label>
              Assignment
              <input value={assignment} onChange={(event) => setAssignment(event.target.value)} />
            </label>
            <label>
              What kind of work it is
              <select value={boundary} onChange={(event) => setBoundary(event.target.value)}>
                {BOUNDARIES.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due
              <input value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
            <button type="button" onClick={saveChip} disabled={busy}>
              Use these
            </button>
          </div>
          </details>
          {result.context?.conflicts?.length ? (
            <ul className="ask-conflicts">
              {result.context.conflicts.map((conflict) => (
                <li key={`${conflict.field}:${conflict.note ?? ""}`}>
                  {conflict.field} disagrees. Canvas {conflict.canvas || "has no date"}. Your correction {conflict.note || "is blank"}.
                </li>
              ))}
            </ul>
          ) : null}
          <p className="muted">
            {response.check_status === "checked" ? "Checked." : response.check_status === "blocked" ? "Blocked." : "Not independently checked."}{" "}
            {response.assumptions}
          </p>
          {response.prose === "not_generated" && <p className="muted">Prose was not generated.</p>}
          {response.relay === "not_connected" && (
            <p className="muted ask-relay-note">
              This answer comes from your Canvas material and files only. AI help isn't connected.{" "}
              {onConnectAi && (
                <button type="button" className="link" onClick={onConnectAi}>
                  Connect AI help
                </button>
              )}
            </p>
          )}
          {response.relay === "unavailable" && (
            <p className="muted ask-relay-note">AI help didn't answer this time, so this comes from your Canvas material and files only.</p>
          )}
          <div className="ask-next">
            <p>
              <strong>Next step:</strong> {response.next_action.title}
            </p>
            {onNextStep && response.next_action.title && (
              <button type="button" onClick={() => onNextStep(response.next_action.title)}>
                Add to today
              </button>
            )}
          </div>
          <div className="row" role="group" aria-label="Answer mode">
            {MODES.map(([id, modeLabel]) => (
              <button
                key={id}
                type="button"
                aria-pressed={response.response_mode === id}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void study
                    .askMode(result.input_id as string, id)
                    .then((next) => apply(next))
                    .catch((err: unknown) => setError(err instanceof StudyRequestError ? err.message : "Mode did not switch."))
                    .finally(() => setBusy(false));
                }}
              >
                {modeLabel}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="link"
            onClick={() => {
              setResult(null);
              setOpen(true);
              onResult?.(null);
            }}
          >
            Ask something else
          </button>
        </article>
      )}
      {error && (
        <p role="alert" className="ask-error">
          {error}
        </p>
      )}
    </div>
  );
}
