import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byCapabilityWeight, proposeAmendment } from "../scripts/lib/workspace/amend.mjs";

const catalog = [
  { id: "a", label: "First", weight: 10, requires: [] },
  { id: "b", label: "Second", weight: 30, requires: [] },
];

function shift(iso, delta) {
  const [year, month, day] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day) + delta * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function days(n, surface, start = "2026-10-12") {
  return Array.from({ length: n }, (_, i) => ({ date: shift(start, i), first_surface: typeof surface === "function" ? surface(i) : surface }));
}

function usage(over = {}) {
  return {
    schema_version: 1,
    surfaces: { today: { opens: 1, first_of_day: 1, dwell_seconds: 10 } },
    days: [],
    blocks: {},
    ...over,
  };
}

function spec(over = {}) {
  return {
    quiet: { interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"] },
    blocks: { b_a: { capability: "a" } },
    surfaces: { today: { slots: ["b_a"] } },
    ...over,
  };
}

const emptyLedger = { schema_version: 1, pending: null, last_proposed_on: null, dismissed: [], stopped_kinds: [] };

describe("proposeAmendment", () => {
  it("asks to make Week home after 9 of the last 10 days, and the patch inverts", () => {
    const desk = spec();
    const proposal = proposeAmendment(desk, usage({ days: days(10, (i) => (i === 0 ? "today" : "week")) }), {
      now: "2026-10-21",
      ledger: emptyLedger,
      catalog,
    });
    assert.equal(proposal.rationale, "You've opened Week first 9 of the last 10 days. Make Week your home screen?");
    assert.deepEqual(proposal.patches, [{ op: "set_home", home: "week" }]);
    const inverse = { op: "set_home", home: desk.home ?? null };
    assert.equal(inverse.home, null);
    assert.equal(inverse.op, proposal.patches[0].op);
  });

  it("refuses a second proposal the same week, then allows a different one", () => {
    const desk = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" } },
      surfaces: { today: { slots: ["b_a", "b_b"] } },
    });
    const counted = usage({
      days: days(10, (i) => (i === 0 ? "today" : "week")),
      blocks: {
        b_a: { expansions: 2, last_seen: "2026-10-21" },
        b_b: { expansions: 6, last_seen: "2026-10-21" },
      },
    });
    const first = proposeAmendment(desk, counted, { now: "2026-10-21", ledger: emptyLedger, catalog });
    assert.equal(first.kind, "home");
    const pending = { ...emptyLedger, pending: first, last_proposed_on: "2026-10-21" };
    assert.equal(proposeAmendment(desk, counted, { now: "2026-10-24", ledger: pending, catalog }), null);
    const dismissed = { ...emptyLedger, pending: null, last_proposed_on: "2026-10-21", dismissed: ["home:week"] };
    assert.equal(proposeAmendment(desk, counted, { now: "2026-10-24", ledger: dismissed, catalog }), null);
    const later = proposeAmendment(desk, counted, { now: "2026-10-28", ledger: dismissed, catalog });
    assert.equal(later.kind, "reorder");
    assert.deepEqual(later.patches, [{ op: "reorder", surface: "today", block_id: "b_b", index: 0 }]);
    const back = { op: "reorder", surface: "today", block_id: "b_b", index: 1 };
    assert.equal(back.block_id, later.patches[0].block_id);
    assert.equal(back.index, 1);
  });

  it("does not bring a dismissed fingerprint or a stopped kind back", () => {
    const counted = usage({ days: days(10, "week") });
    const dismissed = { ...emptyLedger, last_proposed_on: "2026-10-01", dismissed: ["home:week"] };
    assert.equal(proposeAmendment(spec(), counted, { now: "2026-10-21", ledger: dismissed, catalog }), null);
    const stopped = { ...emptyLedger, last_proposed_on: "2026-10-01", stopped_kinds: ["home"] };
    assert.equal(proposeAmendment(spec(), counted, { now: "2026-10-21", ledger: stopped, catalog }), null);
    const reorderOnly = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" } },
      surfaces: { today: { slots: ["b_a", "b_b"] } },
    });
    const used = usage({
      days: days(2, "today"),
      blocks: {
        b_a: { expansions: 1, last_seen: "2026-10-13" },
        b_b: { expansions: 9, last_seen: "2026-10-13" },
      },
    });
    assert.equal(proposeAmendment(reorderOnly, used, { now: "2026-10-13", ledger: { ...emptyLedger, stopped_kinds: ["reorder"] }, catalog }), null);
  });

  it("returns null for garbage, partial, and empty usage", () => {
    const desk = spec();
    const opts = { now: "2026-10-21", ledger: emptyLedger, catalog };
    const goodDays = days(10, "week");
    assert.equal(proposeAmendment(desk, null, opts), null);
    assert.equal(proposeAmendment(desk, usage({ days: goodDays, transcript: "the essay" }), opts), null);
    assert.equal(proposeAmendment(desk, { schema_version: 1, surfaces: { week: { opens: "nine" } } }, opts), null);
    assert.equal(
      proposeAmendment(desk, usage({ days: goodDays, surfaces: { week: { opens: 9, first_of_day: 9, dwell_seconds: -1 } } }), opts),
      null,
    );
    assert.equal(proposeAmendment(desk, usage({ days: [{ date: "2026-10-21", first_surface: "nowhere" }] }), opts), null);
    assert.equal(proposeAmendment(desk, usage(), opts), null);
  });

  it("does not reorder on a small gap, and does not empty a tab", () => {
    const desk = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" } },
      surfaces: { today: { slots: ["b_a", "b_b"] } },
    });
    const small = usage({
      days: days(2, "today"),
      blocks: {
        b_a: { expansions: 4, last_seen: "2026-10-13" },
        b_b: { expansions: 8, last_seen: "2026-10-13" },
      },
    });
    assert.equal(proposeAmendment(desk, small, { now: "2026-10-13", ledger: emptyLedger, catalog }), null);

    const only = spec();
    const stale = usage({
      days: days(2, "today"),
      blocks: { b_a: { expansions: 0, last_seen: "2026-09-01" } },
    });
    assert.equal(proposeAmendment(only, stale, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);

    const pair = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" } },
      surfaces: { today: { slots: ["b_a", "b_b"] } },
    });
    // `last_seen` is the day the tab was shown, so the recorder gives every block
    // on a surface the same stamp. Only the expansion gap can single one block out.
    const unused = usage({
      days: days(14, "today", "2026-10-08"),
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-10-21" },
        b_b: { expansions: 4, last_seen: "2026-10-21" },
      },
    });
    const removal = proposeAmendment(pair, unused, { now: "2026-10-21", ledger: emptyLedger, catalog });
    assert.equal(removal.kind, "remove_unused");
    assert.deepEqual(removal.patches, [{ op: "remove", surface: "today", block_id: "b_a" }]);
    const inverse = { op: "place", surface: "today", block_id: "b_a", index: 0, block: pair.blocks.b_a };
    assert.equal(inverse.block_id, removal.patches[0].block_id);
  });

  it("will not remove a block on the strength of a tab-level stamp alone", () => {
    const pair = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" } },
      surfaces: { today: { slots: ["b_a", "b_b"] } },
    });
    const history = days(14, "today", "2026-10-08");

    // The shape record_workspace_usage actually writes: siblings share last_seen
    // and nothing has been expanded. Neither block is "unused" more than the other.
    const untouched = usage({
      days: history,
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-10-21" },
        b_b: { expansions: 0, last_seen: "2026-10-21" },
      },
    });
    assert.equal(proposeAmendment(pair, untouched, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);

    // One stray tap on the neighbour is not a clear gap.
    const faint = usage({
      days: history,
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-10-21" },
        b_b: { expansions: 1, last_seen: "2026-10-21" },
      },
    });
    assert.equal(proposeAmendment(pair, faint, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);

    // The student stopped visiting the tab: that is not a reason to edit it.
    const abandoned = usage({
      days: history,
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-09-01" },
        b_b: { expansions: 4, last_seen: "2026-09-01" },
      },
    });
    assert.equal(proposeAmendment(pair, abandoned, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);

    // A fresh file says nothing yet, however lopsided it looks.
    const young = usage({
      days: days(3, "today", "2026-10-19"),
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-10-21" },
        b_b: { expansions: 9, last_seen: "2026-10-21" },
      },
    });
    assert.equal(proposeAmendment(pair, young, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);
  });

  it("keeps a block another block requires, wherever that block sits", () => {
    const needy = [
      { id: "a", label: "First", weight: 10, requires: [] },
      { id: "b", label: "Second", weight: 30, requires: [] },
      { id: "c", label: "Third", weight: 40, requires: ["a"] },
    ];
    const across = spec({
      blocks: { b_a: { capability: "a" }, b_b: { capability: "b" }, b_c: { capability: "c" } },
      surfaces: { today: { slots: ["b_a", "b_b"] }, week: { slots: ["b_c"] } },
    });
    const unused = usage({
      days: days(14, "today", "2026-10-08"),
      blocks: {
        b_a: { expansions: 0, last_seen: "2026-10-21" },
        b_b: { expansions: 4, last_seen: "2026-10-21" },
        b_c: { expansions: 0, last_seen: "2026-10-21" },
      },
    });
    assert.equal(proposeAmendment(across, unused, { now: "2026-10-21", ledger: emptyLedger, catalog: needy }), null);
  });

  it("drops only a due-date notice, and restores by putting that kind back", () => {
    const opened = usage({ days: days(21, "today", "2026-10-01") });
    const proposal = proposeAmendment(spec({ home: "today" }), opened, { now: "2026-10-21", ledger: emptyLedger, catalog });
    assert.equal(proposal.kind, "narrow_interrupts");
    assert.deepEqual(proposal.patches, [{ op: "set_quiet", interrupt_for: ["high_stakes_48h", "sync_broken"] }]);
    assert.equal(proposal.rationale.includes("due date"), true);
    const inverse = { op: "set_quiet", interrupt_for: ["due_moved", "high_stakes_48h", "sync_broken"] };
    assert.equal(inverse.interrupt_for.includes("high_stakes_48h"), true);
    assert.equal(inverse.interrupt_for.includes("sync_broken"), true);
    const already = spec({ home: "today", quiet: { interrupt_for: ["high_stakes_48h", "sync_broken"] } });
    assert.equal(proposeAmendment(already, opened, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);
    const unsafe = spec({ home: "today", quiet: { interrupt_for: ["due_moved", "sync_broken"] } });
    assert.equal(proposeAmendment(unsafe, opened, { now: "2026-10-21", ledger: emptyLedger, catalog }), null);
  });

  it("orders capabilities by weight, then id", () => {
    assert.ok(byCapabilityWeight("a", "b", catalog) < 0);
    assert.equal(byCapabilityWeight("missing", "missing", catalog), 0);
  });
});
