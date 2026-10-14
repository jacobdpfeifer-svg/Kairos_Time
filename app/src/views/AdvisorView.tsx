import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EMPTY_ADVISOR, onInboxUpdated, readAdvisorSnapshot, type AdvisorSnapshot } from "../ipc";
import { useDialog } from "../components/useDialog";
import { advisorWrites } from "../study/api";

/**
 * Academic advisor (docs/handoff/academic-advisor-product-plan-2026-10-13.md).
 * Read-only: every requirement fact comes from the student's dated audit copy,
 * and every row says where it came from. Nothing here registers, emails, or
 * claims a requirement is satisfied in the live record.
 */

type Mode = "snapshot" | "path" | "decision" | "meeting";

const MODES: { id: Mode; label: string }[] = [
  { id: "snapshot", label: "Where I am" },
  { id: "path", label: "Paths" },
  { id: "decision", label: "Next decision" },
  { id: "meeting", label: "Advisor meeting" },
];

/** Above this many credits a term, a plan is flagged rather than presented as achievable. */
export const FULL_LOAD_CREDITS = 18;

/**
 * Fall and spring terms left after the current one, through `target`
 * ("Spring 2029"). Summer and winter sessions are not counted. Null when the
 * target can't be read or is this term or earlier.
 */
export function termsUntil(target: string, today: Date): number | null {
  const m = /\b(spring|summer|fall|autumn|winter)\s+(\d{4})\b/i.exec(target);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = Number(m[2]);
  // Spring Y = 2Y, Fall Y = 2Y + 1. Summer finishes after spring; winter before spring.
  const targetIndex = season === "fall" || season === "autumn" ? 2 * year + 1 : season === "winter" ? 2 * year - 1 : 2 * year;
  const month = today.getMonth();
  const currentIndex = month <= 6 ? 2 * today.getFullYear() : 2 * today.getFullYear() + 1;
  const terms = targetIndex - currentIndex;
  return terms > 0 ? terms : null;
}

export type Pace = { label: string; terms: number; perTerm: number; overload: boolean };

export function paces(remaining: number | null, target: string, today: Date): Pace[] {
  const terms = termsUntil(target, today);
  if (remaining === null || terms === null) return [];
  const row = (label: string, n: number): Pace => {
    const perTerm = Math.round((remaining / n) * 10) / 10;
    return { label, terms: n, perTerm, overload: perTerm > FULL_LOAD_CREDITS };
  };
  return [row(`Finish by ${target}`, terms), row("One extra year", terms + 2)];
}

function shortDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Source({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return <span className={warn ? "advisor-source warn" : "advisor-source"}>{children}</span>;
}

function Row({ label, value, source, warn }: { label: string; value: ReactNode; source: ReactNode; warn?: boolean }) {
  return (
    <li className="advisor-row">
      <span className="advisor-row-label">{label}</span>
      <span className="advisor-row-value">{value}</span>
      <Source warn={warn}>{source}</Source>
    </li>
  );
}

function auditSource(s: AdvisorSnapshot): string {
  if (!s.audit.present) return "No audit copy";
  if (!s.audit.dated) return "Audit copy, no date";
  return s.audit.stale ? `Audit copy from ${shortDate(s.audit.imported_on)}, out of date` : `Audit copy from ${shortDate(s.audit.imported_on)}`;
}

function canvasSource(s: AdvisorSnapshot): string {
  return s.as_of ? `Canvas, synced ${shortDate(s.as_of)}` : "Canvas not synced yet";
}

function Focus({ snapshot, onPrepare, onAddAudit }: { snapshot: AdvisorSnapshot; onPrepare: () => void; onAddAudit: () => void }) {
  const { audit } = snapshot;
  let title: string;
  let body: string;
  if (!audit.present) {
    title = "Add a copy of your degree audit";
    body =
      "Copy the requirements your school's portal lists as done, in progress, and still needed, and paste each part here. Until then Kairos can help you plan questions, but it won't say which requirements are done.";
  } else if (!audit.dated) {
    title = "Add the date to your audit copy";
    body = "Your audit copy doesn't say when it was taken, so treat every count below as unconfirmed. Add an imported_on date, or bring the live audit to your advisor.";
  } else if (audit.stale) {
    title = "Refresh your audit copy";
    body = `Your copy is from ${shortDate(audit.imported_on)}, ${plural(audit.stale_days ?? 0, "day")} ago. The counts below may no longer match your record.`;
  } else if (audit.unmet_items.length) {
    title = `Plan for ${audit.unmet_items[0]}`;
    body = `It's one of ${plural(audit.unmet_count, "open requirement")} in your audit copy from ${shortDate(audit.imported_on)}. Check prerequisites and when it's offered before you register.`;
  } else {
    title = "Confirm you're on track";
    body = `Your audit copy from ${shortDate(audit.imported_on)} lists no open requirements. Confirm that in the live audit before you register.`;
  }
  return (
    <section className="advisor-focus" aria-labelledby="advisor-focus-title">
      <h2 id="advisor-focus-title">{title}</h2>
      <p>{body}</p>
      <div className="row focus-actions">
        {!audit.present || !audit.dated || audit.stale ? (
          <>
            <button type="button" className="primary" onClick={onAddAudit}>
              {audit.present ? "Paste a fresh copy" : "Add your audit"}
            </button>
            <button type="button" className="ghost" onClick={onPrepare}>
              Prepare advisor questions
            </button>
          </>
        ) : (
          <button type="button" className="primary" onClick={onPrepare}>
            Prepare advisor questions
          </button>
        )}
      </div>
    </section>
  );
}

function SnapshotMode({
  s,
  onPrepare,
  onAddAudit,
  onEditProfile,
}: {
  s: AdvisorSnapshot;
  onPrepare: () => void;
  onAddAudit: () => void;
  onEditProfile: () => void;
}) {
  const { audit } = s;
  const pace = paces(audit.remaining_credits, s.target_grad_term, new Date())[0];
  const ADD = (
    <button type="button" className="link" onClick={onEditProfile}>
      Add it
    </button>
  );
  return (
    <>
      <Focus snapshot={s} onPrepare={onPrepare} onAddAudit={onAddAudit} />
      <h2 className="advisor-section-title">Where you stand</h2>
      <ul className="advisor-rows">
        <Row label="Program" value={s.program || "Not recorded"} source={s.program ? "Your profile" : ADD} warn={!s.program} />
        <Row label="Catalog year" value={s.catalog_year || "Not recorded"} source={audit.catalog_year ? auditSource(s) : s.catalog_year ? "Your profile" : ADD} warn={!s.catalog_year} />
        <Row label="Target term" value={s.target_grad_term || "Not recorded"} source={s.target_grad_term ? "Your profile" : ADD} warn={!s.target_grad_term} />
        {audit.present && (
          <Row
            label="Requirements"
            value={`${audit.complete_count} complete, ${audit.in_progress_count} in progress, ${audit.unmet_count} open`}
            source={auditSource(s)}
            warn={audit.stale}
          />
        )}
        {audit.present && (
          <Row
            label="Credits left"
            value={
              audit.remaining_credits === null
                ? "Not in your audit copy"
                : pace
                  ? `${audit.remaining_credits}, about ${pace.perTerm} a term over ${plural(pace.terms, "term")}`
                  : `${audit.remaining_credits}`
            }
            source={auditSource(s)}
            warn={audit.stale || audit.remaining_credits === null || Boolean(pace?.overload)}
          />
        )}
      </ul>
      {pace?.overload && (
        <p className="advisor-warning" role="note">
          Finishing by {s.target_grad_term} means about {pace.perTerm} credits a term, more than a typical full load. Ask your advisor whether that's possible before planning around it.
        </p>
      )}

      {audit.present && audit.unmet_items.length > 0 && (
        <>
          <h2 className="advisor-section-title">Still open in your audit copy</h2>
          <ul className="advisor-rows">
            {audit.unmet_items.map((item) => (
              <li key={item} className="advisor-row">
                <span className="advisor-row-value">{item}</span>
                <Source warn={audit.stale}>{auditSource(s)}</Source>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="advisor-section-title">This term</h2>
      {s.courses.length ? (
        <ul className="advisor-rows">
          {s.courses.map((course) => (
            <li key={course} className="advisor-row">
              <span className="advisor-row-value">{course}</span>
              <Source warn={!s.as_of}>{canvasSource(s)}</Source>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No classes from Canvas yet. They appear here after your first sync.</p>
      )}
    </>
  );
}

function PathMode({ s }: { s: AdvisorSnapshot }) {
  const rows = paces(s.audit.remaining_credits, s.target_grad_term, new Date());
  const missing: string[] = [];
  if (!s.audit.present || s.audit.remaining_credits === null) missing.push("a remaining-credit total from your audit copy");
  if (!s.target_grad_term) missing.push("a target term in your profile");
  else if (termsUntil(s.target_grad_term, new Date()) === null) missing.push(`a target term after this one (yours reads "${s.target_grad_term}")`);
  return (
    <section aria-labelledby="advisor-path-title">
      <h2 id="advisor-path-title" className="advisor-section-title">How fast you'd need to go</h2>
      {rows.length ? (
        <>
          <ul className="advisor-rows">
            {rows.map((row) => (
              <Row
                key={row.label}
                label={row.label}
                value={`About ${row.perTerm} credits a term for ${plural(row.terms, "term")}`}
                source={row.overload ? "Above a full load" : "Estimate"}
                warn={row.overload || s.audit.stale}
              />
            ))}
          </ul>
          <p className="muted advisor-footnote">
            Counts fall and spring terms after this one, and assumes the {s.audit.remaining_credits} credits left in your audit copy
            from {shortDate(s.audit.imported_on) || "an undated import"} don't include this term's classes. Summer courses would lower the load. Prerequisites and
            when courses are offered aren't checked yet.
          </p>
        </>
      ) : (
        <p className="muted">To compare paths, Kairos needs {missing.join(" and ")}.</p>
      )}
    </section>
  );
}

function DecisionMode({ s, onPrepare }: { s: AdvisorSnapshot; onPrepare: () => void }) {
  const first = s.audit.unmet_items[0];
  const steps = [
    first ? `Pick a course for ${first}, plus one backup in case it's full.` : "Find the requirement that unlocks the most later courses in your live audit.",
    "Check its prerequisites and co-requisites against the classes you've finished or are taking now.",
    "Check which terms it's offered. A course taught once a year goes first.",
    s.target_grad_term ? `Compare the load with your target of ${s.target_grad_term}, your GPA goals, and work or other commitments.` : "Compare the load with your GPA goals and work or other commitments.",
  ];
  return (
    <section aria-labelledby="advisor-decision-title">
      <h2 id="advisor-decision-title" className="advisor-section-title">What to settle before you register</h2>
      <ol className="advisor-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button type="button" className="primary" onClick={onPrepare}>
        Prepare advisor questions
      </button>
      <p className="muted advisor-footnote">Kairos explains options. You confirm and register in your school's official system.</p>
    </section>
  );
}

export function meetingBrief(s: AdvisorSnapshot): string {
  const lines = [
    "Questions for my advisor",
    "",
    `Program: ${s.program || "not recorded"}`,
    `Catalog year: ${s.catalog_year || "not recorded"}`,
    `Target term: ${s.target_grad_term || "not recorded"}`,
  ];
  if (s.audit.present) {
    lines.push(`Audit copy: ${s.audit.dated ? `from ${s.audit.imported_on}` : "no date"}${s.audit.remaining_credits === null ? "" : `, ${s.audit.remaining_credits} credits left`}`);
  }
  lines.push("", ...s.questions.map((q, i) => `${i + 1}. ${q}`));
  return lines.join("\n");
}

function MeetingMode({ s }: { s: AdvisorSnapshot }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = () => {
    if (!navigator.clipboard) {
      setCopied("failed");
      return;
    }
    navigator.clipboard.writeText(meetingBrief(s)).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  };
  return (
    <section aria-labelledby="advisor-meeting-title">
      <h2 id="advisor-meeting-title" className="advisor-section-title">Bring this to your advisor</h2>
      <p className="muted">A draft for you. Kairos doesn't send it or book the meeting.</p>
      <ol className="advisor-steps">
        {s.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
      <div className="advisor-actions">
        <button type="button" className="primary" onClick={copy} disabled={!s.questions.length}>
          Copy questions
        </button>
        <span role="status" className="muted">
          {copied === "done" ? "Copied. Paste it into an email or your notes." : copied === "failed" ? "Couldn't copy. Select the list and copy it instead." : ""}
        </span>
      </div>
      <p className="muted advisor-footnote">
        Built from {lowerFirst(auditSource(s))}, {lowerFirst(canvasSource(s)).replace(/^canvas/, "Canvas")}, and {s.program || s.target_grad_term ? "your profile" : "no profile answers yet"}.
      </p>
    </section>
  );
}

export function AdvisorView() {
  const [snapshot, setSnapshot] = useState<AdvisorSnapshot>(EMPTY_ADVISOR);
  const [mode, setMode] = useState<Mode>("snapshot");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [sheet, setSheet] = useState<"" | "audit" | "profile">("");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const refresh = () => {
    setState("loading");
    readAdvisorSnapshot().then(
      (next) => {
        setSnapshot(next);
        setState("ready");
        setLoadedOnce(true);
      },
      () => setState("error"),
    );
  };

  useEffect(() => {
    refresh();
    const unlisten = onInboxUpdated(refresh);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + MODES.length) % MODES.length;
    setMode(MODES[next].id);
    tabs.current[next]?.focus();
  };

  const prepare = () => setMode("meeting");

  return (
    <section className="advisor-page scene-paper" aria-labelledby="advisor-heading" aria-busy={state === "loading"}>
      <header className="advisor-heading-row">
        <div>
          <h1 id="advisor-heading">Advisor</h1>
          <p className="advisor-intro">Where you stand, what to decide next, and what to ask a human advisor.</p>
        </div>
        <button type="button" className="ghost" onClick={refresh} disabled={state === "loading"}>
          {state === "loading" ? "Checking…" : "Check again"}
        </button>
      </header>

      {state === "error" && (
        <p className="advisor-warning" role="alert">
          Couldn't read your planning files. Try again.
        </p>
      )}

      <div className="segmented advisor-modes" role="tablist" aria-label="Advisor views">
        {MODES.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            id={`advisor-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            aria-controls="advisor-panel"
            tabIndex={mode === item.id ? 0 : -1}
            onClick={() => setMode(item.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="advisor-panel" role="tabpanel" aria-labelledby={`advisor-tab-${mode}`} className="advisor-panel">
        {!loadedOnce && state === "loading" ? (
          <p className="muted">Reading your planning files…</p>
        ) : (
          mode === "snapshot" && <SnapshotMode s={snapshot} onPrepare={prepare} onAddAudit={() => setSheet("audit")} onEditProfile={() => setSheet("profile")} />
        )}
        {mode === "path" && <PathMode s={snapshot} />}
        {mode === "decision" && <DecisionMode s={snapshot} onPrepare={prepare} />}
        {mode === "meeting" && <MeetingMode s={snapshot} />}
      </div>
      {sheet === "audit" && (
        <AuditSheet
          onClose={() => setSheet("")}
          onSaved={() => {
            setSheet("");
            refresh();
          }}
        />
      )}
      {sheet === "profile" && (
        <ProfileSheet
          s={snapshot}
          onClose={() => setSheet("")}
          onSaved={() => {
            setSheet("");
            refresh();
          }}
        />
      )}
    </section>
  );
}

/** Paste the audit in its three parts, dated. Nothing is inferred from a blob. */
function AuditSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "textarea" });
  const [form, setForm] = useState({ taken_on: new Date().toISOString().slice(0, 10), catalog_year: "", complete: "", in_progress: "", still_needed: "", remaining_credits: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} className="plan-sheet sheet" role="dialog" aria-modal="true" aria-labelledby="audit-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 id="audit-title">Add your degree audit</h2>
        <p className="muted">Open your audit in your school's portal and copy each part. One requirement per line is easiest. Kairos never signs in to the portal.</p>
        <form
          className="audit-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await advisorWrites.auditImport(form);
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "The audit didn't save.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Still needed
            <textarea rows={4} value={form.still_needed} onChange={set("still_needed")} />
          </label>
          <label>
            In progress
            <textarea rows={3} value={form.in_progress} onChange={set("in_progress")} />
          </label>
          <label>
            Complete
            <textarea rows={3} value={form.complete} onChange={set("complete")} />
          </label>
          <div className="row">
            <label>
              Date the audit was taken
              <input type="date" value={form.taken_on} onChange={set("taken_on")} required />
            </label>
            <label>
              Catalog year
              <input placeholder="2025-2026" value={form.catalog_year} onChange={set("catalog_year")} />
            </label>
            <label>
              Credits left
              <input inputMode="decimal" value={form.remaining_credits} onChange={set("remaining_credits")} />
            </label>
          </div>
          {error && (
            <p role="alert" className="ask-error">
              {error}
            </p>
          )}
          <div className="sheet-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving" : "Save my audit"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The three Program lines Advisor reads from USER.md, asked where they're used. */
function ProfileSheet({ s, onClose, onSaved }: { s: AdvisorSnapshot; onClose: () => void; onSaved: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "input" });
  const [form, setForm] = useState({ program: s.program || "", catalog_year: s.catalog_year || "", target_term: s.target_grad_term || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} className="confirm-sheet sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 id="profile-title">Your program</h2>
        <form
          className="audit-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await advisorWrites.profileFields(form);
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "That didn't save.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Program or major
            <input value={form.program} onChange={set("program")} placeholder="Aerospace Engineering Sciences" />
          </label>
          <label>
            Catalog year
            <input value={form.catalog_year} onChange={set("catalog_year")} placeholder="2025-2026" />
          </label>
          <label>
            When you plan to graduate
            <input value={form.target_term} onChange={set("target_term")} placeholder="Spring 2029" />
          </label>
          {error && (
            <p role="alert" className="ask-error">
              {error}
            </p>
          )}
          <div className="sheet-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving" : "Save"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
