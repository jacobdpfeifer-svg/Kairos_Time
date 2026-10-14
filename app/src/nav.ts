/*
 * Where the student is (MASTER §10 navigation). One small route object so the
 * sidebar, ⌘K, notifications and `kairos://` links all land in the same place.
 */

export type Tab = "today" | "week" | "courses" | "study" | "advisor" | "upload" | "settings";

export type Route = {
  tab: Tab;
  capture?: boolean;
  /** Open the Ask sheet over Today. */
  ask?: boolean;
  /** Today: open this item's sheet. Courses: the course page. */
  courseId?: string;
  itemId?: string;
  /** Study: an exam's track, or practice for it. */
  examId?: string;
  practice?: boolean;
  /** Settings: the group to open. */
  group?: string;
};

export type TabSpec = { id: Tab; label: string; key?: string };

/** Sidebar order. Settings sits apart at the bottom. */
export const TABS: TabSpec[] = [
  { id: "today", label: "Today", key: "1" },
  { id: "week", label: "Week", key: "2" },
  { id: "courses", label: "Courses", key: "3" },
  { id: "study", label: "Study", key: "4" },
  { id: "advisor", label: "Advisor", key: "5" },
];
export const SETTINGS_TAB: TabSpec = { id: "settings", label: "Settings", key: "," };

const TAB_KEY = "pn_tab";
const LEGACY: Record<string, Tab> = { home: "today", plan: "week", calendar: "week", sources: "settings", upload: "courses" };

export function isTab(raw: unknown, available: Tab[]): raw is Tab {
  return typeof raw === "string" && (available as string[]).includes(raw);
}

/** The last tab, with names from older builds mapped onto today's sidebar. */
export function loadTab(available: Tab[]): Tab {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TAB_KEY);
  } catch {
    return "today";
  }
  const mapped = raw && LEGACY[raw] ? LEGACY[raw] : raw;
  return isTab(mapped, available) ? mapped : "today";
}

export function saveTab(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* private mode: the tab just won't be remembered */
  }
}

/** `kairos://week`, `kairos://course/123`, `kairos://item/123/456`, `kairos://study/exam/9`, `kairos://ask`. */
export function routeFromUrl(url: string): Route | null {
  const m = /^kairos:\/\/([^?#]*)/i.exec(url.trim());
  if (!m) return null;
  let parts: string[];
  try {
    parts = m[1].split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // malformed %-escape from an outside link
  }
  const [head, a, b] = parts;
  switch (head) {
    case undefined:
    case "today":
      return { tab: "today" };
    case "week":
      return { tab: "week" };
    case "courses":
      return { tab: "courses" };
    case "course":
      return a ? { tab: "courses", courseId: a } : { tab: "courses" };
    case "item":
      return a && b ? { tab: "today", courseId: a, itemId: b } : { tab: "today" };
    case "study":
      return a === "exam" && b ? { tab: "study", examId: b } : { tab: "study" };
    case "advisor":
      return { tab: "advisor" };
    case "capture":
      return { tab: "today", capture: true };
    case "ask":
      return { tab: "today", ask: true };
    case "settings":
      return a ? { tab: "settings", group: a } : { tab: "settings" };
    default:
      return null;
  }
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl+";
