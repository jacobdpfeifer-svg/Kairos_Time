import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDialog } from "./useDialog";

/*
 * ⌘K (MASTER §06 command bar): every action and every item, one input.
 * Each action shows its key so the shortcut is learned by using the bar.
 * Empty input shows recent picks; `?` lists every shortcut; anything that
 * matches nothing becomes a question for Ask.
 */

export type CommandGroup = "Do" | "Go to" | "Add" | "Ask";

export type Command = {
  id: string;
  group: CommandGroup;
  label: string;
  /** Muted text on the right: a key, a course, a date. */
  hint?: string;
  keys?: string;
  /** Extra words that should find this command. */
  keywords?: string;
  /** Course label, used to group long item lists. */
  course?: string;
  run: () => void;
};

const RECENT_KEY = "pn_cmd_recent";
const GROUP_ORDER: CommandGroup[] = ["Add", "Do", "Go to", "Ask"];

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function remember(id: string) {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* recents are a convenience */
  }
}

/** Higher is better; 0 means no match. Prefix beats word-start beats substring beats in-order letters. */
export function score(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - Math.min(50, t.length - q.length);
  const at = t.indexOf(q);
  if (at > 0 && /\W/.test(t[at - 1])) return 70;
  if (at >= 0) return 50;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i += 1;
  return i === q.length ? 10 : 0;
}

export function CommandBar({
  commands,
  onClose,
  onAsk,
  addRow,
}: {
  commands: Command[];
  onClose: () => void;
  onAsk: (question: string) => void;
  /** Phase 4 capture: given the query, the row that adds it (with its parse preview), or null. */
  addRow?: (query: string) => Command | null;
}) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "input" });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const recent = useMemo(loadRecent, []);
  const showKeys = query.trim() === "?";

  const results = useMemo(() => {
    if (showKeys) return commands.filter((c) => c.keys);
    const q = query.trim();
    if (!q) {
      const recents = recent.map((id) => commands.find((c) => c.id === id)).filter(Boolean) as Command[];
      const doCmds = commands.filter((c) => c.group === "Do" && !recent.includes(c.id));
      return [...recents.map((c) => ({ ...c, group: "Do" as CommandGroup, id: c.id })), ...doCmds];
    }
    const scored = commands
      .map((c) => ({ c, s: Math.max(score(q, c.label), score(q, c.keywords || "") * 0.8, score(q, c.hint || "") * 0.5) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group));
    const found = scored.map((x) => x.c);
    const add = addRow?.(q);
    const ask: Command = { id: "ask:query", group: "Ask", label: `Ask Kairos: ${q}`, run: () => onAsk(q) };
    return [...(add ? [add] : []), ...found, ask];
  }, [commands, query, recent, showKeys, addRow, onAsk]);

  const grouped = useMemo(() => {
    const out: { group: string; rows: Command[] }[] = [];
    const items = results.filter((r) => r.group === "Go to" && r.course);
    const byCourse = items.length > 30;
    for (const g of GROUP_ORDER) {
      const rows = results.filter((r) => r.group === g);
      if (!rows.length) continue;
      if (g === "Go to" && byCourse) {
        const loose = rows.filter((r) => !r.course);
        if (loose.length) out.push({ group: "Go to", rows: loose });
        const courses = [...new Set(items.map((r) => r.course as string))];
        for (const c of courses) out.push({ group: c, rows: items.filter((r) => r.course === c) });
      } else {
        out.push({ group: query.trim() || showKeys ? g : g === "Do" && recent.length ? "Recent and actions" : g, rows });
      }
    }
    return out;
  }, [results, query, recent, showKeys]);
  const flat = grouped.flatMap((g) => g.rows);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    if (cmd.id !== "ask:query" && !cmd.id.startsWith("add:")) remember(cmd.id);
    onClose();
    cmd.run();
  };

  let index = -1;
  const body: ReactNode = grouped.map((g) => (
    <li key={g.group} role="presentation" className="cmd-group">
      <p className="cmd-group-title" aria-hidden="true">
        {g.group}
      </p>
      <ul role="group" aria-label={g.group}>
        {g.rows.map((cmd) => {
          index += 1;
          const i = index;
          return (
            <li
              key={`${g.group}:${cmd.id}`}
              id={`cmd-${i}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              className={i === active ? "cmd-row active" : "cmd-row"}
              onMouseMove={() => setActive(i)}
              onClick={() => run(cmd)}
            >
              <span className="cmd-label">{cmd.label}</span>
              {(cmd.keys || cmd.hint) && <span className="cmd-hint">{cmd.keys || cmd.hint}</span>}
            </li>
          );
        })}
      </ul>
    </li>
  ));

  return (
    <div className="sheet-backdrop cmd-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} className="cmd-bar sheet" role="dialog" aria-modal="true" aria-label="Command bar" onClick={(e) => e.stopPropagation()}>
        <input
          className="cmd-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={flat.length ? `cmd-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Type a command, a class, or a question. ? lists shortcuts."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setActive((a) => Math.min(flat.length - 1, a + 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(flat[active]);
            }
          }}
        />
        <ul id="cmd-list" role="listbox" aria-label="Results" className="cmd-list" ref={listRef}>
          {body}
        </ul>
        {flat.length === 0 && <p className="muted cmd-empty">Nothing matches. Press Enter to ask Kairos instead.</p>}
      </div>
    </div>
  );
}
