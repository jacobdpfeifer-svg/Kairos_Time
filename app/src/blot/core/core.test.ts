// Purpose: tests the blot motion engine
import { describe, expect, it } from "vitest";
import {
  answerTimeline,
  areaOf,
  charsWritten,
  createBlot,
  createBody,
  createLevelMeter,
  createMachine,
  DOZE_AFTER,
  NIB_INDEX,
  rmsOf,
  targetOutline,
  type BlotEvent,
} from "./index.js";

const run = (n: number, fn: (i: number) => void) => {
  for (let i = 0; i < n; i++) fn(i);
};

describe("soft body", () => {
  it("keeps its area within 5% through a hard landing and settles in 1.5 s", () => {
    const body = createBody({});
    const rest = areaOf(targetOutline({}));
    body.impulse("land", 3);
    let worst = 0;
    run(90, () => {
      body.step(1 / 60, {});
      worst = Math.max(worst, Math.abs(body.area() / rest - 1));
    });
    expect(worst).toBeLessThan(0.05);
    const target = targetOutline({});
    const err = Math.max(...Array.from(target, (v, i) => Math.abs(v - body.points[i])));
    expect(err).toBeLessThan(0.02);
  });

  it("visibly jiggles: a landing moves the rim by at least a tenth of the radius", () => {
    const body = createBody({});
    body.impulse("land", 2.2);
    let peak = 0;
    run(30, () => {
      body.step(1 / 60, {});
      const t = targetOutline({});
      peak = Math.max(peak, ...Array.from(t, (v, i) => Math.abs(v - body.points[i])));
    });
    expect(peak).toBeGreaterThan(0.1);
  });

  it("is deterministic for the same dt sequence", () => {
    const a = createBody({});
    const b = createBody({});
    a.impulse("poke", 2);
    b.impulse("poke", 2);
    run(40, (i) => {
      const dt = i % 3 ? 1 / 60 : 1 / 45;
      a.step(dt, { sx: 1.1, sy: 0.9 });
      b.step(dt, { sx: 1.1, sy: 0.9 });
    });
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
  });

  it("the nib tuft is the highest point and survives squash", () => {
    for (const pose of [{}, { sx: 1.1, sy: 0.86 }, { sx: 0.94, sy: 1.08 }]) {
      const t = targetOutline(pose);
      const ys = Array.from({ length: t.length / 2 }, (_, i) => t[i * 2 + 1]);
      expect(Math.min(...ys)).toBe(ys[NIB_INDEX]);
    }
  });

  it("stays on the floor when squashed, shrunk, or dozing", () => {
    for (const pose of [{ sx: 1.1, sy: 0.86 }, { shrink: 0.2 }, { sx: 1.28, sy: 0.6, sag: 1 }]) {
      const t = targetOutline(pose);
      const bottom = Math.max(...Array.from({ length: t.length / 2 }, (_, i) => t[i * 2 + 1]));
      expect(bottom).toBeCloseTo(1, 2);
    }
  });
});

describe("machine", () => {
  const collect = (m: ReturnType<typeof createMachine>, input: object, seconds: number) => {
    const events: BlotEvent[] = [];
    run(Math.round(seconds * 60), () => events.push(...m.update(input, 1 / 60).events));
    return events;
  };

  it("unknown states fall back to idle", () => {
    const m = createMachine();
    expect(m.update({ state: "dancing" }, 1 / 60).state).toBe("idle");
  });

  it("done: crouches, hops, then lands and stamps exactly once", () => {
    const m = createMachine();
    const first = m.update({ state: "done" }, 1 / 60);
    expect(first.pose.sy).toBeLessThan(1); // anticipation
    const events = collect(m, { state: "done" }, 2);
    expect(events.filter((e) => e.kind === "land")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "stamp")).toHaveLength(1);
    expect(m.update({ state: "done" }, 1 / 60).face.eyes).toBe("happy");
  });

  it("speaking with items: one pinch per item, and Blot shrinks while giving ink", () => {
    const m = createMachine();
    const items = [{ title: "CSCI 2270 lab 4" }, { title: "PHYS 1110 set" }, { title: "Read ch. 3" }];
    const end = answerTimeline(items).at(-1)!.launchAt + 0.2;
    const events = collect(m, { state: "speaking", items, level: 0.3 }, end);
    expect(events.filter((e) => e.kind === "pinch")).toHaveLength(3);
    expect(m.update({ state: "speaking", items }, 1 / 60).pose.shrink).toBeGreaterThan(0.1);
    collect(m, { state: "done" }, 3);
    expect(m.update({ state: "done" }, 1 / 60).pose.shrink).toBeLessThan(0.02); // refilled
  });

  it("course colours soak in while thinking and drain one band per drop", () => {
    const m = createMachine();
    const items = [
      { title: "A", color: "#e1ad49" },
      { title: "B", color: "#ff604d" },
    ];
    collect(m, { state: "thinking", items }, 2);
    const full = m.update({ state: "thinking", items }, 1 / 60).bands;
    expect(full.map((b) => b.color)).toEqual(["#e1ad49", "#ff604d"]);
    expect(full.every((b) => b.amount > 0.9)).toBe(true);
    const tl = answerTimeline(items);
    collect(m, { state: "speaking", items }, tl[0].launchAt + 0.8);
    const mid = m.update({ state: "speaking", items }, 1 / 60).bands;
    expect(mid[0].amount).toBeLessThan(0.1);
    expect(mid[1].amount).toBeGreaterThan(0.9);
  });

  it("course colours drain away once the answer is over", () => {
    const m = createMachine();
    const items = [{ title: "A", color: "#e1ad49" }];
    collect(m, { state: "thinking", items }, 2);
    collect(m, { state: "done", items }, 1);
    collect(m, { state: "idle", items }, 2);
    expect(m.update({ state: "idle", items }, 1 / 60).bands.every((b) => b.amount < 0.01)).toBe(true);
  });

  it("dozes after a quiet idle stretch, and a poke or any voice wakes it", () => {
    const m = createMachine();
    collect(m, { state: "idle" }, DOZE_AFTER + 4);
    expect(m.update({ state: "idle" }, 1 / 60).label).toBe("dozing");
    m.poke();
    collect(m, { state: "idle" }, 0.5);
    expect(m.update({ state: "idle" }, 1 / 60).label).toBe("idle");
    collect(m, { state: "idle" }, DOZE_AFTER + 4);
    collect(m, { state: "listening", level: 0.2 }, 0.5);
    expect(m.update({ state: "listening" }, 1 / 60).face.eyes).toBe("open");
  });

  it("loud syllables stretch the body while talking", () => {
    const m = createMachine();
    m.update({ state: "speaking", level: 0 }, 1 / 60);
    const ev = m.update({ state: "speaking", level: 0.6 }, 1 / 60).events;
    expect(ev.some((e) => e.kind === "stretch")).toBe(true);
  });

  it("still mode (reduced motion) holds a pose per state with no events or blinking", () => {
    const m = createMachine();
    for (const state of ["idle", "listening", "thinking", "speaking", "done", "error"]) {
      const f = m.update({ state, items: [{ title: "x", color: "#fff" }] }, 1 / 60, { still: true });
      expect(f.events).toEqual([]);
      expect(f.hop).toBe(0);
      expect(f.face.blink).toBe(0);
    }
    expect(m.update({ state: "done" }, 0, { still: true }).face.eyes).toBe("happy");
  });
});

describe("level meter", () => {
  it("gates silence, rises fast, falls slowly, and clamps to 1", () => {
    const meter = createLevelMeter();
    expect(meter.push(0.005, 0.016)).toBe(0);
    let up = 0;
    run(3, () => (up = meter.push(0.5, 0.016)));
    expect(up).toBeGreaterThan(0.6);
    let down = up;
    run(3, () => (down = meter.push(0, 0.016)));
    expect(down).toBeGreaterThan(up * 0.5);
    run(200, () => meter.push(5, 0.016));
    expect(meter.level).toBeLessThanOrEqual(1);
  });

  it("rmsOf", () => {
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });
});

describe("answer timeline", () => {
  it("each drop lands before its line writes, and lines do not overlap", () => {
    const tl = answerTimeline([{ title: "CSCI 2270 lab 4" }, { title: "PHYS 1110 set" }]);
    expect(tl[0].landAt).toBeGreaterThan(tl[0].launchAt);
    expect(tl[0].writeStart).toBe(tl[0].landAt);
    expect(tl[1].launchAt).toBeGreaterThan(tl[0].writeEnd);
    expect(charsWritten(tl[0], 0)).toBe(0);
    expect(charsWritten(tl[0], tl[0].writeEnd + 1)).toBe(15);
  });
});

describe("engine", () => {
  it("runs a full exchange without NaN", () => {
    const blot = createBlot();
    const items = [{ title: "A lab", color: "#e1ad49" }];
    for (const [state, secs] of [
      ["listening", 1],
      ["thinking", 1],
      ["speaking", 3],
      ["done", 2],
      ["idle", 10],
    ] as const) {
      run(secs * 60, (i) => blot.update({ state, items, level: (i % 7) / 7 }, 1 / 60));
    }
    expect(Array.from(blot.points).every(Number.isFinite)).toBe(true);
  });
});
