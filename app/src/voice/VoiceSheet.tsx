// Purpose: live voice session sheet
import { useEffect, useMemo, useState } from "react";
import { InkRing } from "./InkRing";
import { readCourseColors } from "../ipc";
import { useVoicePresence, voicePresence, withCourseColors, type VoicePresence } from "./presence";

const LABEL: Record<VoicePresence["state"], string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
  done: "Done",
  error: "Voice stopped",
};

const ACTIVE = new Set(["listening", "thinking", "speaking"]);

function captionFor(p: VoicePresence): string {
  switch (p.state) {
    case "listening":
      return p.transcript || "Go ahead, I'm listening.";
    case "thinking":
      return p.status || "Working on it.";
    case "speaking":
    case "done":
      return p.reply;
    case "error":
      return p.error || "The voice session ended unexpectedly. Start it again to retry.";
    default:
      return p.reply || "Say what you need.";
  }
}

/**
 * The voice surface (MASTER §08): a sheet at the bottom of the workspace that
 * appears when the voice model starts a session and stays until the student
 * closes it. The ink ring shows that Kairos is listening or answering; the
 * workspace underneath stays usable (no backdrop, no focus trap). Every state
 * has a text label, a caption, and Stop or Close.
 */
export function VoiceSheet() {
  const p = useVoicePresence();
  const [open, setOpen] = useState(() => voicePresence.get().state !== "idle");
  const [colors, setColors] = useState<Record<string, string>>({});
  const active = ACTIVE.has(p.state);

  useEffect(() => {
    let alive = true;
    readCourseColors()
      .then((c) => alive && setColors(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // follow the voice state during render so the first speaking frame already has its start time
  const [seenState, setSeenState] = useState(p.state);
  if (seenState !== p.state) {
    setSeenState(p.state);
    if (p.state !== "idle") setOpen(true);
  }

  const items = useMemo(() => withCourseColors(p.items, colors), [p.items, colors]);

  const close = () => {
    setOpen(false);
    voicePresence.reset();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active && voicePresence.canStop) voicePresence.stop();
      else if (!active) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active]);

  if (!open) return null;

  return (
    <aside className="voice-sheet" aria-label="Voice" data-state={p.state}>
      <div className="voice-ring">
        <InkRing state={p.state} getLevel={() => voicePresence.level} size={104} accent={items[0]?.color} />
      </div>
      <div className="voice-body">
        <p className="voice-label" aria-live="polite">
          {LABEL[p.state]}
        </p>
        <p className="voice-caption" aria-live="polite">
          {captionFor(p)}
        </p>
        {(p.state === "speaking" || p.state === "done" || (p.state === "idle" && items.length > 0)) && items.length > 0 && (
          <ol className="voice-answer" aria-label="Answer">
            {items.map((it, i) => (
              <li key={`${it.title}-${i}`} className="voice-line" style={{ ["--course" as string]: it.color || "var(--muted)" }}>
                <span className="course-dot" aria-hidden="true" />
                <span>
                  {it.title}
                  {it.due ? <span className="muted">, {it.due}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="voice-actions">
          {active && voicePresence.canStop ? (
            <button type="button" onClick={() => voicePresence.stop()}>
              Stop
            </button>
          ) : null}
          {!active ? (
            <button type="button" className="ghost" onClick={close}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
