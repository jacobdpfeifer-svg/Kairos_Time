import { Fragment, useState, type ReactNode } from "react";
import { friendlyDue, friendlyRelative } from "../format";
import type { AssignmentBrief as Brief, BriefAction, BriefEvidence, BriefFeedbackOutcome, ChecklistKind, EvidenceKind, FrameSection } from "./contracts";

/*
 * One full brief: what is known, where it came from, and when it was
 * prepared — then the student's order of sections. The "Do this next" CTA is
 * the only highlighted action. Agent proposals are labeled as suggestions;
 * nothing here can submit, comment, or post to Canvas.
 */

const CHECK_TAG: Record<ChecklistKind, string> = {
  source_backed: "From Canvas",
  student_setting: "Your plan",
  agent_proposal: "Suggestion",
};

const EVIDENCE_TAG: Record<EvidenceKind, string> = {
  canvas: "Canvas",
  course_source: "Course material",
  library: "Your library",
  student: "Your note",
  connector: "Connected account",
  general_recommendation: "General advice",
};

const STATE_NOTE: Record<Brief["state"], string | null> = {
  ready: null,
  partial: "Some of this isn't in Canvas yet.",
  needs_source: "Canvas has too little to prepare a full brief.",
  stale: "Canvas hasn't synced recently, so this may be out of date.",
};

/** Body text from the assembler: "- " lines become a list, the rest paragraphs. */
export function BriefText({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) blocks.push(<ul key={key}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  body.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("- ")) list.push(t.slice(2));
    else {
      flush(`l${i}`);
      if (t) blocks.push(<p key={`p${i}`}>{t}</p>);
    }
  });
  flush("end");
  return <>{blocks}</>;
}

function EvidenceRow({ e, onOpen }: { e: BriefEvidence; onOpen: (url: string) => void }) {
  return (
    <li className="mc-evidence">
      <span className="row-main">
        {e.locator ? (
          <button type="button" className="link row-title" onClick={() => onOpen(e.locator as string)}>
            {e.label}
          </button>
        ) : (
          <span className="row-title">{e.label}</span>
        )}
        <span className="row-meta">
          {EVIDENCE_TAG[e.kind]}
          {e.retrieved_at ? `, read ${friendlyRelative(e.retrieved_at)}` : ""}
        </span>
      </span>
    </li>
  );
}

export function AssignmentBriefView({
  brief,
  headingId,
  updated,
  onShowUpdated,
  onAction,
  onOpenUrl,
  onFeedback,
  onEnrich,
  enriching = false,
  now = new Date(),
}: {
  brief: Brief;
  headingId: string;
  /** The sources changed after this brief was prepared. */
  updated?: boolean;
  onShowUpdated?: () => void;
  onAction: (action: BriefAction) => void;
  onOpenUrl: (url: string) => void;
  onFeedback?: (outcome: BriefFeedbackOutcome) => void;
  onEnrich?: () => void;
  enriching?: boolean;
  now?: Date;
}) {
  const [feedback, setFeedback] = useState<BriefFeedbackOutcome | null>(null);
  const primary = brief.actions.find((a) => a.primary) ?? brief.actions[0];
  const others = brief.actions.filter((a) => a !== primary);
  const sources = brief.evidence.filter((e) => e.kind === "course_source").length;
  const stateNote = STATE_NOTE[brief.state];

  const actionButton = (a: BriefAction, isPrimary: boolean) => (
    <button
      key={a.id}
      type="button"
      className={isPrimary ? "primary" : "ghost"}
      disabled={a.availability !== "available"}
      title={a.availability !== "available" ? a.reason : undefined}
      onClick={() => onAction(a)}
    >
      {a.label}
    </button>
  );

  const sections: Record<FrameSection, ReactNode> = {
    next_step: (
      <section className="mc-next" aria-labelledby={`${headingId}-next`}>
        <h4 id={`${headingId}-next`}>Do this next</h4>
        <p>{brief.next_step}</p>
        {primary && <div className="focus-actions">{actionButton(primary, true)}</div>}
      </section>
    ),
    requirements: (
      <section aria-labelledby={`${headingId}-req`}>
        <h4 id={`${headingId}-req`}>What it requires</h4>
        <ul>
          <li>{brief.due_at ? `Due ${friendlyDue(brief.due_at, now)}` : "Due date: not found in Canvas"}</li>
          {brief.requirements.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
    ),
    checklist: (
      <section aria-labelledby={`${headingId}-check`}>
        <h4 id={`${headingId}-check`}>Before you start</h4>
        <ul className="mc-checklist">
          {brief.checklist.map((c) => (
            <li key={c.id}>
              <span>{c.text}</span> <span className="mc-tag">{CHECK_TAG[c.kind]}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    why: brief.why_it_matters ? (
      <section aria-labelledby={`${headingId}-why`}>
        <h4 id={`${headingId}-why`}>Why it matters now</h4>
        <p>
          {brief.why_it_matters} {brief.why_is_general && <span className="mc-tag">General advice</span>}
        </p>
      </section>
    ) : null,
    module: (
      <section aria-labelledby={`${headingId}-mod`}>
        <h4 id={`${headingId}-mod`}>{brief.module.title}</h4>
        {brief.module.sections.map((s) => (
          <div key={s.id} className="mc-module-section">
            <h5>
              {s.title} {s.proposal && <span className="mc-tag">Suggestion, yours to change</span>}
            </h5>
            <BriefText body={s.body} />
          </div>
        ))}
      </section>
    ),
    materials: brief.evidence.length ? (
      <section aria-labelledby={`${headingId}-mat`}>
        <h4 id={`${headingId}-mat`}>Materials</h4>
        <ul className="rows">
          {brief.evidence.filter((e) => e.kind !== "general_recommendation").map((e) => (
            <EvidenceRow key={e.id} e={e} onOpen={onOpenUrl} />
          ))}
        </ul>
      </section>
    ) : null,
  };

  return (
    <div className="mc-brief" style={{ ["--course" as string]: brief.course_color }}>
      <p className="mc-provenance">
        Prepared {friendlyRelative(brief.prepared_at, now)} from Canvas{sources ? ` and ${sources === 1 ? "1 course material" : `${sources} course materials`}` : ""}.
        {stateNote ? ` ${stateNote}` : ""}
      </p>
      {updated && (
        <p className="mc-updated" role="status">
          Updated since this brief was prepared.{" "}
          {onShowUpdated && (
            <button type="button" className="link" onClick={onShowUpdated}>
              Show the updated brief
            </button>
          )}
        </p>
      )}
      {brief.gaps && brief.gaps.length > 0 && (
        <ul className="mc-gaps" aria-label="What's missing">
          {brief.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}

      {brief.section_order.map((s) => (
        <Fragment key={s}>{sections[s]}</Fragment>
      ))}

      {brief.enrichment && (
        <section className="mc-enrichment" aria-labelledby={`${headingId}-ai`}>
          <h4 id={`${headingId}-ai`}>
            A fuller brief <span className="mc-tag">AI suggestion, check it against Canvas</span>
          </h4>
          {brief.enrichment.sections.map((s) => (
            <div key={s.id} className="mc-module-section">
              <h5>{s.title}</h5>
              <BriefText body={s.body} />
            </div>
          ))}
          {brief.enrichment.gaps.length > 0 && <p className="muted">Still missing: {brief.enrichment.gaps.join("; ")}.</p>}
        </section>
      )}

      {(others.length > 0 || onEnrich) && (
        <div className="mc-other-actions">
          {others.map((a) => actionButton(a, false))}
          {onEnrich && !brief.enrichment && brief.state !== "needs_source" && (
            <button type="button" className="ghost" disabled={enriching} onClick={onEnrich}>
              {enriching ? "Preparing" : "Prepare a fuller brief"}
            </button>
          )}
        </div>
      )}

      {onFeedback && (
        <div className="mc-feedback">
          {feedback ? (
            <p className="muted" role="status">
              Thanks. Saved on this Mac only.
            </p>
          ) : (
            <>
              <span className="muted">Was this brief useful?</span>
              {(
                [
                  ["helpful", "Helpful"],
                  ["not_specific_enough", "Not specific enough"],
                  ["wrong_context", "Wrong context"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setFeedback(value);
                    onFeedback(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
