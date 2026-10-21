// Purpose: drafts a daily exam plan
export type PlanDay = {
  date: string;
  label: string;
  isToday: boolean;
  topics: string[];
  mode: "study" | "review";
};

export type ExamPlan = {
  examId: string;
  examTitle: string;
  courseLabel: string;
  days: PlanDay[];
  seed: number;
  startsAt: string | null;
  endsAt: string | null;
  cutoffAt: string | null;
  timezone: string;
  scopeConfidence: "high" | "medium" | "low" | "unknown";
  draft: true;
};

function localParts(d: Date, timezone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return [get("year"), get("month"), get("day")];
}

function dateKey(parts: [number, number, number]): string {
  return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
}

function addDate(parts: [number, number, number], n: number): [number, number, number] {
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + n));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function hashSeed(s: string, extra: number): number {
  let h = extra + 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministic draft plan. A model-backed planner can replace this later. */
export function buildExamPlan(
  exam: { id: string; title: string; due_at?: string | null; starts_at?: string | null; ends_at?: string | null; timezone?: string; course_label?: string; description?: string; objective_scope?: string[]; confidence?: "high" | "medium" | "low" | "unknown" },
  sources: { title: string; text?: string; kind?: string; exam_relevant?: boolean; scope_topics?: string[] }[],
  today: Date,
  seed = 1,
  timezone = exam.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
): ExamPlan {
  const endsAt = exam.ends_at || exam.due_at || null;
  const startsAt = exam.starts_at || null;
  const cutoffAt = startsAt || (endsAt ? new Date(new Date(endsAt).getTime() - 3600000).toISOString() : null);
  const todayParts = localParts(today, timezone);
  const examParts = startsAt ? localParts(new Date(startsAt), timezone) : endsAt ? localParts(new Date(endsAt), timezone) : addDate(todayParts, 7);
  const lastStudy = addDate(examParts, -1);
  const last = dateKey(lastStudy) < dateKey(todayParts) ? todayParts : lastStudy;
  const span = Math.max(0, Math.round((Date.UTC(last[0], last[1] - 1, last[2]) - Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2])) / 86400000));
  const scope = new Set((exam.objective_scope || []).filter(Boolean));
  const relevant = sources.filter((s) => s.exam_relevant || /exam|midterm|final|review|study guide|formula/i.test(`${s.title} ${s.text || ""}`));
  const topics = relevant.flatMap((s) => s.scope_topics || []).concat([...scope]);
  const unique = [...new Set(topics.filter(Boolean))];
  const scopedTopics = unique.length ? unique : ["What's on it isn't known yet. Check the exam page in Canvas"];
  const weighted = shuffle(scopedTopics, hashSeed(exam.id, seed));
  const days: PlanDay[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDate(todayParts, i);
    const isLast = i === span;
    const topic = weighted[i % weighted.length];
    const later = weighted[weighted.length - 1 - (i % weighted.length)];
    days.push({
      date: dateKey(date),
      label: new Date(Date.UTC(date[0], date[1] - 1, date[2], 12)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: timezone }),
      isToday: i === 0,
      topics: isLast ? [topic] : [later || topic, topic].filter((t, idx, arr) => arr.indexOf(t) === idx),
      mode: isLast ? "review" : "study",
    });
  }
  return {
    examId: exam.id,
    examTitle: exam.title,
    courseLabel: exam.course_label || "",
    days,
    seed,
    startsAt,
    endsAt,
    cutoffAt,
    timezone,
    scopeConfidence: exam.confidence || (unique.length ? "medium" : "unknown"),
    draft: true,
  };
}
