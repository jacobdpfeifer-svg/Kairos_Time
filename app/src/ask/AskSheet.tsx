import { MotionDialog } from "../components/MotionDialog";
import type { AskEnvelope } from "../study/types";
import { AskPanel } from "./AskPanel";

/**
 * Ask as a sheet over the current screen (MASTER §10 navigation): it never
 * replaces the next move, and Escape or Cancel puts the student back.
 */
export function AskSheet({
  initial,
  seed,
  onClose,
  onResult,
  onConnectAi,
  onNextStep,
}: {
  initial?: AskEnvelope | null;
  seed?: { content: string; courseHint?: string; assignmentHint?: string };
  onClose: () => void;
  onResult?: (result: AskEnvelope | null) => void;
  onConnectAi?: () => void;
  onNextStep?: (title: string) => void;
}) {
  return (
    <MotionDialog onClose={onClose} rise className="ask-sheet sheet" labelledBy="ask-sheet-title" initialFocus="[data-autofocus]">
      {(close) => (
        <>
          <header className="ask-sheet-head">
            <h2 id="ask-sheet-title">Ask Kairos</h2>
            <button type="button" className="ghost" onClick={close}>
              Close
            </button>
          </header>
          <p className="muted ask-sheet-lede">Uses your Canvas material and files. Quizzes and exams you're taking stay unanswered.</p>
          <AskPanel
            label="Ask Kairos"
            startOpen={!initial?.response}
            initial={initial ?? null}
            seed={seed}
            onCancel={close}
            onResult={onResult}
            onConnectAi={onConnectAi}
            onNextStep={onNextStep}
          />
        </>
      )}
    </MotionDialog>
  );
}
