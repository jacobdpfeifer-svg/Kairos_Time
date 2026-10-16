import { useEffect, useState } from "react";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { dismissCalendarSuggestion } from "../ipc";
import { connectors, emailDrafts, type EmailDraft } from "../study/api";
import type { CalendarProposal, OperationsIsland as Island } from "./contracts";

/*
 * Operations islands sit above the assignments and appear only when there is
 * something concrete to review. Calendar: read-only preview → a single-use
 * token bound to these exact fields → the student says yes → the provider
 * writes and the ledger records it. Email: an editable local draft and an
 * exact review; this device has no send bridge, so there is no Send button.
 */

function when(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start} to ${end}`;
  const day = s.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(s)} to ${t(e)}`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CalendarBody({ island, onDone }: { island: Island; onDone: () => void }) {
  const p = island.calendar as CalendarProposal;
  const [pending, setPending] = useState<{ token: string; fields: CalendarProposal } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const canAdd = island.action.availability === "available";

  const preview = async () => {
    setResult(null);
    try {
      const r = await connectors.gcalPreview(p.summary, p.start, p.end, p.why);
      if (!r.executable) {
        // Never a confirm step that cannot write: say so instead.
        setResult("Google Calendar isn't connected. Connect it in Settings to add blocks.");
        return;
      }
      setPending({ token: r.confirmation_token, fields: { ...p } });
    } catch (e) {
      setResult(`Couldn't prepare the preview: ${errorText(e)}`);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    // The token is bound to the fields it was issued for; anything else never reaches the provider.
    const f = pending.fields;
    if (f.summary !== p.summary || f.start !== p.start || f.end !== p.end || f.why !== p.why) {
      setPending(null);
      setResult("The block changed. Review it again.");
      return;
    }
    setBusy(true);
    try {
      await connectors.gcalConfirm(f.summary, f.start, f.end, f.why, pending.token);
      setResult("Added to your Google Calendar.");
      // Done: the proposal leaves the island instead of offering the same block again.
      await dismissCalendarSuggestion(p.suggestion_id).catch(() => undefined);
      onDone();
    } catch (e) {
      setResult(`Nothing was added: ${errorText(e)}`);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="mc-ops-body" style={{ ["--course" as string]: p.course_color ?? "var(--muted)" }}>
      <p className="mc-ops-what">
        <span className="course-dot" aria-hidden="true" /> <strong>{p.summary}</strong>
      </p>
      <p>{when(p.start, p.end)}</p>
      <p className="muted">Why: {p.why}.</p>
      <p className="muted">If you add it, one event is created in your Google Calendar. Nothing changes in Canvas.</p>
      {result && <p role="status">{result}</p>}
      <div className="mc-other-actions">
        <button type="button" className="ghost" disabled={!canAdd} title={canAdd ? undefined : island.action.reason} onClick={() => void preview()}>
          Add to calendar
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void dismissCalendarSuggestion(p.suggestion_id).then(onDone);
          }}
        >
          Not now
        </button>
      </div>
      {!canAdd && island.action.reason && <p className="muted">{island.action.reason}.</p>}
      {pending && (
        <ConfirmSheet title="Add this to your calendar?" yes="Yes, add it" busy={busy} onYes={() => void confirm()} onNo={() => setPending(null)}>
          <dl className="mc-exact">
            <dt>Event</dt>
            <dd>{pending.fields.summary}</dd>
            <dt>When</dt>
            <dd>{when(pending.fields.start, pending.fields.end)}</dd>
            <dt>Calendar</dt>
            <dd>Your Google Calendar</dd>
          </dl>
        </ConfirmSheet>
      )}
    </div>
  );
}

function EmailBody({ island, onDone }: { island: Island; onDone: () => void }) {
  const email = island.email!;
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [form, setForm] = useState({ intent: "", to: "", subject: "", body: "" });
  const [evidence, setEvidence] = useState<{ id: string; subject: string }[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const first = email.drafts[0];
    if (!first) return;
    void emailDrafts
      .get(first.draft_id)
      .then((r) => {
        setDraft(r.draft);
        setForm({ intent: r.draft.intent, to: r.draft.to.join(", "), subject: r.draft.subject, body: r.draft.body });
        setEvidence(r.draft.evidence);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Editing anything returns to the draft; the earlier review no longer stands.
    setReviewing(false);
    setCopied(false);
  };

  const save = async (): Promise<EmailDraft | null> => {
    setError(null);
    try {
      const fields = { ...form, evidence, connector: "outlook" };
      const r = draft ? await emailDrafts.update(draft.draft_id, fields) : await emailDrafts.create(fields);
      setDraft(r.draft);
      onDone();
      return r.draft;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  };

  const review = async () => {
    const saved = await save();
    if (!saved) return;
    try {
      const r = await emailDrafts.review(saved.draft_id);
      setDraft(r.draft);
      setReviewing(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="mc-ops-body">
      {email.context.length > 0 && (
        <>
          <h4>In your Outlook inbox</h4>
          <ul className="rows">
            {email.context.map((m) => {
              const used = evidence.some((x) => x.id === m.id);
              return (
                <li key={m.id} className="mc-evidence">
                  <span className="row-main">
                    <span className="row-title">{m.subject}</span>
                    <span className="row-meta">{m.from}</span>
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    aria-pressed={used}
                    onClick={() => {
                      setEvidence((ev) => (used ? ev.filter((x) => x.id !== m.id) : [...ev, { id: m.id, subject: m.subject }]));
                      setReviewing(false);
                    }}
                  >
                    {used ? "Replying to this" : "Reply to this"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4>{draft ? "Your draft" : "Start a draft"}</h4>
      <div className="mc-draft-form">
        <label>
          What you want to say, in your words
          <textarea rows={2} value={form.intent} onChange={(e) => edit("intent", e.target.value)} />
        </label>
        <label>
          To
          <input type="email" multiple value={form.to} onChange={(e) => edit("to", e.target.value)} />
        </label>
        <label>
          Subject
          <input value={form.subject} onChange={(e) => edit("subject", e.target.value)} />
        </label>
        <label>
          Message
          <textarea rows={6} value={form.body} onChange={(e) => edit("body", e.target.value)} />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="mc-other-actions">
        <button type="button" className="ghost" onClick={() => void save()}>
          Save draft
        </button>
        <button type="button" className="ghost" onClick={() => void review()}>
          Review draft
        </button>
        {draft && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void emailDrafts.discard(draft.draft_id).then(() => {
                setDraft(null);
                setForm({ intent: "", to: "", subject: "", body: "" });
                setEvidence([]);
                setReviewing(false);
                onDone();
              });
            }}
          >
            Discard
          </button>
        )}
      </div>

      {reviewing && draft && (
        <section className="mc-review" aria-labelledby="mc-review-title">
          <h4 id="mc-review-title">Exactly what would be sent</h4>
          <dl className="mc-exact">
            <dt>To</dt>
            <dd>{draft.to.join(", ")}</dd>
            <dt>Subject</dt>
            <dd>{draft.subject}</dd>
            <dt>Message</dt>
            <dd className="mc-pre">{draft.body}</dd>
            <dt>Based on</dt>
            <dd>{draft.evidence.length ? draft.evidence.map((x) => x.subject).join("; ") : "Nothing from your inbox"}</dd>
            <dt>Account</dt>
            <dd>Outlook (read-only)</dd>
          </dl>
          {/* No Send button while this device can't honor the confirmation contract. */}
          <p className="mc-send-state" role="note">
            {email.send.reason}. Copy it into your mail app to send it yourself.
          </p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(draft.body)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy message"}
          </button>
        </section>
      )}
    </div>
  );
}

export function OperationsIslands({ islands, onChanged }: { islands: Island[]; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!islands.length) return null;
  return (
    <ul className="mc-ops" aria-label="To review">
      {islands.map((island) => {
        const isOpen = open === island.island_id;
        const headerId = `${island.island_id}-header`;
        const panelId = `${island.island_id}-panel`;
        return (
          <li key={island.island_id} className={`mc-ops-island${isOpen ? " is-open" : ""}`}>
            <h3 className="mc-island-heading">
              <button
                id={headerId}
                type="button"
                className="mc-island-header"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : island.island_id)}
              >
                <span className="mc-island-main">
                  <span className="mc-island-title">{island.title}</span>
                  <span className="row-meta">{island.summary}</span>
                </span>
                <span className="mc-island-side">
                  <span className="row-when">{isOpen ? "Close" : island.action.label}</span>
                </span>
              </button>
            </h3>
            {isOpen && (
              <div id={panelId} role="region" aria-labelledby={headerId} className="mc-island-panel">
                {island.kind === "calendar" && island.calendar ? <CalendarBody island={island} onDone={onChanged} /> : null}
                {island.kind === "email" && island.email ? <EmailBody island={island} onDone={onChanged} /> : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
