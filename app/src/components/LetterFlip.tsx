/** Outcome text. The word is the state; it does not flip. */
export function LetterFlip({ text }: { text: string }) {
  return (
    <span className="letter-flip" data-letter-flip="">
      {text}
    </span>
  );
}
