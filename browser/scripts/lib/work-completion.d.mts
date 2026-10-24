/** `submission_state` values that mean turned in or resolved. `late` is overdue. */
export const SUBMITTED_STATES: readonly string[];

export function completeFromSubmission(
  submission: { workflow_state?: string; score?: number | null; submitted_at?: string | null; late?: boolean } | null | undefined,
): boolean;

export function completeFromItem(
  item: { submission_state?: string; score?: number | null } | null | undefined,
): boolean;
