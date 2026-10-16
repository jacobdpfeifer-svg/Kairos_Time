import { useState } from "react";
import type { BriefPreferences } from "./contracts";

/*
 * One optional two-screen calibration, shown only after a sync has put real
 * briefs on the page. The answers choose ordering and default expansion only;
 * requirements, sources, and limits always show. Settings can change or reset it.
 */

const PAPER: { value: BriefPreferences["paper_first"]; label: string }[] = [
  { value: "requirements", label: "What the prompt requires" },
  { value: "outline", label: "A starting outline" },
  { value: "next_step", label: "The next step to take" },
];

const PSET: { value: BriefPreferences["problem_set_first"]; label: string }[] = [
  { value: "concept_map", label: "The topics it uses" },
  { value: "worked_example_link", label: "A worked example from class" },
  { value: "next_step", label: "The next step to take" },
];

export function BriefCalibration({ prefs, onSave }: { prefs: BriefPreferences; onSave: (next: BriefPreferences) => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [paper, setPaper] = useState(prefs.paper_first);
  const done = (pset: BriefPreferences["problem_set_first"] | null) =>
    onSave({ ...prefs, paper_first: paper, problem_set_first: pset ?? prefs.problem_set_first, calibrated: true });

  const options = step === 0 ? PAPER : PSET;
  return (
    <section className="mc-calibrate" aria-labelledby="mc-calibrate-title">
      <h2 id="mc-calibrate-title" className="today-section-title">
        {step === 0 ? "When you open a paper brief, what should come first?" : "When you open a problem set brief, what helps first?"}
      </h2>
      <p className="muted">Optional. {step === 0 ? "1" : "2"} of 2. You can change this in Settings.</p>
      <div className="mc-other-actions">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="ghost"
            onClick={() => {
              if (step === 0) {
                setPaper(o.value as BriefPreferences["paper_first"]);
                setStep(1);
              } else done(o.value as BriefPreferences["problem_set_first"]);
            }}
          >
            {o.label}
          </button>
        ))}
        <button type="button" className="link" onClick={() => done(null)}>
          Skip
        </button>
      </div>
    </section>
  );
}
