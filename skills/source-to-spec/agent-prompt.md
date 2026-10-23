# The four clauses every research-agent prompt carries

Reference for stage 3 of [`SKILL.md`](SKILL.md). Paste the block verbatim into
every agent prompt; fill only the `<list>` and `N` placeholders.

```text
TAGS. Tag every claim with exactly one of these four, and use no other scheme:
  [V]  read in the source you cite, this session
  [2°] from a secondary summary of a primary source
  [D]  derived by you from the maths or from stated constraints
  [?]  could not verify — say so plainly and do not smooth over it
A number without a tag is treated as fabricated.

CORRECTIONS ARE A DELIVERABLE. Say which claims in your brief are wrong,
overstated, or unsourceable. This is wanted, not a failure.

SCOPE. You own: <list>. You do NOT research: <list owned by other agents>.
If you find something in another agent's scope, name it in one line and move on.

FORMAT. Tables wherever values exist, every row with a URL. No preamble, no
"I searched for". Max ~N words. Say "not found" rather than guessing.
```

**Why the tag vocabulary is mandated:** in the 2026-10-23 run three agents invented three different schemes (`V/M/D`, `V/2°/D`, `MEASURED/CLAIMED/SECONDARY/INFERENCE`) and the orchestrator normalized them by hand. Mandate it or pay for it.

**Why scopes are exclusive:** in the same run two agents independently researched the same author's blog and the same design-system token tables. Give one agent the token tables and tell the others to skip them. Name the overlap you expect; the harness's generic "don't duplicate" note is not enough.

