/** Same ordering as `canvas_mcp.core.study.ask.rank_open_work`. */

export type Rankable = {
  id: string;
  title: string;
  due_at?: string | null;
  points?: number | null;
  points_possible?: number | null;
  completed?: boolean;
};

const MEANINGFUL_POINTS = 10;

function pointsOf(item: Rankable): number {
  const raw = item.points ?? item.points_possible ?? 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function rankOpenWork<T extends Rankable>(items: T[]): { recommendation: T | null; alternatives: T[] } {
  const open = items.filter((item) => !item.completed && item.due_at);
  const meaningful = open.filter((item) => pointsOf(item) >= MEANINGFUL_POINTS);
  const pool = (meaningful.length ? meaningful : open).slice().sort((a, b) => {
    const due = String(a.due_at).localeCompare(String(b.due_at));
    if (due !== 0) return due;
    return pointsOf(b) - pointsOf(a);
  });
  return { recommendation: pool[0] ?? null, alternatives: pool.slice(1, 3) };
}
