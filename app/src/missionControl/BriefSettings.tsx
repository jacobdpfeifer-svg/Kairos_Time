import { useEffect, useState } from "react";
import { exportBriefFeedback, readBriefPrefs, writeBriefPrefs } from "./api";
import { DEFAULT_BRIEF_PREFERENCES, type BriefPreferences } from "./contracts";

/*
 * Brief ordering preferences (calibration/brief-preferences.json). These only
 * choose what comes first: requirements, sources, and limits always show. The
 * beta ordering test is offered to connected testers only, is random and
 * local, and its feedback leaves this Mac only when the student exports it.
 */

export function BriefSettings({ tester }: { tester: boolean }) {
  const [prefs, setPrefs] = useState<BriefPreferences | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    void readBriefPrefs()
      .then(setPrefs)
      .catch(() => setPrefs({ ...DEFAULT_BRIEF_PREFERENCES }));
  }, []);

  if (!prefs) return <p className="muted">Loading…</p>;

  const save = (next: BriefPreferences) => {
    setPrefs(next);
    setNote("");
    void writeBriefPrefs(next)
      .then((saved) => {
        setPrefs(saved);
        setNote("Saved. Your briefs will reorder in a moment.");
      })
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  };

  return (
    <>
      <h2>Briefs</h2>
      <p className="muted">These only change what comes first. Requirements and where each fact came from always show.</p>
      <div className="settings-form">
      <label>
        When you open a paper brief, show first
        <select value={prefs.paper_first} onChange={(e) => save({ ...prefs, paper_first: e.target.value as BriefPreferences["paper_first"], calibrated: true })}>
          <option value="requirements">What the prompt requires</option>
          <option value="outline">A starting outline</option>
          <option value="next_step">The next step to take</option>
        </select>
      </label>
      <label>
        When you open a problem set brief, show first
        <select value={prefs.problem_set_first} onChange={(e) => save({ ...prefs, problem_set_first: e.target.value as BriefPreferences["problem_set_first"], calibrated: true })}>
          <option value="next_step">The next step to take</option>
          <option value="concept_map">The topics it uses</option>
          <option value="worked_example_link">A worked example from class</option>
        </select>
      </label>
      <label>
        Every brief starts with
        <select value={prefs.default_order} onChange={(e) => save({ ...prefs, default_order: e.target.value as BriefPreferences["default_order"] })}>
          <option value="next_step_first">Do this next</option>
          <option value="requirements_first">What it requires</option>
        </select>
      </label>
      </div>
      {tester && (
        <label className="check">
          <input type="checkbox" checked={Boolean(prefs.beta_opt_in)} onChange={(e) => save({ ...prefs, beta_opt_in: e.target.checked })} />
          <span className="check-box" aria-hidden="true" />
          Help test brief ordering (beta). Kairos picks one of two equally complete orders at random. Your one-tap ratings stay on this Mac.
        </label>
      )}
      <div className="mc-other-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void exportBriefFeedback().then((data) => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = "kairos-brief-feedback.json";
              a.click();
              URL.revokeObjectURL(url);
              setNote("Exported counts only: no titles, courses, or assignment text.");
            });
          }}
        >
          Export my brief ratings
        </button>
        <button type="button" className="link" onClick={() => save({ ...DEFAULT_BRIEF_PREFERENCES, calibrated: false })}>
          Reset
        </button>
      </div>
      {note && <p role="status">{note}</p>}
    </>
  );
}
