/** A still picture of the handoff. The sequence is in the accessible name, not a loop. */
export function ConnectCanvasMark() {
  return (
    <div
      className="connect-mark"
      role="img"
      aria-label="Choose your school in Kairos, sign in and complete MFA in Chrome, then return to Kairos to see your classes"
    >
      <div className="handoff-film" aria-hidden="true">
        <div className="handoff-scene scene-school">
          <div className="handoff-window kairos-window">
            <div className="handoff-bar">
              <i />
              <i />
              <i />
              <span>Kairos</span>
            </div>
            <div className="handoff-content">
              <strong>Your school</strong>
              <span className="handoff-row">
                <b />
                School selected
              </span>
            </div>
          </div>
          <span className="handoff-label">Choose school</span>
        </div>
      </div>
    </div>
  );
}

export { useMotionReduced as useReducedMotion } from "../motion";
