import { openExternalUrl, type CourseMap, type GradeTruth, type SemesterTick } from "../ipc";
import { kindLabel } from "../semesterTicks";
import { friendlyDue } from "../format";
import { Crossfade, MotionDialog } from "./MotionDialog";
import { CourseMapLedger } from "./CourseMapLedger";

/** One Canvas item as a sheet: what it is, what skipping costs, where to go next. */
export function ItemSheet({
  tick,
  today,
  map,
  grades,
  consequence,
  onClose,
  onPlan,
}: {
  tick: SemesterTick;
  today: Date;
  map: CourseMap | null;
  grades: GradeTruth | null;
  consequence?: string | null;
  onClose: () => void;
  onPlan: () => void;
}) {
  const examish = tick.kind === "exam" || tick.kind === "quiz";
  return (
    <MotionDialog onClose={onClose} className="item-popup sheet" labelledBy="item-pop-title" style={{ ["--course" as string]: tick.color }}>
      {(close) => (
        <>
        <span className="kind-badge">{kindLabel(tick.kind)}</span>
        <h2 id="item-pop-title" className="editorial">
          {tick.title}
        </h2>
        <p className="item-when">
          {tick.course_label}. {tick.due_at ? `Due ${friendlyDue(tick.due_at, today)}.` : "No due date."}
        </p>
        {consequence && (
          <p className="consequence">
            <Crossfade text={consequence} />
          </p>
        )}
        {tick.description && <p className="cover">{tick.description.slice(0, 600)}</p>}
        <div className="sheet-actions">
          {examish && (
            <button type="button" className="primary" onClick={onPlan}>
              Study for it
            </button>
          )}
          {tick.html_url && (
            <button
              type="button"
              className={examish ? undefined : "primary"}
              onClick={() => void openExternalUrl(tick.html_url as string)}
            >
              Open in Canvas
            </button>
          )}
          <button type="button" className="ghost" onClick={close}>
            Close
          </button>
        </div>
        {map && <CourseMapLedger map={map} grades={grades} />}
        </>
      )}
    </MotionDialog>
  );
}
