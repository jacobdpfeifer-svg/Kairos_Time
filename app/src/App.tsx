/* Reviewer: the shell. It owns the sidebar (Today · Week · Courses · Study ·
   Advisor, plus Settings), which view is mounted, ⌘K, the Ask sheet and the
   voice sheet; routes come from nav.ts and deep links arrive as one event.
   Views own their own data — nothing here talks to Canvas. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FirstRun } from "./components/FirstRun";
import { SettingsView } from "./views/SettingsView";
import { ALL_FILES } from "./views/CoursesView";
import { FileDrop } from "./components/FileDrop";
import { IconCalendar, IconHome, IconPlan, IconSettings, IconSources, IconStudy, IconUpload } from "./components/Icons";
import { Wordmark } from "./components/Wordmark";
import { CommandBar, type Command } from "./components/CommandBar";
import { advanceToast, offerToast, Toast, type ToastQueue, type ToastState } from "./components/Toast";
import { AskSheet } from "./ask/AskSheet";
import { THEMES, useTheme } from "./theme";
import { VoiceSheet } from "./voice/VoiceSheet";
import { isTauri, onDeepLink, readSchoolProfile, readSemester, setDockMode, syncCanvas, takePendingLink, type SemesterTick } from "./ipc";
import { usePrefs } from "./prefs";
import { useNotifications } from "./notify/useNotifications";
import { study } from "./study/api";
import type { AskEnvelope } from "./study/types";
import { MOD, SETTINGS_TAB, TABS, loadTab, routeFromUrl, saveTab, type Route, type Tab } from "./nav";
import { friendlyRelative } from "./format";
import { kindLabel } from "./semesterTicks";
import { parseLine } from "./capture/parseLine";
import { weekPlan } from "./week/api";
import { isSurface } from "./workspace/contracts";
import { noteInvalidWorkspace, useWorkspace } from "./workspace/store";
import { WorkspaceRenderer, type WorkspaceHost } from "./workspace/WorkspaceRenderer";
import { WorkspaceStudioScreen } from "./workspace/WorkspaceStudio";
import { WorkspaceAmendment } from "./workspace/WorkspaceAmendment";
import { useWorkspaceUsage } from "./workspace/usage";

export type { Tab } from "./nav";

/** Screens that exist in this build, in sidebar order. */
const SIDEBAR: { id: Tab; label: string; key?: string }[] = TABS;
const AVAILABLE: Tab[] = [...SIDEBAR.map((t) => t.id), "settings"];

const ICONS: Record<Tab, typeof IconHome> = {
  today: IconHome,
  week: IconCalendar,
  courses: IconSources,
  study: IconStudy,
  advisor: IconPlan,
  upload: IconUpload,
  settings: IconSettings,
};

const SETTINGS_GROUPS: [string, string][] = [
  ["canvas", "Canvas sign-in and sync"],
  ["mac", "Menu bar, alerts, and shortcuts"],
  ["ai", "AI help"],
  ["connectors", "Calendar and email"],
  ["appearance", "Appearance"],
  ["profile", "Profile"],
  ["privacy", "Privacy"],
];

/**
 * Onboarding is per profile. The webview's localStorage is shared by every
 * profile, so in the desktop app the flag alone would skip first run for a
 * newly created profile that has no school or Canvas sign-in yet.
 */
export async function resolveOnboarded(): Promise<boolean> {
  const flag = localStorage.getItem("pn_onboarded") === "1";
  if (!flag || !isTauri()) return flag;
  try {
    return (await readSchoolProfile()) !== null;
  } catch {
    return flag;
  }
}

const isAssessment = (t: SemesterTick) => t.kind === "exam" || t.kind === "quiz";

export function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(() =>
    isTauri() ? null : localStorage.getItem("pn_onboarded") === "1"
  );
  const [route, setRoute] = useState<Route>(() => ({ tab: loadTab(AVAILABLE) }));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [ask, setAsk] = useState<{ initial: AskEnvelope | null; seed?: { content: string } } | null>(null);
  const [lastAsk, setLastAsk] = useState<AskEnvelope | null>(null);
  const [items, setItems] = useState<SemesterTick[]>([]);
  const [courses, setCourses] = useState<{ id: string; label: string; name: string }[]>([]);
  const [filesVersion, setFilesVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastQueue>({ current: null, waiting: null });
  const showToast = useCallback((incoming: ToastState) => {
    setToasts((state) => offerToast(state, incoming));
  }, []);
  const { setTheme } = useTheme();

  const navigated = useRef(false);
  const [openingSettled, setOpeningSettled] = useState(false);
  const navigate = useCallback((next: Route) => {
    navigated.current = true;
    // "Add files" became the files on each course page (2026-10-13).
    if (next.tab === "upload") next = { tab: "courses", courseId: ALL_FILES };
    setRoute(AVAILABLE.includes(next.tab) ? next : { tab: "today" });
  }, []);
  const go = useCallback((tab: Tab) => navigate({ tab }), [navigate]);

  const prefs = usePrefs();
  const workspace = useWorkspace();
  const home = workspace.spec.home;
  const homeRedirectPending =
    workspace.loaded && !navigated.current && !route.studio && !!home && isSurface(home) && home !== route.tab;
  useNotifications(Boolean(onboarded && prefs?.notifications), workspace.spec.quiet?.interrupt_for);
  useWorkspaceUsage(
    Boolean(onboarded) && workspace.loaded && workspace.fromDisk && openingSettled && !route.studio && !homeRedirectPending,
    isSurface(route.tab) ? route.tab : null,
  );

  useEffect(() => {
    if (!workspace.loaded || navigated.current || route.studio) return;
    const nextHome = workspace.spec.home;
    if (!nextHome || !isSurface(nextHome) || nextHome === route.tab) return;
    setRoute({ tab: nextHome });
  }, [workspace.loaded, workspace.spec, route.studio, route.tab]);

  // kairos:// links (menu bar, capture shortcut, the Chrome extension, macOS)
  // reduce to the same small route the sidebar and ⌘K use.
  const followLink = useCallback(
    (url: string) => {
      const next = routeFromUrl(url);
      if (!next) return;
      navigate(next);
      if (next.ask) {
        setCmdOpen(false);
        setAsk({ initial: null });
      } else if (next.capture) {
        setCmdOpen(true);
      }
    },
    [navigate]
  );

  useEffect(() => {
    if (!onboarded) return;
    let alive = true;
    setOpeningSettled(false);
    // A link that launched Kairos arrived before this listener existed.
    // Usage waits until this check finishes, so the restored tab is not counted as the first open.
    void takePendingLink()
      .then((url) => {
        if (alive && url) followLink(url);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setOpeningSettled(true);
      });
    const unlisten = onDeepLink((url) => {
      if (!alive) return;
      followLink(url);
      void takePendingLink().catch(() => undefined);
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, [onboarded, followLink]);

  useEffect(() => {
    saveTab(route.tab);
  }, [route.tab]);

  useEffect(() => {
    if (onboarded !== null) return;
    let alive = true;
    void resolveOnboarded().then((ok) => {
      if (!alive) return;
      if (!ok) localStorage.removeItem("pn_onboarded");
      setOnboarded(ok);
    });
    return () => {
      alive = false;
    };
  }, [onboarded]);

  useEffect(() => {
    if (onboarded === null) return;
    void setDockMode(onboarded ? "workspace" : "onboarding");
  }, [onboarded]);

  // The last answer comes back as a row on Today, never as a takeover.
  useEffect(() => {
    if (!onboarded) return;
    let alive = true;
    void (async () => {
      try {
        const promoted = await study.askPending();
        const current = promoted.ask ? promoted : await study.askCurrent();
        if (alive && current.ask) setLastAsk(current);
      } catch {
        /* Ask's bridge being down never blocks Today. */
      }
    })();
    return () => {
      alive = false;
    };
  }, [onboarded]);

  // Courses for capture, file drop, and ⌘K. Refreshed when the bar opens.
  useEffect(() => {
    if (!onboarded) return;
    let alive = true;
    readSemester("full", new Date().toISOString())
      .then((s) => {
        if (!alive) return;
        setItems(s.courses.flatMap((c) => c.ticks).filter((t) => !t.completed && t.due_at));
        setCourses(s.courses.map((c) => ({ id: c.id, label: c.label, name: c.name })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [onboarded, cmdOpen]);

  const openAsk = useCallback((initial?: AskEnvelope | null, question?: string) => {
    setCmdOpen(false);
    setAsk({ initial: initial ?? null, seed: question ? { content: question } : undefined });
  }, []);

  const syncNow = useCallback(async () => {
    showToast({ message: "Syncing with Canvas…" });
    try {
      const r = await syncCanvas();
      showToast({ message: r.ok ? "Synced with Canvas." : r.error ? `Sync didn't finish: ${r.error}` : "Sync didn't finish." });
    } catch {
      showToast({ message: "Sync didn't finish. Try again." });
    }
  }, []);

  // Global keys (MASTER §14: every action reachable from ⌘K or a listed shortcut).
  useEffect(() => {
    if (!onboarded) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      if (k === "j") {
        e.preventDefault();
        openAsk(null);
        return;
      }
      if (k === ",") {
        e.preventDefault();
        go("settings");
        return;
      }
      const tab = SIDEBAR.find((t) => t.key === e.key);
      if (tab) {
        e.preventDefault();
        go(tab.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onboarded, go, openAsk]);

  // Dev only: ?blot plays a scripted voice exchange so the ink ring can be seen before the voice model is wired.
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has("blot")) return;
    let stop: () => void = () => {};
    let cancelled = false;
    void import("./voice/demo").then(({ runVoiceDemo }) => {
      if (!cancelled) stop = runVoiceDemo();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const now = new Date();
    const out: Command[] = [
      ...SIDEBAR.map((t) => ({
        id: `go:${t.id}`,
        group: "Go to" as const,
        label: t.label,
        keys: t.key ? `${MOD}${t.key}` : undefined,
        run: () => go(t.id),
      })),
      ...SETTINGS_GROUPS.map(([id, label]) => ({
        id: `go:settings:${id}`,
        group: "Go to" as const,
        label: `Settings: ${label}`,
        keys: id === "canvas" ? `${MOD}${SETTINGS_TAB.key}` : undefined,
        run: () => navigate({ tab: "settings", group: id }),
      })),
      { id: "do:ask", group: "Do", label: "Ask Kairos", keys: `${MOD}J`, keywords: "question help explain", run: () => openAsk(null) },
      { id: "do:sync", group: "Do", label: "Sync Canvas now", keywords: "refresh update", run: () => void syncNow() },
      { id: "do:files", group: "Do", label: "Add files", keywords: "upload notes syllabus slides library", run: () => navigate({ tab: "courses", courseId: ALL_FILES }) },
      ...courses.map((c) => ({
        id: `course:${c.id}`,
        group: "Go to" as const,
        label: c.name ? `${c.label}: ${c.name}` : c.label,
        hint: "course",
        keywords: `${c.label} ${c.name} course grade`,
        run: () => navigate({ tab: "courses", courseId: c.id }),
      })),
      { id: "do:plan", group: "Do", label: "Plan this week", keywords: "schedule week defer review", run: () => go("week") },
      { id: "do:practice", group: "Do", label: "Start practice", keywords: "study quiz me review", run: () => navigate({ tab: "study", practice: true }) },
      { id: "do:workspace", group: "Do", label: "Design my workspace", keywords: "studio layout blocks appearance", run: () => navigate({ tab: "today", studio: true }) },
      ...THEMES.map((t) => ({
        id: `do:theme:${t.id}`,
        group: "Do" as const,
        label: `Use the ${t.label.toLowerCase()} theme`,
        keywords: "appearance dark mode light contrast",
        run: () => setTheme(t.id),
      })),
      ...items.map((t) => ({
        id: `item:${t.id}`,
        group: "Go to" as const,
        label: t.title,
        hint: `${t.course_label}, ${kindLabel(t.kind).toLowerCase()}, ${t.due_at ? friendlyRelative(t.due_at, now) : "no date"}`,
        keywords: t.course_label,
        course: t.course_label,
        run: () =>
          isAssessment(t)
            ? navigate({ tab: "study", examId: t.id })
            : navigate({ tab: "today", courseId: t.course_id, itemId: t.id }),
      })),
    ];
    return out;
  }, [items, courses, go, navigate, openAsk, syncNow, setTheme]);

  const addRow = useCallback(
    (query: string): Command | null => {
      const parsed = parseLine(query, courses);
      // A plain sentence remains an Ask query. Date-bearing quick-add lines
      // (or an explicit “add …”) opt into capture so the command bar keeps its
      // natural-language fallthrough.
      if (!parsed.title || (!parsed.preview && !/^add\s+/i.test(query.trim()))) return null;
      return {
        id: `add:${query}`,
        group: "Add",
        label: `Add “${parsed.title}”`,
        hint: parsed.preview && parsed.course ? `${parsed.preview} in ${parsed.course}` : parsed.preview ?? parsed.course ?? "your week",
        keywords: "capture quick add task",
        run: () => {
          void weekPlan("capture", { title: parsed.title, course: parsed.course, due_at: parsed.dueAt, day: parsed.day, source: "typed" })
            .then((saved) =>
              showToast({
                message: `Added “${parsed.title}” to your week.`,
                id: Date.now(),
                undo: saved.saved
                  ? async () => {
                      try {
                        await weekPlan("remove", { item_id: saved.saved?.id });
                      } catch {
                        showToast({ message: "Undo didn't save.", id: Date.now() });
                      }
                    }
                  : undefined,
              })
            )
            .catch(() => showToast({ message: "That capture could not be saved.", id: Date.now() }));
        },
      };
    },
    [courses]
  );

  if (onboarded === null) {
    return <div className="workspace" aria-busy="true" />;
  }

  if (!onboarded) {
    return (
      <>
        <FirstRun
          onDone={() => {
            localStorage.setItem("pn_onboarded", "1");
            setOnboarded(true);
            go("today");
          }}
        />
        <VoiceSheet />
      </>
    );
  }

  const tab = route.tab;
  const tabButton = (t: { id: Tab; label: string; key?: string }, list: { id: Tab }[]) => {
    const Icon = ICONS[t.id];
    return (
      <button
        type="button"
        role="tab"
        id={`tab-${t.id}`}
        aria-selected={tab === t.id}
        aria-controls="main"
        className={tab === t.id ? "active" : undefined}
        title={t.key ? `${t.label} (${MOD}${t.key})` : t.label}
        onClick={() => go(t.id)}
        onKeyDown={(e) => {
          const all = [...list];
          const idx = all.findIndex((x) => x.id === t.id);
          let next: Tab | null = null;
          if (e.key === "ArrowDown" || e.key === "ArrowRight") next = all[(idx + 1) % all.length].id;
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = all[(idx - 1 + all.length) % all.length].id;
          if (!next) return;
          e.preventDefault();
          go(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        <Icon />
        {t.label}
      </button>
    );
  };
  const navOrder = [...SIDEBAR, SETTINGS_TAB];

  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="workspace-nav" aria-label="Sections">
        <Wordmark className="instrument-mark" />
        <ul role="tablist" aria-orientation="vertical">
          {SIDEBAR.map((t) => (
            <li key={t.id} role="presentation">
              {tabButton(t, navOrder)}
            </li>
          ))}
          <li role="presentation" className="nav-bottom">
            {tabButton(SETTINGS_TAB, navOrder)}
          </li>
        </ul>
        <button type="button" className="nav-command" onClick={() => setCmdOpen(true)}>
          <span>Search and commands</span>
          <kbd>{MOD}K</kbd>
        </button>
      </nav>
      <main id="main" className="workspace-main" role="tabpanel" aria-labelledby={route.studio ? undefined : `tab-${tab}`} aria-label={route.studio ? "Design my workspace" : undefined} tabIndex={-1}>
        {route.studio ? (
          <WorkspaceStudioScreen accepted={workspace.spec} loaded={workspace.loaded} onClose={() => setRoute((current) => ({ ...current, studio: false }))} />
        ) : (
          <>
        {isSurface(tab) && workspace.fromDisk && <WorkspaceAmendment spec={workspace.spec} surface={tab} />}
        {isSurface(tab) && (
          <WorkspaceRenderer
            surface={tab}
            spec={workspace.spec}
            snapshot={{ ticks: items }}
            onInvalid={noteInvalidWorkspace}
            host={
              {
                lastAsk,
                openItem: route.itemId ? { courseId: route.courseId, itemId: route.itemId } : null,
                onStudyToday: (t) => navigate(t ? { tab: "study", examId: t.id } : { tab: "study" }),
                onAsk: (initial) => openAsk(initial),
                onOpenWeek: () => go("week"),
                onToast: showToast,
                onStudyTick: (t) => navigate({ tab: "study", examId: t.id }),
                examId: route.examId,
                practice: route.practice,
                onOpenExam: (examId) => navigate({ tab: "study", examId }),
                onPractice: (examId) => navigate({ tab: "study", examId, practice: true }),
                onBack: () => navigate({ tab: "study" }),
                onGoToSources: () => navigate({ tab: "courses" }),
                onOpenCourse: (courseId) => navigate({ tab: "courses", courseId }),
                courseId: route.courseId,
                filesVersion,
              } satisfies WorkspaceHost
            }
          />
        )}
        {tab === "settings" && <SettingsView key={route.group ?? "default"} initialGroup={route.group} />}
          </>
        )}
      </main>
      {cmdOpen && <CommandBar commands={commands} addRow={addRow} onClose={() => setCmdOpen(false)} onAsk={(q) => openAsk(null, q)} />}
      {ask && (
        <AskSheet
          initial={ask.initial}
          seed={ask.seed}
          onClose={() => setAsk(null)}
          onResult={(r) => {
            if (r?.response) setLastAsk(r);
          }}
          onConnectAi={() => {
            setAsk(null);
            navigate({ tab: "settings", group: "ai" });
          }}
        />
      )}
      <FileDrop
        courseId={tab === "courses" && route.courseId !== ALL_FILES ? route.courseId : undefined}
        courseLabel={tab === "courses" ? courses.find((c) => c.id === route.courseId)?.label : undefined}
        onAdded={(message) => {
          setFilesVersion((n) => n + 1);
          showToast({ message, id: Date.now() });
        }}
      />
      {toasts.current && <Toast toast={toasts.current} onDone={() => setToasts((state) => advanceToast(state))} />}
      <VoiceSheet />
    </div>
  );
}
