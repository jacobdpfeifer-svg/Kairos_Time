import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = { on: true };
const links: { handler: ((url: string) => void) | null } = { handler: null };
vi.mock("./ipc", () => ({
  isTauri: () => tauri.on,
  readSchoolProfile: vi.fn(),
  setDockMode: vi.fn().mockResolvedValue(undefined),
  onDeepLink: vi.fn().mockImplementation(async (h: (url: string) => void) => {
    links.handler = h;
    return () => undefined;
  }),
  takePendingLink: vi.fn().mockResolvedValue(null),
  DEFAULT_APP_PREFS: { keep_running: false, notifications: false, capture_shortcut: null },
  readAppPrefs: vi.fn().mockResolvedValue({ keep_running: false, notifications: false, capture_shortcut: null }),
  setAppPrefs: vi.fn(),
  syncCanvas: vi.fn().mockResolvedValue({ ok: true }),
  readSemester: vi.fn().mockResolvedValue({
    range: "full",
    window_start: "",
    window_end: "",
    today: "2026-10-08T16:00:00Z",
    courses: [
      {
        id: "1300",
        label: "MATH 1300",
        ticks: [
          { id: "item-a1", course_id: "1300", course_label: "MATH 1300", title: "Homework 4", kind: "assignment", due_at: "2026-10-10T18:00:00Z", completed: false },
          { id: "exam-1", course_id: "1300", course_label: "MATH 1300", title: "Midterm", kind: "exam", due_at: "2026-10-20T18:00:00Z", completed: false },
        ],
      },
    ],
  }),
}));
vi.mock("./study/api", () => ({
  study: { askPending: vi.fn().mockResolvedValue({ ok: true, ask: null }), askCurrent: vi.fn().mockResolvedValue({ ok: true, ask: null }) },
}));
vi.mock("./components/FirstRun", () => ({ FirstRun: () => <h1>First run</h1> }));
vi.mock("./views/TodayView", () => ({
  TodayView: ({
    onStudy,
    openItem,
  }: {
    onStudy: (tick: { id: string; title: string; course_label: string; due_at: string; description: string }) => void;
    openItem?: { itemId: string } | null;
  }) => (
    <>
      <h1>Today view</h1>
      {openItem && <p>Opened item {openItem.itemId}</p>}
      <button
        type="button"
        onClick={() => onStudy({ id: "exam-1", title: "Midterm", course_label: "MATH 1300", due_at: "2026-10-10T18:00:00Z", description: "Review" })}
      >
        Open exam
      </button>
    </>
  ),
}));
vi.mock("./views/AdvisorView", () => ({ AdvisorView: () => <h1>Advisor view</h1> }));
vi.mock("./views/CoursesView", () => ({ ALL_FILES: "files", CoursesView: () => <h1>Courses view</h1> }));
vi.mock("./views/WeekView", () => ({ WeekView: () => <h1>Week view</h1> }));
vi.mock("./views/UploadView", () => ({ UploadView: () => <h1>Add files view</h1> }));
vi.mock("./views/StudyPathView", () => ({
  StudyPathView: ({
    examId,
    practice,
    onPractice,
    onOpenExam,
    onGoToSources,
  }: {
    examId?: string;
    practice?: boolean;
    onPractice: (examId?: string) => void;
    onOpenExam: (examId: string) => void;
    onGoToSources: () => void;
  }) => (
    <>
      <h1>{practice ? `Practice for ${examId ?? "anything"}` : examId ? `Exam prep for ${examId}` : "Study path"}</h1>
      {examId && !practice && (
        <button type="button" onClick={() => onPractice(examId)}>
          Test exam
        </button>
      )}
      {practice && examId && (
        <button type="button" onClick={() => onOpenExam(examId)}>
          Back to exam prep
        </button>
      )}
      <button type="button" onClick={onGoToSources}>
        Choose material
      </button>
    </>
  ),
}));
vi.mock("./voice/VoiceSheet", () => ({ VoiceSheet: () => null }));
vi.mock("./ask/AskSheet", () => ({
  AskSheet: ({ seed, onClose }: { seed?: { content: string }; onClose: () => void }) => (
    <div role="dialog" aria-label="Ask Kairos">
      <p>Asking: {seed?.content ?? "nothing yet"}</p>
      <button type="button" onClick={onClose}>
        Close ask
      </button>
    </div>
  ),
}));
vi.mock("./views/SettingsView", () => ({
  SettingsView: ({ initialGroup }: { initialGroup?: string }) => <h1>Settings at {initialGroup ?? "appearance"}</h1>,
}));

import { App } from "./App";
import { readSchoolProfile } from "./ipc";

const SCHOOL = {
  slug: "canvas-example-edu",
  display_name: "Example",
  canvas_host: "canvas.example.edu",
  canvas_base_url: "https://canvas.example.edu",
  instructure_account_id: null,
  source: "manual" as const,
};

async function openWorkspace() {
  localStorage.setItem("pn_onboarded", "1");
  vi.mocked(readSchoolProfile).mockResolvedValue(SCHOOL);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Today view" });
  return user;
}

describe("App shell", () => {
  beforeEach(() => {
    localStorage.clear();
    tauri.on = true;
    vi.mocked(readSchoolProfile).mockReset();
  });

  it("runs first run for a profile with no school even when another profile set the shared flag", async () => {
    localStorage.setItem("pn_onboarded", "1");
    vi.mocked(readSchoolProfile).mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "First run" })).toBeInTheDocument();
    expect(localStorage.getItem("pn_onboarded")).toBeNull();
  });

  it("opens on Today, and maps an old saved Home tab onto it", async () => {
    localStorage.setItem("pn_tab", "home");
    await openWorkspace();
    expect(screen.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("keeps the sidebar while an exam's prep and practice are open, and Back returns to the exam", async () => {
    const user = await openWorkspace();
    await user.click(screen.getByRole("button", { name: "Open exam" }));
    expect(screen.getByRole("heading", { name: "Exam prep for exam-1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Study" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Test exam" }));
    expect(screen.getByRole("heading", { name: "Practice for exam-1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to exam prep" }));
    expect(screen.getByRole("heading", { name: "Exam prep for exam-1" })).toBeInTheDocument();
  });

  it("sends practice's empty-state button to Courses, where each course's files live", async () => {
    const user = await openWorkspace();
    await user.click(screen.getByRole("button", { name: "Open exam" }));
    await user.click(screen.getByRole("button", { name: "Choose material" }));
    expect(screen.getByRole("heading", { name: "Courses view" })).toBeInTheDocument();
  });

  it("maps the old Add files tab onto Courses", async () => {
    localStorage.setItem("pn_tab", "upload");
    await openWorkspace().catch(() => undefined);
    expect(await screen.findByRole("tab", { name: "Courses" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves between sections with ⌘ and a number", async () => {
    const user = await openWorkspace();
    await user.keyboard("{Meta>}4{/Meta}");
    expect(screen.getByRole("heading", { name: "Study path" })).toBeInTheDocument();
    await user.keyboard("{Meta>}1{/Meta}");
    expect(screen.getByRole("heading", { name: "Today view" })).toBeInTheDocument();
  });

  it("opens ⌘K, finds an item, and lands on its sheet", async () => {
    const user = await openWorkspace();
    await user.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByRole("combobox");
    await user.type(input, "homework 4");
    await screen.findByRole("option", { name: /Homework 4/ });
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Opened item item-a1")).toBeInTheDocument();
  });

  it("turns an unmatched ⌘K query into a question for Ask", async () => {
    const user = await openWorkspace();
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox"), "why is the sky blue");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Ask Kairos" })).toHaveTextContent("Asking: why is the sky blue");
  });

  it("opens Ask with ⌘J over the current screen", async () => {
    const user = await openWorkspace();
    await user.keyboard("{Meta>}j{/Meta}");
    expect(screen.getByRole("dialog", { name: "Ask Kairos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today view" })).toBeInTheDocument();
  });

  it("follows kairos:// links from the menu bar, the shortcut, and the extension", async () => {
    await openWorkspace();
    await act(async () => links.handler?.("kairos://course/1300"));
    expect(screen.getByRole("heading", { name: "Courses view" })).toBeInTheDocument();
    await act(async () => links.handler?.("kairos://capture"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    await act(async () => links.handler?.("https://evil.example/today"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
