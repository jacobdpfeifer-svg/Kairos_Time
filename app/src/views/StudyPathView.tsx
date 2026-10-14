import { useEffect, useMemo, useState, type ReactNode } from "react";
import { onInboxUpdated, readCourseMap, readSemester, type SemesterSurface, type SemesterTick } from "../ipc";
import { study } from "../study/api";
import type { Status } from "../study/types";
import { ReviewsStep } from "../components/ReviewSession";
import { kindLabel } from "../semesterTicks";
import { friendlyRelative, friendlyWhen } from "../format";
import { ExamPrepView } from "./ExamPrepView";
import { StudyView } from "./StudyView";

/*
 * Study (MASTER §10): a path, not a grid. Each upcoming exam or quiz is a
 * track; open practice sits after them. An exam's day-by-day plan and its
 * practice open inside this tab, so the sidebar never disappears.
 */

const isAssessment = (t: SemesterTick) => t.kind === "exam" || t.kind === "quiz";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "MATH 1300" vs "MATH 1300: Calculus 1" vs "math-1300": the same course. */
export function sameCourse(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
}

type Scope = { topics: string[]; sources: { title: string; exam_relevant: boolean; scope_topics: string[] }[]; note: string };

/**
 * What an exam covers, best source first: the study core's exam record
 * (`objective_scope`), else the course's most recent unlocked modules, said
 * plainly as a guess. Never invented.
 */
export function examScope(exam: SemesterTick, status: Status | null, learn: { title: string; locked?: boolean }[]): Scope {
  const record = status?.exams.find(
    (e) => sameCourse(e.course, exam.course_label) && (norm(e.label) === norm(exam.title) || e.id === exam.id)
  );
  const declared = (record?.objective_scope ?? []).filter(Boolean);
  if (declared.length) return { topics: declared, sources: [], note: "Topics come from the exam's description in Canvas." };
  const recent = learn.filter((l) => !l.locked).slice(-6).map((l) => l.title);
  if (recent.length) {
    return {
      topics: [],
      sources: recent.map((t) => ({ title: t, exam_relevant: true, scope_topics: [t] })),
      note: "Topics are a guess from the course's most recent modules. Check the exam page in Canvas for what's actually on it.",
    };
  }
  return { topics: [], sources: [], note: "" };
}

export function StudyPathView({
  examId,
  practice,
  surface: surfaceProp,
  onOpenExam,
  onPractice,
  onBack,
  onGoToSources,
  onOpenCourse,
  reviews,
}: {
  examId?: string;
  practice?: boolean;
  surface?: SemesterSurface;
  onOpenExam: (examId: string) => void;
  onPractice: (examId?: string) => void;
  onBack: () => void;
  onGoToSources: (examId?: string) => void;
  /** Empty practice and missing scope point at the course page, where its files and exam dates live. */
  onOpenCourse?: (courseId: string) => void;
  /** The reviews-due step of the path, when there is one. */
  reviews?: ReactNode;
}) {
  const [loaded, setLoaded] = useState<SemesterSurface | null>(surfaceProp ?? null);
  const [synced, setSynced] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [learn, setLearn] = useState<{ title: string; locked?: boolean }[]>([]);

  useEffect(() => {
    if (surfaceProp) return;
    const unlisten = onInboxUpdated(() => setSynced((n) => n + 1));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [surfaceProp]);

  useEffect(() => {
    if (surfaceProp) {
      setLoaded(surfaceProp);
      return;
    }
    let alive = true;
    readSemester("full", new Date().toISOString())
      .then((s) => alive && setLoaded(s))
      .catch(() => alive && setLoaded({ courses: [], range: "full", window_start: "", window_end: "", today: new Date().toISOString() }));
    return () => {
      alive = false;
    };
  }, [surfaceProp, synced]);

  const today = useMemo(() => new Date(Date.parse(loaded?.today || "") || Date.now()), [loaded?.today]);
  const tracks = useMemo(
    () =>
      (loaded?.courses ?? [])
        .flatMap((c) => c.ticks)
        .filter((t) => isAssessment(t) && !t.completed && t.due_at && Date.parse(t.due_at) >= today.getTime() - 86_400_000)
        .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))),
    [loaded, today]
  );
  const exam = examId ? (loaded?.courses ?? []).flatMap((c) => c.ticks).find((t) => t.id === examId) ?? null : null;

  useEffect(() => {
    if (!exam) return;
    let alive = true;
    study
      .status()
      .then((st) => alive && setStatus(st))
      .catch(() => alive && setStatus(null));
    readCourseMap(exam.course_id)
      .then((m) => alive && setLearn(m.learn ?? []))
      .catch(() => alive && setLearn([]));
    return () => {
      alive = false;
    };
  }, [exam?.id, exam?.course_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (examId && practice) {
    return (
      <section className="practice-page scene-paper" aria-label={exam ? `Practice for ${exam.title}` : "Practice"}>
        <header className="exam-index">
          <button type="button" className="ghost" onClick={() => onOpenExam(examId)}>
            Back to exam prep
          </button>
        </header>
        <StudyView
          preselect={exam ? { course: exam.course_label, examId: exam.id } : null}
          onGoToSources={() => (exam && onOpenCourse ? onOpenCourse(exam.course_id) : onGoToSources(examId))}
        />
      </section>
    );
  }

  if (practice) {
    return (
      <section className="practice-page scene-paper" aria-label="Practice">
        <header className="exam-index">
          <button type="button" className="ghost" onClick={onBack}>
            Back to study
          </button>
        </header>
        <StudyView onGoToSources={() => onGoToSources()} />
      </section>
    );
  }

  if (examId) {
    if (!loaded) return <p className="muted">Loading the exam…</p>;
    if (!exam) {
      return (
        <section className="study-path scene-paper">
          <p>That exam isn't in your Canvas copy anymore.</p>
          <button type="button" onClick={onBack}>
            Back to study
          </button>
        </section>
      );
    }
    const scope = examScope(exam, status, learn);
    const hasPractice = Boolean(status?.packets.some((p) => sameCourse(p.course, exam.course_label) && p.items > 0));
    return (
      <ExamPrepView
        tick={exam}
        sources={[...(exam.description ? [{ title: exam.title, text: exam.description }] : []), ...scope.sources]}
        scope={scope.topics}
        scopeNote={scope.note}
        hasPractice={hasPractice}
        onBack={onBack}
        onTest={() => onPractice(exam.id)}
        onAddMaterial={onOpenCourse ? () => onOpenCourse(exam.course_id) : undefined}
      />
    );
  }

  return (
    <section className="study-path scene-paper" aria-labelledby="study-heading">
      <h1 id="study-heading">Study</h1>
      <p className="muted study-lede">Reviews first, then each exam on its way, then practice on anything.</p>

      {reviews ?? <ReviewsStep />}

      <section aria-labelledby="tracks-heading">
        <h2 id="tracks-heading" className="today-section-title">
          Exams and quizzes coming up
        </h2>
        {!loaded && <p className="muted">Loading…</p>}
        {loaded && tracks.length === 0 && <p className="muted">No exams or quizzes in your Canvas copy yet.</p>}
        {tracks.length > 0 && (
          <ul className="rows">
            {tracks.map((t, i) => (
              <li key={t.id} style={{ ["--course" as string]: t.color }} className={i === 0 ? "path-current" : undefined}>
                <button type="button" className="row" onClick={() => onOpenExam(t.id)}>
                  <span className="row-main">
                    <strong>{t.title}</strong>
                    <span className="row-meta">
                      <span className="course-dot" aria-hidden="true" /> {t.course_label}, {kindLabel(t.kind).toLowerCase()},{" "}
                      {friendlyWhen(t.due_at as string)}
                    </span>
                  </span>
                  <span className="row-when">{friendlyRelative(t.due_at as string, today)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="study-practice" aria-labelledby="practice-heading">
        <h2 id="practice-heading" className="today-section-title">
          Practice on anything
        </h2>
        <p className="muted">Questions from your course material, five or ten minutes at a time.</p>
        <button type="button" onClick={() => onPractice()}>
          Start practice
        </button>
      </section>
    </section>
  );
}
