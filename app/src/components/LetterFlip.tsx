// Purpose: animates title letters in sequence
export function LetterFlip({ text }: { text: string }) {
  return (
    <span className="letter-flip" data-letter-flip="">
      {Array.from(text).map((ch, i) => (
        <span key={`${ch}-${i}`} className="letter-flip-char" style={{ animationDelay: `${i * 40}ms` }}>
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </span>
  );
}
