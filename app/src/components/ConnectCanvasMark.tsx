import { useEffect, useState } from "react";

/** A short visual handoff: Kairos → Chrome → student sign-in → Kairos courses. */
export function ConnectCanvasMark({ reduced }: { reduced: boolean }) {
  return (
    <div
      className={`connect-mark${reduced ? " reduced" : ""}`}
      role="img"
      aria-label="Choose your school in Kairos, sign in and complete MFA in Chrome, then return to Kairos to see your classes"
    >
      <div className="handoff-film" aria-hidden="true">
        <div className="handoff-scene scene-school">
          <div className="handoff-window kairos-window">
            <div className="handoff-bar"><i /><i /><i /><span>Kairos</span></div>
            <div className="handoff-content"><strong>Your school</strong><span className="handoff-row"><b />School selected</span></div>
          </div>
          <span className="handoff-label">Choose school</span>
        </div>
        <div className="handoff-scene scene-chrome">
          <div className="handoff-window kairos-window behind-window">
            <div className="handoff-bar"><i /><i /><i /><span>Kairos</span></div>
            <div className="handoff-content"><strong>Waiting for Canvas</strong></div>
          </div>
          <div className="handoff-window chrome-window">
            <div className="handoff-bar chrome-bar"><b>Chrome</b><span>canvas.yourschool.edu</span></div>
            <div className="handoff-content"><strong>Chrome opens on top</strong><span className="handoff-sub">Expected</span></div>
          </div>
          <span className="handoff-label">Kairos stays open underneath</span>
        </div>
        <div className="handoff-scene scene-login">
          <div className="handoff-window chrome-window solo-window">
            <div className="handoff-bar chrome-bar"><b>Chrome</b><span>School sign-in</span></div>
            <div className="handoff-content"><strong>You sign in here</strong><span className="handoff-row"><b className="shield-dot">✓</b>Complete MFA here</span></div>
          </div>
          <span className="handoff-label">Your password stays with your school</span>
        </div>
        <div className="handoff-scene scene-done">
          <div className="handoff-window kairos-window">
            <div className="handoff-bar"><i /><i /><i /><span>Kairos</span></div>
            <div className="handoff-content"><strong>Your classes are ready</strong><span className="handoff-row"><b className="course-dot one" />Course name</span><span className="handoff-row"><b className="course-dot two" />Course name</span><span className="handoff-row"><b className="course-dot three" />Course name</span></div>
          </div>
          <span className="handoff-label">Back in Kairos</span>
        </div>
      </div>
    </div>
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
