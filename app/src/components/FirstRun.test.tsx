import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FirstRun } from "./FirstRun";

vi.mock("../ipc", () => ({
  checkCanvasSession: vi.fn().mockResolvedValue(false),
  openCanvasSso: vi.fn(),
  saveOnboarding: vi.fn().mockResolvedValue(undefined),
  searchSchools: vi.fn().mockResolvedValue([
    { name: "Ohio State – CarmenCanvas", host: "osu.instructure.com", account_id: 132008 },
  ]),
  chooseSchool: vi.fn().mockImplementation(async (m: { host: string; name: string }) => ({
    slug: m.host.replace(/\./g, "-"),
    display_name: m.name,
    canvas_host: m.host,
    canvas_base_url: `https://${m.host}`,
    instructure_account_id: null,
    source: "instructure-search",
  })),
  bootstrapCanvasSync: vi.fn(),
  syncCanvas: vi.fn().mockResolvedValue({ ok: true }),
  syncStudySourcesIpc: vi.fn().mockResolvedValue({ ok: true }),
  onStudySyncProgress: vi.fn().mockResolvedValue(() => undefined),
  readSyncHealth: vi.fn().mockResolvedValue({ state: "fresh_complete", sync_id: "sync-test", as_of: "2026-10-12T00:00:00Z" }),
  readSyncProgress: vi.fn().mockResolvedValue({ phase: "done", courses: [{ id: "1", label: "TEST" }] }),
}));

vi.mock("../study/api", () => ({ runtimeInfo: vi.fn().mockResolvedValue(null) }));

import { chooseSchool, openCanvasSso, readSyncHealth, readSyncProgress, saveOnboarding, syncStudySourcesIpc } from "../ipc";
import { runtimeInfo } from "../study/api";

async function pickOhioState(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("School"), "ohio");
  await user.click(await screen.findByRole("button", { name: /Ohio State/ }));
}

describe("FirstRun", () => {
  it("finds the school by name, gates Continue on the terms, and saves the discovered school", async () => {
    const user = userEvent.setup();
    render(<FirstRun onDone={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Where do you go to school?" })).toBeInTheDocument();
    expect(screen.queryByText(/CU Boulder/)).not.toBeInTheDocument();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await pickOhioState(user);
    expect(cont).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Read the terms" }));
    const terms = screen.getByRole("dialog", { name: "Terms" });
    expect(terms).toHaveTextContent(/at Ohio State/);
    expect(terms).toHaveTextContent(/Privacy/);
    expect(terms.textContent).not.toMatch(/\*\*|\]\(|^#/m);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByLabelText("I agree to the beta terms"));
    expect(cont).toBeEnabled();
    await user.click(cont);
    expect(vi.mocked(chooseSchool)).toHaveBeenCalledWith(
      { host: "osu.instructure.com", name: "Ohio State – CarmenCanvas", account_id: 132008 },
      false
    );
    expect(vi.mocked(saveOnboarding)).toHaveBeenCalledWith("osu-instructure-com", "", {});
    expect(await screen.findByRole("heading", { name: "Your Canvas sign-in opens in Chrome" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /complete MFA in Chrome/i })).toBeInTheDocument();
    expect(screen.getByText(/never sees your password or MFA code/i)).toBeInTheDocument();
  });

  it("accepts a pasted Canvas address when the school isn't listed", async () => {
    const user = userEvent.setup();
    render(<FirstRun onDone={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "My school isn't listed" }));
    await user.type(screen.getByLabelText("Your Canvas address"), "https://canvas.example.edu/courses");
    await user.click(screen.getByLabelText("I agree to the beta terms"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(vi.mocked(chooseSchool)).toHaveBeenLastCalledWith({ host: "canvas.example.edu", name: "canvas.example.edu" }, true);
  });

  it("keeps the student on the Canvas handoff after a failed sign-in", async () => {
    vi.mocked(openCanvasSso).mockRejectedValueOnce(new Error("Login window closed or no session found."));
    const user = userEvent.setup();
    render(<FirstRun onDone={() => undefined} />);
    await pickOhioState(user);
    await user.click(screen.getByLabelText("I agree to the beta terms"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your Canvas sign-in opens in Chrome" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Chrome sign-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Login window closed|no session/i);
    expect(screen.getByRole("heading", { name: "Your Canvas sign-in opens in Chrome" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart sign-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  });

  it("lists classes as they sync", async () => {
    vi.mocked(syncStudySourcesIpc).mockImplementation(() => new Promise(() => undefined));
    render(
      <FirstRun
        startStep="sync"
        onDone={() => undefined}
        progressCourses={[{ id: "1300", label: "MATH 1300", color: "#2E86AB", assignments: 12, quizzes: 2, exam_count: 1 }]}
      />
    );
    expect(await screen.findByRole("heading", { name: "Getting your classes" })).toBeInTheDocument();
    expect(screen.getByText("MATH 1300")).toBeInTheDocument();
    expect(screen.getByText(/12 assignments/)).toBeInTheDocument();
  });

  it("keeps a failed first sync on screen with a plain reason and a working retry", async () => {
    vi.mocked(syncStudySourcesIpc)
      .mockResolvedValueOnce({ ok: false, error: "study source sync exited with exit status: 1" })
      .mockResolvedValueOnce({ ok: true });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<FirstRun startStep="sync" onDone={onDone} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't read your classes/i);
    expect(alert).not.toHaveTextContent(/exit status/);
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("finishes on a fresh partial sync but not on a stale projection", async () => {
    vi.mocked(syncStudySourcesIpc).mockResolvedValue({ ok: true });
    vi.mocked(readSyncHealth)
      .mockResolvedValueOnce({ state: "stale_complete", sync_id: "old", as_of: "2026-10-01T00:00:00Z" })
      .mockResolvedValueOnce({ state: "fresh_partial", sync_id: "new", as_of: "2026-10-12T00:00:00Z" });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<FirstRun startStep="sync" onDone={onDone} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't read your classes/i);
    expect(alert).not.toHaveTextContent(/projection|verification/i);
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("says plainly when Canvas answers with no current classes", async () => {
    vi.mocked(syncStudySourcesIpc).mockResolvedValue({ ok: true });
    vi.mocked(readSyncProgress).mockResolvedValueOnce({ phase: "done", courses: [] });
    const onDone = vi.fn();
    render(<FirstRun startStep="sync" onDone={onDone} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no current classes.*right school/i);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("tells the student to restart when the school sign-in page expired", async () => {
    vi.mocked(openCanvasSso).mockRejectedValueOnce("login_expired: the school sign-in page expired; restart sign-in from Kairos");
    const user = userEvent.setup();
    render(<FirstRun startStep="canvas" onDone={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "Open Chrome sign-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign-in page expired/);
    expect(screen.getByRole("button", { name: "Restart sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("replaces process text from a failed sign-in with what to do next", async () => {
    vi.mocked(openCanvasSso).mockRejectedValueOnce("open-canvas exited with exit status: 1");
    const user = userEvent.setup();
    render(<FirstRun startStep="canvas" onDone={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "Open Chrome sign-in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The sign-in window closed before Canvas finished. Try again.");
    expect(alert).not.toHaveTextContent(/exit status|open-canvas/);
  });

  it("moves focus into the terms dialog and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(<FirstRun onDone={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Read the terms" }));
    const dialog = screen.getByRole("dialog", { name: "Terms" });
    await vi.waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Read the terms" })).toHaveFocus());
  });

  it("says up front when the installed runtime can't reach Canvas", async () => {
    vi.mocked(runtimeInfo).mockResolvedValueOnce({
      mode: "bundled",
      core_dir: "/Applications/Kairos.app/Contents/Resources/core",
      python: "/x/python3",
      node: null,
      profile_id: "s1",
      user_root: "/x/s1",
      diagnostics: ["Node runtime not found: Canvas sync is unavailable until it is installed"],
    });
    render(<FirstRun onDone={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/incomplete, so it can't connect to Canvas/);
  });
});
