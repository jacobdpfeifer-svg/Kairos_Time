import type { FreshnessChange, SemesterSurface, SemesterTick, WorkStateRead } from "../ipc";

type WorkItem = NonNullable<WorkStateRead["state"]>["work_items"][number];

/**
 * Legacy fallback only, for a generation promoted before work state carried an
 * authored `completed` field. The live rule is browser/scripts/lib/work-completion.mjs
 * and app/src/workState/completion.parity.test.ts holds this list to it.
 */
export const LEGACY_SUBMITTED = ["graded", "submitted", "pending_review"];
const SUBMITTED = new Set(LEGACY_SUBMITTED);

/** Freshness kinds that mean the same thing as a work-state `due_moved`. */
const DUE_KINDS = new Set(["due_changed", "due_moved"]);

/** Plan and semester rows still use item-a / item-q / cap ids. */
export function planKey(item: WorkItem): string | null {
  if (item.student.plan_id) return item.student.plan_id;
  const parts = item.id.split(":");
  if (parts[0] === "canvas" && parts[3] === "assignment" && parts[4]) return `item-a${parts[4]}`;
  if (parts[0] === "canvas" && parts[3] === "quiz" && parts[4]) return `item-q${parts[4]}`;
  if (item.id.startsWith("capture:")) return item.id.slice("capture:".length);
  return null;
}

export function submissionCompleted(submissionState: string): boolean {
  return SUBMITTED.has(submissionState);
}

/** The projection's own answer. `submission_state` cannot tell an unposted grade from unstarted work. */
export function itemCompleted(item: WorkItem): boolean {
  if (typeof item.canvas?.completed === "boolean") return item.canvas.completed;
  if (item.canvas) return submissionCompleted(item.canvas.submission_state);
  return item.student.status === "done";
}

export function workStateNote(read: WorkStateRead | null | undefined): string | null {
  if (!read || read.reason === "missing") return null;
  if (!read.ok) return "The work list could not be read. Showing the last Canvas view.";
  if (read.fell_back) return "This work list is the previous readable snapshot.";
  if (read.state?.coverage.canvas === "partial") return "Canvas sync is partial. Student choices are still here.";
  if (read.state?.coverage.canvas === "unreadable") return "The Canvas snapshot could not be read. Student choices are still here.";
  return null;
}

export function WorkStateNote({ read }: { read: WorkStateRead | null | undefined }) {
  const note = workStateNote(read);
  if (!note) return null;
  return (
    <p className="muted" role="status">
      {note}
    </p>
  );
}

/**
 * A semester tick carries no tenant, so two tenants sharing a Canvas id cannot
 * be told apart. Drop the key rather than overlay the wrong course's work.
 */
function indexItems(items: WorkItem[]): Map<string, WorkItem> {
  const byKey = new Map<string, WorkItem>();
  const collided = new Set<string>();
  for (const item of items) {
    const key = planKey(item);
    if (!key) continue;
    if (byKey.has(key)) collided.add(key);
    else byKey.set(key, item);
  }
  for (const key of collided) byKey.delete(key);
  return byKey;
}

/**
 * Canvas facts win, but only where work state actually has one. A null due date
 * means "work state does not know", never "this row lost its deadline": blanking
 * it would drop the row out of the week entirely.
 */
export function overlayTicks(ticks: SemesterTick[], items: WorkItem[]): SemesterTick[] {
  const byKey = indexItems(items);
  return ticks.map((tick) => {
    const item = byKey.get(tick.id);
    if (!item) return tick;
    return {
      ...tick,
      title: item.title || tick.title,
      due_at: item.due_at ?? tick.due_at,
      html_url: item.canvas?.url ?? tick.html_url,
      completed: item.canvas ? itemCompleted(item) : tick.completed,
    };
  });
}

function withinWindow(due: string | null, start: string, end: string): boolean {
  if (!due) return true;
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return true;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isFinite(a) && t < a) return false;
  if (Number.isFinite(b) && t > b) return false;
  return true;
}

/**
 * The native reader windows and sorts on its own due date, so an overlaid date
 * has to be re-windowed and re-sorted here or rows render out of order.
 */
export function overlaySurface(surface: SemesterSurface, read: WorkStateRead | null | undefined): SemesterSurface {
  if (!read?.ok || !read.state) return surface;
  const items = read.state.work_items ?? [];
  return {
    ...surface,
    courses: surface.courses.map((course) => ({
      ...course,
      ticks: overlayTicks(course.ticks, items)
        .filter((tick) => withinWindow(tick.due_at, surface.window_start, surface.window_end))
        .sort((a, b) => String(a.due_at ?? "9").localeCompare(String(b.due_at ?? "9"))),
    })),
  };
}

/**
 * One moved-date row per work item. The freshness key identifies the move, so
 * the same change already on the dashboard is recognised exactly; a change of
 * some other kind on the same URL no longer hides a move.
 */
export function mergeMovedChanges(changes: FreshnessChange[], read: WorkStateRead | null | undefined): FreshnessChange[] {
  if (!read?.ok || !read.state) return changes;
  const keys = new Set(changes.map((change) => change.key).filter(Boolean));
  const dueUrls = new Set(
    changes.filter((change) => DUE_KINDS.has(change.kind)).map((change) => change.url).filter((url): url is string => Boolean(url)),
  );
  const extra: FreshnessChange[] = [];
  for (const item of read.state.work_items) {
    if (item.change?.kind !== "due_moved") continue;
    if (item.change.source_key && keys.has(item.change.source_key)) continue;
    const url = item.canvas?.url;
    if (url && dueUrls.has(url)) continue;
    extra.push({
      key: `work-state:${item.id}`,
      kind: "due_changed",
      label: "Due date moved",
      title: item.title || "Assignment",
      url,
      detected_at: item.change.seen_at,
    });
  }
  return extra.length ? [...changes, ...extra] : changes;
}

export function parityRow(item: WorkItem) {
  return {
    id: planKey(item),
    due_at: item.due_at,
    completed: itemCompleted(item),
    planned_day: item.student.planned_day,
    order: item.student.order,
    moved: item.change?.kind === "due_moved",
  };
}
