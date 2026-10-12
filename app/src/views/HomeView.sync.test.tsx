import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const inbox: { handler: (() => void) | null } = { handler: null };
const health = { current: { state: "empty_unverified", surfaces_enabled: false, as_of: null } as Record<string, unknown> };
vi.mock("../ipc", () => ({
  readSemester: vi.fn().mockResolvedValue({ range: "1m", window_start: "", window_end: "", today: "2026-10-08T16:00:00Z", courses: [] }),
  readSyncHealth: vi.fn().mockImplementation(async () => health.current),
  readFreshness: vi.fn().mockResolvedValue({ changes: [] }),
  onFreshnessUpdated: vi.fn().mockResolvedValue(() => undefined),
  onInboxUpdated: vi.fn().mockImplementation(async (h: () => void) => {
    inbox.handler = h;
    return () => undefined;
  }),
  readCourseMap: vi.fn().mockResolvedValue(null),
  readGradeTruth: vi.fn().mockResolvedValue(null),
  openExternalUrl: vi.fn(),
}));

import { transport } from "../study/api";
import { HomeView } from "./HomeView";

describe("HomeView after a background Canvas sync", () => {
  it("re-reads sync health when the sync finishes, so the not-finished banner clears", async () => {
    vi.spyOn(transport, "send").mockResolvedValue({ ok: true, ask: null });
    render(<HomeView onExamPrep={() => undefined} />);
    expect(await screen.findByText(/hasn't finished reading Canvas yet/)).toBeInTheDocument();
    health.current = { state: "fresh_complete", surfaces_enabled: true, as_of: "2026-10-08T16:05:00Z" };
    await act(async () => inbox.handler?.());
    expect(await screen.findByText(/Up to date with Canvas/)).toBeInTheDocument();
    expect(screen.queryByText(/hasn't finished reading Canvas yet/)).not.toBeInTheDocument();
  });
});
