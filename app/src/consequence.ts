/*
 * Consequence sentence (MASTER §06): what happens to the grade if an item is
 * skipped or done, from browser/scripts/lib/skip-cost.mjs. Never invented:
 * no usable number means no sentence.
 */

export type SkipCost = {
  course_id: string;
  assignment_id: string;
  title?: string;
  current: number | null;
  if_zero: number | null;
  if_full: number | null;
  swing: number | null;
  share_of_final: number | null;
  status: "ok" | "estimate" | "cannot_calculate";
};

export type SkipCosts = Record<string, SkipCost>;

/** Semester ticks are `item-a<assignment id>`; skip costs are keyed `<course>:<assignment>`. */
export function skipCostFor(costs: SkipCosts | null | undefined, tick: { course_id: string; id: string }): SkipCost | null {
  if (!costs) return null;
  const m = /^item-a(.+)$/.exec(tick.id);
  const assignment = m ? m[1] : tick.id;
  return costs[`${tick.course_id}:${assignment}`] ?? null;
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

export function consequenceSentence(cost: SkipCost | null | undefined, courseLabel?: string): string | null {
  if (!cost || cost.status === "cannot_calculate" || cost.if_zero == null) return null;
  const where = courseLabel ? ` in ${courseLabel}` : "";
  const estimate = cost.status === "estimate" ? " An estimate." : "";
  if (cost.current != null) {
    if (Math.abs(cost.current - cost.if_zero) < 0.05) return null;
    const full =
      cost.if_full != null && cost.if_full - cost.current >= 0.05 ? ` Full marks: ${pct(cost.if_full)}.` : "";
    return `Skip it: ${pct(cost.current)} → ${pct(cost.if_zero)}${where}.${full}${estimate}`;
  }
  if (cost.share_of_final != null && cost.share_of_final >= 0.5) {
    return `Worth ${pct(cost.share_of_final)} of your final grade${where}.${estimate}`;
  }
  return null;
}
