// Purpose: parses a quick capture line
export type CaptureCourse = { id: string; label: string; name?: string };

export type ParsedLine = {
  title: string;
  course: string | null;
  dueAt: string | null;
  day: string | null;
  preview: string | null;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Longer names first so "thursday" wins over "thu". "sat" and "sun" are also
// ordinary English words, so they only count when they read as a date.
const DATE_WORDS = /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/gi;
const DATE_PREP = /^(?:on|by|due|before|after|next|this)$/i;

function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localEndOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function nextWeekday(now: Date, word: string): Date {
  const target = WEEKDAYS.findIndex((d) => d === word || d.startsWith(word));
  const out = new Date(now);
  const delta = (target - now.getDay() + 7) % 7 || 7;
  out.setDate(out.getDate() + delta);
  return out;
}

/** "sat" / "sun" only when they are the date, not the verb or the noun. */
function readsAsDate(input: string, index: number, length: number): boolean {
  const before = input.slice(0, index).trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  if (DATE_PREP.test(before)) return true;
  if (input.slice(index + length).trim()) return false;
  return !["the", "a", "an", "i"].includes(before);
}

function parseDate(input: string, now: Date): { date: Date; token: string } | null {
  // A fresh regex each call: returning on the first hit would otherwise leave
  // lastIndex set on the shared global expression.
  const words = new RegExp(DATE_WORDS.source, "gi");
  for (const match of input.matchAll(words)) {
    const token = match[0];
    const lower = token.toLowerCase();
    const index = match.index ?? 0;
    if ((lower === "sat" || lower === "sun") && !readsAsDate(input, index, token.length)) continue;
    const date = new Date(now);
    if (lower === "tomorrow") date.setDate(date.getDate() + 1);
    else if (lower !== "today") {
      const next = nextWeekday(now, lower);
      date.setTime(next.getTime());
    }
    return { date, token };
  }
  return null;
}

function previewDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function phrasePattern(phrase: string): RegExp {
  return new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?=$|\\s)`, "i");
}

/** Longest course label or course name that actually appears in the line. */
function findCourse(rest: string, courses: CaptureCourse[]): { course: CaptureCourse; phrase: string } | null {
  const hits: { course: CaptureCourse; phrase: string }[] = [];
  for (const course of courses) {
    for (const phrase of [course.label, course.name]) {
      const text = phrase?.trim();
      if (!text || text.length < 2) continue;
      if (phrasePattern(text).test(rest)) hits.push({ course, phrase: text });
    }
  }
  hits.sort((a, b) => b.phrase.length - a.phrase.length);
  return hits[0] ?? null;
}

/** Small, dependency-free quick-add parser shared by the desktop command bar. */
export function parseLine(input: string, courses: CaptureCourse[] = [], now = new Date()): ParsedLine {
  let rest = input.trim().replace(/^add\s+/i, "").replace(/\s+/g, " ");
  const parsedDate = parseDate(rest, now);
  if (parsedDate) {
    const token = escapeRegExp(parsedDate.token);
    rest = rest.replace(new RegExp(`(?:\\b(?:on|by|due|before|after|next|this)\\s+)?${token}\\b`, "i"), " ").replace(/\s+/g, " ").trim();
  }

  const hit = findCourse(rest, courses);
  if (hit) {
    rest = rest.replace(phrasePattern(hit.phrase), " ").replace(/\s+/g, " ").trim();
    rest = rest.replace(/\b(?:for|about|from)\s*$/i, "").trim();
  }

  const title = rest.replace(/^[-–—:]+|[-–—:]+$/g, "").trim();
  return {
    title,
    course: hit?.course.label ?? null,
    dueAt: parsedDate ? localEndOfDay(parsedDate.date) : null,
    day: parsedDate ? localDay(parsedDate.date) : null,
    preview: parsedDate ? previewDate(parsedDate.date) : null,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
