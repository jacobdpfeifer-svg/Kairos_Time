// Purpose: course list and course pages
import { useEffect, useMemo, useState } from "react";
import {
  onInboxUpdated,
  openExternalUrl,
  readCourseMap,
  readGradeTruth,
  readSemester,
  readSkipCosts,
  type CourseMap,
  type GradeTruth,
  type SemesterCourse,
  type SemesterSurface,
  type SemesterTick,
} from "../ipc";
import { kindLabel } from "../semesterTicks";
import { friendlyRelative, friendlyWhen } from "../format";
import { consequenceSentence, skipCostFor, type SkipCosts } from "../consequence";
import { CourseMapLedger } from "../components/CourseMapLedger";
import { ItemSheet } from "../components/ItemSheet";
import { FilesPanel, UploadView } from "./UploadView";

/*
 * Courses (MASTER §10): one row per course with the grade Canvas shows next to
 * the grade with missing work as zero, and what's next. A course page is one
 * column: grade truth, open work with what skipping costs, the course map,
 * exams, and the course's files.
 */

const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n * 10) / 10}%`);

function gradeLine(g: GradeTruth | undefined): string | null {
  const lead = g?.lead;
  if (!lead || lead.canvas_says == null) return null;
  const canvas = `Canvas says ${pct(lead.canvas_says)}${lead.canvas_letter ? ` (${lead.canvas_letter})` : ""}`;
  if (lead.risk != null && lead.unsubmitted_due_count && Math.abs(lead.risk - lead.canvas_says) >= 0.05) {
    return `${canvas}. With missing work as zero, ${pct(lead.risk)}.`;
  }
  return `${canvas}.`;
}

export const ALL_FILES = "files";

export function CoursesView({
  courseId,
  surface: surfaceProp,
  grades: gradesProp,
  onOpenCourse,
  onBack,
  onStudy,
  filesVersion = 0,
}: {
  courseId?: string;
  filesVersion?: number;
  surface?: SemesterSurface;
  grades?: Record<string, GradeTruth>;
  onOpenCourse: (id: string) => void;
  onBack: () => void;
  onStudy: (tick: SemesterTick) => void;
}) {
  const [surface, setSurface] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [grades, setGrades] = useState<Record<string, GradeTruth>>(gradesProp ?? {});
  const [failed, setFailed] = useState(false);
  const [synced, setSynced] = useState(0);

  useEffect(() => {
    if (surfaceProp) return;
    const unlisten = onInboxUpdated(() => setSynced((n) => n + 1));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [surfaceProp]);

  useEffect(() => {
    if (surfaceProp) return;
    let alive = true;
    readSemester("full", new Date().toISOString())
      .then(async (s) => {
        if (!alive) return;
        setSurface(s);
        setFailed(false);
        const pairs = await Promise.all(s.courses.map(async (c) => [c.id, await readGradeTruth(c.id).catch(() => ({}))] as const));
        if (alive) setGrades(Object.fromEntries(pairs));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [surfaceProp, synced]);

  if (courseId === ALL_FILES) {
    return (
      <>
        <BackLink onBack={onBack} />
        <UploadView refreshKey={filesVersion} />
      </>
    );
  }

  const course = courseId ? surface?.courses.find((c) => c.id === courseId) : undefined;
  if (courseId && course) {
    return (
      <CoursePage
        course={course}
        today={new Date(Date.parse(surface?.today || "") || Date.now())}
        grade={grades[course.id]}
        filesVersion={filesVersion}
        onBack={onBack}
        onStudy={onStudy}
      />
    );
  }

  return (
    <section className="courses scene-paper" aria-labelledby="courses-heading">
      <h1 id="courses-heading">Courses</h1>
      {failed && (
        <p role="alert">
          Couldn't read your Canvas copy.{" "}
          <button type="button" className="link" onClick={() => setSynced((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {!surface && !failed && <p className="muted">Loading your courses…</p>}
      {surface && surface.courses.length === 0 && <p>No courses yet. Once Canvas finishes syncing they show up here.</p>}
      {courseId && surface && !course && <p className="muted">That course isn't in your Canvas copy anymore.</p>}
      {surface && surface.courses.length > 0 && (
        <ul className="rows course-rows">
          {surface.courses.map((c) => {
            const next = c.ticks
              .filter((t) => !t.completed && t.due_at && Date.parse(t.due_at) >= Date.now() - 86_400_000)
              .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0];
            const line = gradeLine(grades[c.id]);
            return (
              <li key={c.id} style={{ ["--course" as string]: c.color }}>
                <button type="button" className="row" onClick={() => onOpenCourse(c.id)}>
                  <span className="row-main">
                    <span className="course-row-title">
                      <span className="course-tag">{c.label}</span>
                      <strong>{c.name || c.label}</strong>
                    </span>
                    {line && <span className="row-meta">{line}</span>}
                    {next && (
                      <span className="row-meta">
                        Next: {next.title}, {friendlyRelative(next.due_at as string)}
                      </span>
                    )}
                  </span>
                  <span className="row-when" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="link courses-files" onClick={() => onOpenCourse(ALL_FILES)}>
        All your files
      </button>
    </section>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="ghost course-back" onClick={onBack}>
      All courses
    </button>
  );
}

function CoursePage({
  course,
  today,
  grade,
  filesVersion,
  onBack,
  onStudy,
}: {
  filesVersion: number;
  course: SemesterCourse;
  today: Date;
  grade?: GradeTruth;
  onBack: () => void;
  onStudy: (tick: SemesterTick) => void;
}) {
  const [map, setMap] = useState<CourseMap | null>(null);
  const [costs, setCosts] = useState<SkipCosts>({});
  const [sheet, setSheet] = useState<SemesterTick | null>(null);

  useEffect(() => {
    let alive = true;
    readCourseMap(course.id)
      .then((m) => alive && setMap(m))
      .catch(() => undefined);
    readSkipCosts()
      .then((c) => alive && setCosts(c || {}))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [course.id]);

  const open = useMemo(
    () =>
      course.ticks
        .filter((t) => !t.completed && t.due_at && Date.parse(t.due_at) >= today.getTime() - 86_400_000 && t.kind !== "exam")
        .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
        .slice(0, 12),
    [course, today]
  );
  const exams = course.ticks
    .filter((t) => (t.kind === "exam" || t.kind === "quiz") && t.due_at && !t.completed && Date.parse(t.due_at) >= today.getTime() - 86_400_000)
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  const line = gradeLine(grade);

  return (
    <section className="course-page scene-paper" aria-labelledby="course-heading" style={{ ["--course" as string]: course.color }}>
      <BackLink onBack={onBack} />
      <span className="course-tag">{course.label}</span>
      <h1 id="course-heading">{course.name || course.label}</h1>
      {line && <p className="course-grade">{line}</p>}
      {grade?.lead?.why && <p className="muted course-grade-why">{grade.lead.why}</p>}
      {map?.course?.html_url && (
        <button type="button" className="link" onClick={() => void openExternalUrl(map.course?.html_url as string)}>
          Open the course in Canvas
        </button>
      )}

      <section aria-labelledby="open-heading">
        <h2 id="open-heading" className="today-section-title">
          Open work
        </h2>
        {open.length === 0 ? (
          <p className="muted">Nothing open in this course right now.</p>
        ) : (
          <ul className="rows">
            {open.map((t) => {
              const cons = consequenceSentence(skipCostFor(costs, t));
              return (
                <li key={t.id}>
                  <button type="button" className="row" onClick={() => setSheet(t)}>
                    <span className="row-main">
                      <strong>{t.title}</strong>
                      <span className="row-meta">
                        {kindLabel(t.kind)}, {friendlyWhen(t.due_at as string)}
                      </span>
                      {cons && <span className="row-meta">{cons}</span>}
                    </span>
                    <span className="row-when">{friendlyRelative(t.due_at as string, today)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {exams.length > 0 && (
        <section aria-labelledby="exams-heading">
          <h2 id="exams-heading" className="today-section-title">
            Exams and quizzes
          </h2>
          <ul className="rows">
            {exams.map((t) => (
              <li key={t.id}>
                <button type="button" className="row" onClick={() => onStudy(t)}>
                  <span className="row-main">
                    <strong>{t.title}</strong>
                    <span className="row-meta">
                      {friendlyWhen(t.due_at as string)}, {Math.round((t.weight_share || 0) * 1000) / 10}% of the course
                    </span>
                  </span>
                  <span className="row-when">Study for it</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {map && (
        <section aria-labelledby="map-heading">
          <h2 id="map-heading" className="today-section-title">
            How the course is laid out
          </h2>
          <CourseMapLedger map={map} grades={null} limit={8} />
        </section>
      )}

      <section aria-labelledby="files-heading" className="course-files">
        <h2 id="files-heading" className="today-section-title">
          Your files for this course
        </h2>
        <FilesPanel courseId={course.id} courseLabel={course.label} refreshKey={filesVersion} />
      </section>

      {sheet && (
        <ItemSheet
          tick={sheet}
          today={today}
          map={null}
          grades={null}
          consequence={consequenceSentence(skipCostFor(costs, sheet), sheet.course_label)}
          onClose={() => setSheet(null)}
          onPlan={() => {
            onStudy(sheet);
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}
