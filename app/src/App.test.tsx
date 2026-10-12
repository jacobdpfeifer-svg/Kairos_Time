import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = { on: true };
vi.mock("./ipc", () => ({
  isTauri: () => tauri.on,
  readSchoolProfile: vi.fn(),
  setDockMode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./components/FirstRun", () => ({ FirstRun: () => <h1>First run</h1> }));
vi.mock("./views/HomeView", () => ({
  HomeView: ({ onExamPrep }: { onExamPrep: (tick: { id: string; title: string; course_label: string; due_at: string; description: string }) => void }) => (
    <>
      <h1>Home view</h1>
      <button
        type="button"
        onClick={() => onExamPrep({ id: "exam-1", title: "Midterm", course_label: "MATH 1300", due_at: "2026-10-10T18:00:00Z", description: "Review" })}
      >
        Open exam
      </button>
    </>
  ),
}));
vi.mock("./views/PlanView", () => ({ PlanView: () => <h1>Plan view</h1> }));
vi.mock("./views/CalendarView", () => ({ CalendarView: () => <h1>Calendar view</h1> }));
vi.mock("./views/ExamPrepView", () => ({
  ExamPrepView: ({ onTest }: { onTest: () => void }) => <button type="button" onClick={onTest}>Test exam</button>,
}));
vi.mock("./voice/VoiceSheet", () => ({ VoiceSheet: () => null }));
vi.mock("./views/StudyView", () => ({
  StudyView: ({ onGoToSources, preselect }: { onGoToSources: () => void; preselect?: { course?: string } | null }) => (
    <>
      <p>Study course: {preselect?.course ?? "none"}</p>
      <button type="button" onClick={onGoToSources}>Choose material</button>
    </>
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

describe("App onboarding gate and study recovery route", () => {
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

  it("opens the workspace when this profile has a school and the flag", async () => {
    localStorage.setItem("pn_onboarded", "1");
    vi.mocked(readSchoolProfile).mockResolvedValue(SCHOOL);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home view" })).toBeInTheDocument();
  });

  it("sends Study's empty-state button to Settings → Canvas, where material is imported", async () => {
    localStorage.setItem("pn_onboarded", "1");
    vi.mocked(readSchoolProfile).mockResolvedValue(SCHOOL);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Study" }));
    await user.click(screen.getByRole("button", { name: "Choose material" }));
    expect(screen.getByRole("heading", { name: "Settings at canvas" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings at appearance" })).toBeInTheDocument();
  });

  it("clears an exam preselection when leaving Study", async () => {
    localStorage.setItem("pn_onboarded", "1");
    vi.mocked(readSchoolProfile).mockResolvedValue(SCHOOL);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open exam" }));
    await user.click(screen.getByRole("button", { name: "Test exam" }));
    expect(screen.getByText("Study course: MATH 1300")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Home" }));
    await user.click(screen.getByRole("tab", { name: "Study" }));
    expect(screen.getByText("Study course: none")).toBeInTheDocument();
  });
});
