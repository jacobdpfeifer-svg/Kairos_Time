import type { SemesterTick } from "./ipc";

export const TICK_HIT = 12;
const HEIGHT_FLOOR = 14;
const HEIGHT_CAP = 40;

export function tickHeightPx(tick: Pick<SemesterTick, "kind" | "weight_share">): number {
  const share = Math.max(0, Math.min(1, tick.weight_share || 0));
  let h = HEIGHT_FLOOR + share * (HEIGHT_CAP - HEIGHT_FLOOR);
  if (tick.kind === "exam") h = Math.max(h, 32);
  else if (tick.kind === "quiz") h = Math.max(h, 22);
  return Math.round(Math.min(HEIGHT_CAP, Math.max(HEIGHT_FLOOR, h)));
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "exam":
      return "Exam";
    case "quiz":
      return "Quiz";
    case "discussion":
      return "Discussion";
    case "assignment":
      return "Homework";
    default:
      return "Item";
  }
}

export type TickCluster = {
  id: string;
  ticks: SemesterTick[];
  due_at: string;
  x: number;
};

/** Cluster ticks that sit closer than 8px at the current axis width. */
export function clusterTicks(
  ticks: SemesterTick[],
  windowStart: string,
  windowEnd: string,
  widthPx: number,
  thresholdPx = 8
): TickCluster[] {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  const span = Math.max(1, end - start);
  const placed = ticks
    .filter((t) => t.due_at)
    .map((t) => ({
      tick: t,
      x: ((Date.parse(t.due_at as string) - start) / span) * widthPx,
    }))
    .sort((a, b) => a.x - b.x);
  const clusters: TickCluster[] = [];
  for (const row of placed) {
    const last = clusters[clusters.length - 1];
    const small = tickHeightPx(row.tick) <= 18;
    if (last && small && Math.abs(row.x - last.x) < thresholdPx) {
      last.ticks.push(row.tick);
      last.x = (last.x * (last.ticks.length - 1) + row.x) / last.ticks.length;
    } else {
      clusters.push({
        id: row.tick.id,
        ticks: [row.tick],
        due_at: row.tick.due_at as string,
        x: row.x,
      });
    }
  }
  return clusters;
}

export const RANGE_KEY = "pn_semester_range";

export type RangeId = "1m" | "2m" | "3m" | "full";

export function loadRange(): RangeId {
  try {
    const raw = localStorage.getItem(RANGE_KEY);
    if (raw === "1m" || raw === "2m" || raw === "3m") return raw;
  } catch {
    /* storage blocked: fall through to the default */
  }
  return "full";
}

export function saveRange(range: RangeId): void {
  try {
    localStorage.setItem(RANGE_KEY, range);
  } catch {
    /* not remembered in private mode */
  }
}
