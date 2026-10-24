/**
 * One rule for "the student is done with this", authored here and nowhere else.
 *
 * Three predicates used to disagree: the semester surface counted any score and
 * any submission, week.md counted only submitted/graded/pending_review, and the
 * app re-derived its own set from `submission_state`. A student with an unposted
 * teacher-entered grade saw finished work reappear as outstanding.
 *
 * The canonical reconciler is the authority, and `bucketWorkItem` already draws
 * the line this follows, in its order:
 *
 *   late            -> overdue   (checked before graded: a late submission may
 *                                 still need the student to act, grade or not)
 *   submitted,
 *   pending_review,
 *   graded          -> finished
 *   anything else   -> not finished, so a bare score still counts as done,
 *                      which is the unposted teacher-entered grade case
 *
 * `submission_state` is lossy by design (one string), so readers take the
 * boolean from here instead of re-deriving it. Work state carries the result as
 * `canvas.completed`; browser/tests/work-completion.test.mjs is the parity gate.
 */

/** `submission_state` values that mean turned in or resolved. `late` is overdue. */
export const SUBMITTED_STATES = ["graded", "submitted", "pending_review"];

const SUBMITTED = new Set(SUBMITTED_STATES);

/** Lateness outranks a grade, matching bucketWorkItem's own order. */
function isLate(state, submission) {
  if (String(state || "").toLowerCase() === "late") return true;
  return Boolean(submission?.late);
}

/** Raw Canvas submission, as study-sources sees it straight off `/api/v1`. */
export function completeFromSubmission(submission) {
  if (!submission || typeof submission !== "object") return false;
  const wf = String(submission.workflow_state || "").toLowerCase();
  if (isLate(wf, submission)) return false;
  if (SUBMITTED.has(wf)) return true;
  if (submission.score != null) return true;
  return Boolean(submission.submitted_at);
}

/** Reconciled canonical item, which keeps score beside the collapsed state. */
export function completeFromItem(item) {
  if (!item || typeof item !== "object") return false;
  const state = String(item.submission_state || "");
  if (isLate(state, null)) return false;
  if (SUBMITTED.has(state)) return true;
  return item.score != null;
}
