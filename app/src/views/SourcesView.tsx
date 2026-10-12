import { useCallback, useEffect, useState } from "react";
import { StudyRequestError, canvasStudy, study, syncStudySources, type CanvasSources } from "../study/api";
import { isTauri } from "../ipc";
import { STABILITY_LABEL, fmtWhen } from "../study/format";
import type { ExamView, PacketSummary, Template } from "../study/types";

/**
 * Practice material: Canvas sources to import, imported packets with question
 * authoring, exam dates, and bundled packets. `embedded` renders it inside
 * Settings → Canvas (the destination of Study's "Choose material");
 * `inspectOnly` lists synced material without import controls.
 */
export function SourcesView({ inspectOnly = false, embedded = false }: { inspectOnly?: boolean; embedded?: boolean }) {
  const [packets, setPackets] = useState<PacketSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [exams, setExams] = useState<ExamView[]>([]);
  const [canvas, setCanvas] = useState<CanvasSources | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t, s, c] = await Promise.all([study.packets(), study.templates(), study.status(), canvasStudy.sources()]);
      setPackets(p.packets);
      setTemplates(t.templates);
      setExams(s.exams);
      setCanvas(c);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importTemplate = async (id: string) => {
    setMessage("");
    try {
      const res = await study.importTemplate(id);
      setMessage(`Imported ${res.packet_id} (${res.items} items).`);
      await refresh();
    } catch (e) {
      setError(e instanceof StudyRequestError ? `${e.message}` : String(e));
    }
  };

  const importPasted = async () => {
    setMessage("");
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted);
    } catch {
      setError("That is not valid JSON. Paste one packet object.");
      return;
    }
    try {
      const res = await study.importPacket(parsed);
      setMessage(`Imported ${res.packet_id} (${res.items} items).`);
      setPasted("");
      await refresh();
    } catch (e) {
      setError(e instanceof StudyRequestError ? e.message : String(e));
    }
  };

  const withdraw = async (id: string) => {
    if (!window.confirm(`Withdraw packet ${id}? Your answers are kept; its items stop being offered.`)) return;
    try {
      await study.withdraw(id, "student withdrew");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const imported = new Set(packets.map((p) => p.packet_id));

  const runSync = async () => {
    setSyncing(true);
    setMessage("");
    const res = await syncStudySources();
    setSyncing(false);
    if (!res.ok) setError(res.error || "Sync failed");
    await refresh();
  };

  return (
    <section className="sources" aria-labelledby="sources-heading">
      {inspectOnly || embedded ? (
        <h2 id="sources-heading">{embedded ? "Practice material" : "Canvas data"}</h2>
      ) : (
        <h1 id="sources-heading">Sources</h1>
      )}
      {inspectOnly ? null : (
      <p className="muted">
        Practice is built only from material you import here. Synthetic packets are labeled; they are not your instructor's material.
      </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {loading && (
        <div className="empty-state" aria-hidden="true">
          <span className="mark" />
          <p className="muted">Loading sources</p>
        </div>
      )}

      <h2>Canvas material</h2>
      {canvas && (
        <p className={`sync-line sync-${canvas.status.state}`} role="status">
          {canvas.status.line}
          {canvas.status.last_sync ? ` Last sync ${fmtWhen(canvas.status.last_sync)}.` : ""}
        </p>
      )}
      <div className="row">
        <button type="button" disabled={!isTauri() || syncing} onClick={() => void runSync()}>
          {syncing ? "Syncing…" : "Sync Canvas sources"}
        </button>
        {!isTauri() && <span className="muted">Sync runs in the desktop app with your Canvas sign-in.</span>}
      </div>
      {canvas && canvas.courses.length === 0 && canvas.status.state !== "never" && <p className="empty">No course material was found in the last sync.</p>}
      <ul className="packet-list">
        {canvas?.courses.map((course) => (
          <CanvasCourseRow key={course.course_id} course={course} inspectOnly={inspectOnly} onImported={refresh} onError={setError} onMessage={setMessage} />
        ))}
      </ul>

      {!inspectOnly && (
        <>
      <h2>Imported packets</h2>
      {packets.length === 0 && !loading && <p className="empty">Nothing imported yet.</p>}
      <ul className="packet-list">
        {packets.map((p) => (
          <li key={p.packet_id} className="packet">
            <div className="packet-head">
              <strong>{p.title}</strong>
              <span className="muted">
                {p.course} · v{p.version} · {p.provenance}
              </span>
              <button type="button" className="ghost" onClick={() => void withdraw(p.packet_id)}>
                Withdraw
              </button>
            </div>
            <ul className="packet-sources">
              {p.sources.map((s) => (
                <li key={s.id}>
                  {s.locator} · {s.chars} chars{s.stale ? " · edited since import — items paused" : ""}
                </li>
              ))}
            </ul>
            <ul className="packet-items">
              {p.items.map((it) => (
                <li key={it.id}>
                  <span>{it.objective_label}</span>
                  {it.state && (
                    <span className="muted">
                      {" "}
                      · {STABILITY_LABEL[it.state.stability]}
                      {it.state.effective_due ? ` · next ${fmtWhen(it.state.effective_due)}` : it.state.encountered ? "" : " · not started"}
                    </span>
                  )}
                </li>
              ))}
              {p.items.length === 0 && <li className="muted">No practice item yet — add a question below.</li>}
            </ul>
            <AuthorItem packet={p} onCreated={refresh} onError={setError} onMessage={setMessage} />
          </li>
        ))}
      </ul>

      <h2>Exams</h2>
      {exams.length === 0 && <p className="empty">No exam dates yet. Add one below so practice can be capped before it.</p>}
      <ul className="exam-list">
        {exams.map((exam) => (
          <ExamRow key={exam.id} exam={exam} onSaved={refresh} />
        ))}
      </ul>

      <h2>Bundled practice packets</h2>
      <ul className="template-list">
        {templates.map((t) => (
          <li key={t.packet_id}>
            <span>
              {t.title} <span className="muted">· {t.course} · {t.items} items · {t.provenance}</span>
            </span>
            <button type="button" disabled={imported.has(t.packet_id)} onClick={() => void importTemplate(t.packet_id)}>
              {imported.has(t.packet_id) ? "Imported" : "Import"}
            </button>
          </li>
        ))}
      </ul>

      <h2>Paste a packet</h2>
      <label htmlFor="packet-paste" className="muted">
        One JSON packet: sources with verbatim text, items with a key and support references. Instructor material must be permitted for practice.
      </label>
      <textarea id="packet-paste" rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} />
      <div className="row">
        <button type="button" className="primary" disabled={!pasted.trim()} onClick={() => void importPasted()}>
          Import pasted packet
        </button>
      </div>
        </>
      )}
    </section>
  );
}

function ExamRow({ exam, onSaved }: { exam: ExamView; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(exam.date || "");
  const [time, setTime] = useState(exam.at ? exam.at.slice(11, 16) : "");
  const [saving, setSaving] = useState(false);
  const save = async (value: "date_only" | "known_instant" | "cancelled") => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { id: exam.id, value, zone: exam.zone || Intl.DateTimeFormat().resolvedOptions().timeZone };
      if (value === "date_only") payload.date = date;
      if (value === "known_instant") payload.at = `${date}T${time || "09:00"}:00`;
      await study.setExam(payload);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="exam">
      <div>
        <strong>{exam.label || exam.id}</strong> <span className="muted">· {exam.course}</span>
        <p className="muted">
          {exam.value === "unknown" && "Date unknown — cram mode needs one."}
          {exam.value === "cancelled" && "Cancelled — no cap."}
          {exam.value === "date_only" && `${exam.date} · practice slots end ${fmtWhen(exam.cutoff_at)}`}
          {exam.value === "known_instant" && `${fmtWhen(exam.at)} · practice slots end ${fmtWhen(exam.cutoff_at)}`}
          {exam.value === "window" && `${fmtWhen(exam.starts_at)}–${fmtWhen(exam.ends_at)} · practice slots end ${fmtWhen(exam.cutoff_at)} · ${exam.confidence} confidence`}
          {exam.is_past ? " · past" : ""}
        </p>
      </div>
      <div className="row">
        <label>
          <span className="visually-hidden">Exam date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span className="visually-hidden">Exam time (optional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button type="button" disabled={saving || !date} onClick={() => void save(time ? "known_instant" : "date_only")}>
          Save
        </button>
        <button type="button" className="ghost" disabled={saving} onClick={() => void save("cancelled")}>
          Cancelled
        </button>
      </div>
    </li>
  );
}


function CanvasCourseRow({
  course,
  inspectOnly = false,
  onImported,
  onError,
  onMessage,
}: {
  course: CanvasSources["courses"][number];
  inspectOnly?: boolean;
  onImported: () => Promise<void>;
  onError: (e: string) => void;
  onMessage: (m: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(course.imported_source_ids.length ? course.imported_source_ids : course.sources.filter((s) => s.kind !== "assignment").map((s) => s.id))
  );
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const doImport = async () => {
    setBusy(true);
    onError("");
    try {
      const res = await canvasStudy.importCourse(course.course_id, [...selected]);
      onMessage(`Imported ${res.sources} source${res.sources === 1 ? "" : "s"} for ${course.label} (version ${res.version}${res.kept_items ? `, kept ${res.kept_items} of your questions` : ""}).`);
      await onImported();
    } catch (e) {
      onError(e instanceof StudyRequestError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="packet">
      <div className="packet-head">
        <strong>{course.label}</strong>
        <span className="muted">
          fetched {fmtWhen(course.fetched_at)}
          {course.imported_version ? ` · imported v${course.imported_version}` : " · not imported"}
          {course.errors.length ? ` · ${course.errors.length} fetch error(s)` : ""}
        </span>
      </div>
      {!inspectOnly && (
      <fieldset className="source-pick">
        <legend className="visually-hidden">Sources to import for {course.label}</legend>
        {course.sources.map((s) => (
          <label key={s.id}>
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
            {s.title} <span className="muted">· {s.kind} · {s.chars} chars{s.truncated ? " (clipped)" : ""}</span>
          </label>
        ))}
        {course.sources.length === 0 && <span className="muted">No text material published.</span>}
      </fieldset>
      )}
      {inspectOnly && (
        <ul className="packet-sources">
          {course.sources.map((s) => (
            <li key={s.id}>
              {s.title} · {s.kind}
            </li>
          ))}
        </ul>
      )}
      {course.exams.length > 0 && (
        <p className="muted">
          Exam dates inferred from titles: {course.exams.map((e) => `${e.label}${e.due_at ? ` (${fmtWhen(e.due_at)})` : " (no date)"}`).join(", ")}. Inferred — check them before relying on a cap.
        </p>
      )}
      {!inspectOnly && (
      <div className="row">
        <button type="button" className="primary" disabled={busy || selected.size === 0} onClick={() => void doImport()}>
          {course.imported_version ? "Re-import selected" : "Import selected"}
        </button>
      </div>
      )}
    </li>
  );
}

const CHECKERS = [
  { id: "expression", label: "Expression / short answer (exact match)" },
  { id: "numeric", label: "Number (±2%)" },
  { id: "true_false", label: "True or false" },
  { id: "choice", label: "One word/choice" },
  { id: "none", label: "Free text (self-check only)" },
] as const;

function AuthorItem({ packet, onCreated, onError, onMessage }: { packet: PacketSummary; onCreated: () => Promise<void>; onError: (e: string) => void; onMessage: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(packet.sources[0]?.id ?? "");
  const [objective, setObjective] = useState("");
  const [stem, setStem] = useState("");
  const [checker, setChecker] = useState<(typeof CHECKERS)[number]["id"]>("expression");
  const [answer, setAnswer] = useState("");
  const [quote, setQuote] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const idBase = `author-${packet.packet_id}`;
  const submit = async () => {
    setBusy(true);
    onError("");
    try {
      const res = await canvasStudy.createItem(packet.packet_id, {
        source_id: sourceId,
        objective_label: objective,
        stem,
        checker_type: checker,
        answer,
        support_quote: quote,
        explanation,
      });
      onMessage(`Added question ${res.item_id} (packet version ${res.version}).`);
      setStem("");
      setAnswer("");
      setQuote("");
      setExplanation("");
      setOpen(false);
      await onCreated();
    } catch (e) {
      onError(e instanceof StudyRequestError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Add a question from this material
      </button>
    );
  }
  return (
    <form
      className="author"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="muted">You write the question and the expected answer; the quote you paste must appear verbatim in the source so the key stays source-backed.</p>
      <label htmlFor={`${idBase}-source`}>Source</label>
      <select id={`${idBase}-source`} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
        {packet.sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.locator}
          </option>
        ))}
      </select>
      <label htmlFor={`${idBase}-objective`}>Objective (short)</label>
      <input id={`${idBase}-objective`} type="text" value={objective} onChange={(e) => setObjective(e.target.value)} required />
      <label htmlFor={`${idBase}-stem`}>Question</label>
      <textarea id={`${idBase}-stem`} rows={2} value={stem} onChange={(e) => setStem(e.target.value)} required />
      <label htmlFor={`${idBase}-checker`}>How to check</label>
      <select id={`${idBase}-checker`} value={checker} onChange={(e) => setChecker(e.target.value as (typeof CHECKERS)[number]["id"])}>
        {CHECKERS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {checker !== "none" && (
        <>
          <label htmlFor={`${idBase}-answer`}>Expected answer</label>
          <input id={`${idBase}-answer`} type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
          <label htmlFor={`${idBase}-quote`}>Supporting quote (verbatim from the source)</label>
          <textarea id={`${idBase}-quote`} rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} required />
        </>
      )}
      <label htmlFor={`${idBase}-explanation`}>Explanation shown after answering (optional)</label>
      <textarea id={`${idBase}-explanation`} rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          Save question
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
