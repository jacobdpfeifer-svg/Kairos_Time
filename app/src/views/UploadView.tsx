import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { library, type Library, type LibraryEntry, type LibraryIngest } from "../study/api";
import { ConfirmSheet } from "../components/ConfirmSheet";

/*
 * Add files: anything the student hands Kairos goes to {user_root}/inbox/library
 * (study/library.py). Each file is stored, its text read where possible, and
 * sorted to a course and a kind. Ask pulls matching passages from it; the
 * student can correct the sort or remove a file at any time.
 */

const CATEGORY_LABELS: Record<string, string> = {
  syllabus: "Syllabus",
  notes: "Notes",
  slides: "Slides",
  assignment: "Assignment",
  study_guide: "Study guide",
  reading: "Reading",
  screenshot: "Screenshot",
  image: "Image",
  other: "Other",
};

function readLine(entry: LibraryEntry): string {
  if (entry.text_status === "full") return "Kairos can read all of it.";
  if (entry.text_status === "partial") return "Kairos read some of the text.";
  if (entry.kind === "image") return "Saved. Kairos can't read text in images yet.";
  if (entry.kind === "pdf") return "Saved. This PDF looks scanned, so Kairos couldn't read its text.";
  return "Saved. Kairos couldn't read text from this file type.";
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resultLine(result: LibraryIngest): string {
  const parts: string[] = [];
  if (result.added.length) parts.push(`Added ${result.added.length} file${result.added.length === 1 ? "" : "s"}`);
  if (result.duplicates.length) parts.push(`${result.duplicates.length} already in your library`);
  return parts.length ? `${parts.join(", ")}.` : "";
}

/** Every file in the library, from Courses → "All your files" and ⌘K. */
export function UploadView({ refreshKey = 0 }: { refreshKey?: number } = {}) {
  return (
    <section className="upload-page scene-paper" aria-labelledby="upload-heading">
      <h1 id="upload-heading">Your files</h1>
      <p className="upload-intro">
        Notes, a syllabus, slides, screenshots, anything. Kairos files each one under a course and uses it when you ask a question.
      </p>
      <FilesPanel refreshKey={refreshKey} />
    </section>
  );
}

/**
 * The library, or one course's slice of it. Files added here land in that
 * course; the student can still correct the course or kind, or remove a file.
 */
export function FilesPanel({ courseId, courseLabel, refreshKey = 0 }: { courseId?: string; courseLabel?: string; refreshKey?: number }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<number>(0);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<LibraryIngest["errors"]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLib((await library.list()).library);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const addFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(files.length);
    setNote("");
    setErrors([]);
    try {
      const result = await library.add(files);
      let latest = result.library;
      // Files dropped on a course page belong to that course unless the student says otherwise.
      if (courseId) {
        for (const added of result.added) {
          if (added.course_id === courseId) continue;
          try {
            const { entry: next } = await library.update(added.id, { course_id: courseId });
            latest = { ...latest, entries: latest.entries.map((e) => (e.id === next.id ? next : e)) };
          } catch {
            /* the file is saved either way; its course can be fixed in the row */
          }
        }
      }
      setLib(latest);
      setNote(resultLine(result));
      setErrors(result.errors);
    } catch (e) {
      setErrors([{ name: "Upload", message: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(0);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    void addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const change = async (entry: LibraryEntry, patch: { course_id?: string | null; category?: string }) => {
    try {
      const { entry: next } = await library.update(entry.id, patch);
      setLib((prev) => (prev ? { ...prev, entries: prev.entries.map((e) => (e.id === next.id ? next : e)) } : prev));
    } catch (e) {
      setErrors([{ name: entry.name, message: e instanceof Error ? e.message : String(e) }]);
    }
  };

  const remove = async (entry: LibraryEntry) => {
    try {
      await library.remove(entry.id);
      setLib((prev) => (prev ? { ...prev, entries: prev.entries.filter((e) => e.id !== entry.id) } : prev));
    } catch (e) {
      setErrors([{ name: entry.name, message: e instanceof Error ? e.message : String(e) }]);
    }
  };

  const entries = (lib?.entries ?? []).filter((e) => !courseId || e.course_id === courseId);

  return (
    <div className="files-panel">
      <label
        className={`upload-dropzone${over ? " over" : ""}`}
        aria-busy={busy > 0}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input ref={input} type="file" multiple disabled={busy > 0} onChange={(e) => void addFiles(Array.from(e.target.files ?? []))} />
        <span className="upload-icon" aria-hidden="true">↑</span>
        <strong>{busy ? `Adding ${busy} file${busy === 1 ? "" : "s"}…` : courseLabel ? `Add files to ${courseLabel}` : "Choose files"}</strong>
        <span>{busy ? "Reading and sorting them now." : "or drop them anywhere in Kairos"}</span>
      </label>

      <div aria-live="polite">
        {note && <p className="upload-note">{note}</p>}
        {errors.map((err) => (
          <p key={`${err.name}-${err.message}`} className="error" role="alert">
            {err.name}: {err.message}
          </p>
        ))}
      </div>

      {loadError && (
        <p className="error" role="alert">
          Couldn't open your library: {loadError}
        </p>
      )}

      {entries.length > 0 && (
        <>
          {!courseLabel && <h2 className="upload-library-title">Your library</h2>}
          <ul className="ledger library-list">
            {entries.map((entry) => (
              <li key={entry.id} className="library-row">
                <div className="library-main">
                  <strong>{entry.name}</strong>
                  <span className="muted">
                    {sizeLabel(entry.bytes)}. {readLine(entry)}
                  </span>
                </div>
                <label>
                  <span className="visually-hidden">Course for {entry.name}</span>
                  <select value={entry.course_id ?? ""} onChange={(e) => void change(entry, { course_id: e.target.value || null })}>
                    <option value="">No course</option>
                    {(lib?.courses ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="visually-hidden">Kind of file for {entry.name}</span>
                  <select value={entry.category} onChange={(e) => void change(entry, { category: e.target.value })}>
                    {(lib?.categories ?? Object.keys(CATEGORY_LABELS)).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c] ?? c}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="ghost" onClick={() => setRemoving(entry)} aria-label={`Remove ${entry.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {lib && entries.length === 0 && !busy && <p className="muted upload-empty">Nothing added yet.</p>}
      {removing && (
        <ConfirmSheet
          title={`Remove ${removing.name}?`}
          yes="Remove it"
          no="Keep it"
          onNo={() => setRemoving(null)}
          onYes={() => {
            const entry = removing;
            setRemoving(null);
            void remove(entry);
          }}
        >
          <p className="muted">Kairos deletes its copy and stops using it for answers. The original on your computer stays where it is.</p>
        </ConfirmSheet>
      )}
    </div>
  );
}
