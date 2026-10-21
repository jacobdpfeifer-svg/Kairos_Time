// Purpose: tests the file library view
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transport, type LibraryEntry } from "../study/api";
import { UploadView } from "./UploadView";

const courses = [
  { id: "4242", label: "MATH 1300" },
  { id: "5151", label: "HIST 1010" },
];
const categories = ["syllabus", "notes", "slides", "assignment", "study_guide", "reading", "screenshot", "image", "other"];

function entry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: "abc",
    name: "notes.md",
    ext: ".md",
    kind: "text",
    bytes: 2048,
    added_at: "2026-09-20T16:00:00Z",
    course_id: "4242",
    course_label: "MATH 1300",
    course_source: "matched",
    category: "notes",
    category_source: "matched",
    text_status: "full",
    chars: 120,
    summary: "",
    ...overrides,
  };
}

function fakeLibrary(initial: LibraryEntry[] = []) {
  let entries = [...initial];
  const view = () => ({ entries, courses, categories, total_bytes: 0 });
  vi.spyOn(transport, "send").mockImplementation(async (cmd, params) => {
    if (cmd === "library-list") return { ok: true, library: view() } as never;
    if (cmd === "library-add") {
      const added = entry({ id: `id-${entries.length}`, name: String(params.name), course_id: null, course_label: null, course_source: "none", category: "other", text_status: "none", kind: "image" });
      entries = [added, ...entries];
      return { ok: true, status: "added", entry: added, library: view() } as never;
    }
    if (cmd === "library-update") {
      entries = entries.map((e) => (e.id === params.id ? { ...e, course_id: String(params.course_id), course_label: "HIST 1010", course_source: "student" } : e));
      return { ok: true, entry: entries.find((e) => e.id === params.id) } as never;
    }
    if (cmd === "library-remove") {
      entries = entries.filter((e) => e.id !== params.id);
      return { ok: true, removed: params.id } as never;
    }
    return { ok: false, error: { code: "validation", message: `unexpected ${cmd}` } } as never;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("UploadView", () => {
  it("saves chosen files to the library and says honestly what Kairos can read", async () => {
    fakeLibrary();
    const user = userEvent.setup();
    const { container } = render(<UploadView />);
    expect(await screen.findByText("Nothing added yet.")).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["png"], "Screenshot 1.png", { type: "image/png" }));
    expect(await screen.findByText("Added 1 file.")).toBeInTheDocument();
    expect(screen.getByText("Screenshot 1.png")).toBeInTheDocument();
    expect(screen.getByText(/can't read text in images yet/)).toBeInTheDocument();
    const add = vi.mocked(transport.send).mock.calls.find(([cmd]) => cmd === "library-add");
    expect(add?.[1]).toMatchObject({ name: "Screenshot 1.png", data_base64: btoa("png") });
  });

  it("lets the student correct the course and remove a file", async () => {
    fakeLibrary([entry({ id: "n1", name: "week3 notes.md" })]);
    const user = userEvent.setup();
    render(<UploadView />);
    const course = await screen.findByLabelText("Course for week3 notes.md");
    expect(course).toHaveValue("4242");
    await user.selectOptions(course, "5151");
    await waitFor(() => expect(screen.getByLabelText("Course for week3 notes.md")).toHaveValue("5151"));
    expect(vi.mocked(transport.send).mock.calls.some(([cmd, p]) => cmd === "library-update" && p.course_id === "5151")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Remove week3 notes.md" }));
    // Removing deletes Kairos's copy, so it asks first.
    expect(screen.getByRole("dialog", { name: "Remove week3 notes.md?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(screen.queryByText("week3 notes.md")).not.toBeInTheDocument());
  });

  it("shows the reason when a file is refused", async () => {
    vi.spyOn(transport, "send").mockImplementation(async (cmd) => {
      if (cmd === "library-list") return { ok: true, library: { entries: [], courses, categories, total_bytes: 0 } } as never;
      return { ok: false, error: { code: "validation", message: "empty.txt is empty" } } as never;
    });
    const user = userEvent.setup();
    const { container } = render(<UploadView />);
    await screen.findByText("Nothing added yet.");
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(["x"], "empty.txt"));
    expect(await screen.findByRole("alert")).toHaveTextContent("empty.txt: empty.txt is empty");
  });
});
