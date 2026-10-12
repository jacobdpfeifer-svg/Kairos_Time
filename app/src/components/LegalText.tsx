/**
 * Terms + privacy as readable text. The canonical documents are Markdown
 * (docs/legal/, mirrored in legalDocs/); this renders headings, list items and
 * paragraphs as plain React text — no HTML is injected, and relative document
 * links become their label because both documents are already shown here.
 */
export function legalBlocks(md: string): { kind: "h" | "li" | "p" | "hr"; text: string }[] {
  const inline = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s{2,}$/, "")
      .trim();
  const blocks: { kind: "h" | "li" | "p" | "hr"; text: string }[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^-{3,}$/.test(line.trim())) blocks.push({ kind: "hr", text: "" });
    else if (/^#{1,6}\s/.test(line)) blocks.push({ kind: "h", text: inline(line.replace(/^#{1,6}\s+/, "")) });
    else if (/^\s*([-*]|\d+\.)\s+/.test(line)) blocks.push({ kind: "li", text: inline(line.replace(/^\s*[-*]\s+/, "• ")) });
    else blocks.push({ kind: "p", text: inline(line) });
  }
  return blocks;
}

export function LegalText({ text }: { text: string }) {
  return (
    <div className="legal-sheet" tabIndex={0} aria-label="Terms and privacy text">
      {legalBlocks(text).map((b, i) =>
        b.kind === "h" ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.kind === "hr" ? (
          <hr key={i} />
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
    </div>
  );
}
