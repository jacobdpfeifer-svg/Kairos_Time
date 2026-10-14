import { useEffect, useRef, useState } from "react";
import { readDueReviews, recordReviewOutcome, type DueReview, type DueReviewsPayload, type ReviewOutcome, type ScoredReview } from "../ipc";

/*
 * Reviews due (Study path, first step): spaced checks from the learn loop
 * (learn_loop.py). One claim at a time, position as plain text, the student
 * scores it. Nothing is lost by skipping; there is no count of days in a row.
 */

const OUTCOMES: [ReviewOutcome, string][] = [
  ["miss", "I missed it"],
  ["partial", "Partly"],
  ["hit", "Got it"],
  ["skipped", "Skip for now"],
];

function nextLine(scored: ScoredReview): string {
  if (scored.next_review_at) {
    const when = new Date(scored.next_review_at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    return `Kairos will check this again ${when}.`;
  }
  if (scored.checkpoint_due) return `Kairos will check this again before ${scored.checkpoint_due}.`;
  return "Saved.";
}

export function ReviewsStep({ payload: payloadProp }: { payload?: DueReviewsPayload }) {
  const [payload, setPayload] = useState<DueReviewsPayload | null>(payloadProp ?? null);
  const [session, setSession] = useState(false);

  useEffect(() => {
    if (payloadProp) return;
    let alive = true;
    readDueReviews()
      .then((p) => alive && setPayload(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [payloadProp, session]);

  const items = payload?.items ?? [];
  if (!payload || (items.length === 0 && !session)) return null;

  return (
    <section className="reviews-step" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="today-section-title">
        Reviews due
      </h2>
      {session ? (
        <ReviewSession items={items} onFinished={() => setSession(false)} />
      ) : (
        <ul className="rows">
          <li className="path-current">
            <button type="button" className="row" onClick={() => setSession(true)}>
              <span className="row-main">
                <strong>{items.length === 1 ? "1 thing to check" : `${items.length} things to check`}</strong>
                <span className="row-meta">{payload.budget.line || "A few minutes. Each one is a quick recall, then you say how it went."}</span>
              </span>
              <span className="row-when">Start</span>
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}

export function ReviewSession({ items, onFinished }: { items: DueReview[]; onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const [scored, setScored] = useState<ScoredReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoring = useRef(false);

  const item = items[index];
  if (!item) return null;
  const last = index >= items.length - 1;

  const score = (outcome: ReviewOutcome) => {
    if (scoring.current) return;
    scoring.current = true;
    setBusy(true);
    setError(null);
    // A check of a previously scheduled item is a delayed attempt.
    recordReviewOutcome(item.id, outcome, false)
      .then((updated) => setScored(updated))
      .catch(() => {
        scoring.current = false;
        setError("That didn't save. Try again.");
      })
      .finally(() => setBusy(false));
  };

  const advance = () => {
    scoring.current = false;
    if (last) {
      onFinished();
      return;
    }
    setScored(null);
    setIndex((i) => i + 1);
  };

  return (
    <div className="review-session sheet" aria-live="polite">
      <p className="muted review-progress">
        {index + 1} of {items.length}, {item.course}
      </p>
      <p className="review-claim">{item.claim}</p>
      {!scored && item.start_with_example && <p className="muted">Try it from memory first. This won't show the answer.</p>}
      {!scored && item.kind === "procedural" && <p className="muted">Work one example, then say how it went.</p>}
      {scored ? (
        <>
          <p className="review-result">{nextLine(scored)}</p>
          <button type="button" className="primary" onClick={advance}>
            {last ? "Done" : "Next"}
          </button>
        </>
      ) : (
        <div className="row review-scores" role="group" aria-label="How did it go?">
          {OUTCOMES.map(([o, label]) => (
            <button key={o} type="button" className={o === "skipped" ? "ghost" : undefined} disabled={busy} onClick={() => score(o)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="ask-error">
          {error}
        </p>
      )}
      <button type="button" className="link" onClick={onFinished}>
        Stop for now
      </button>
    </div>
  );
}
