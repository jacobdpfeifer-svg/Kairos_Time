// Purpose: study times and evidence labels
export function fmtWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  }).format(date);
  const labeled = `${time} (${zone})`;
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `today ${labeled}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow ${labeled}`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(date);
  return `${day} ${labeled}`;
}

export function fmtSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const EVIDENCE_LABEL: Record<string, string> = {
  delayed_independent_retrieval: "Delayed check — counted",
  delayed_check: "Delayed check",
  baseline_response: "Baseline",
  immediate_practice: "Practice (early)",
  acquisition_only: "Learning from the example",
  assisted_response: "With a hint",
  exposed_response: "After seeing the solution",
  unknown_assistance: "Outside help noted",
  unverified_response: "Your own check",
  clock_uncertain: "Clock uncertain",
  no_evidence: "Not scored",
  invalidated: "Grading withdrawn",
};

export const OUTCOME_LABEL: Record<string, string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not yet",
  skipped: "Skipped",
  interrupted: "Interrupted",
  uncertain: "Not scored",
};

export const STABILITY_LABEL: Record<string, string> = {
  fragile: "fragile",
  holding: "holding",
  durable: "durable",
};
