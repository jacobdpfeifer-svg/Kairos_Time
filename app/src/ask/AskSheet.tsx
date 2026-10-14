import { useDialog } from "../components/useDialog";
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
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "[data-autofocus]" });
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        ref={ref}
        className="ask-sheet sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-sheet-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ask-sheet-head">
          <h2 id="ask-sheet-title">Ask Kairos</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted ask-sheet-lede">Uses your Canvas material and files. Quizzes and exams you're taking stay unanswered.</p>
        <AskPanel
          label="Ask Kairos"
          startOpen={!initial?.response}
          initial={initial ?? null}
          seed={seed}
          onCancel={onClose}
          onResult={onResult}
          onConnectAi={onConnectAi}
          onNextStep={onNextStep}
        />
      </div>
    </div>
  );
}
