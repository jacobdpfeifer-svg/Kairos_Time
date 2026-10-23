/**
 * Purpose: answer "what frame rate does this surface actually get?" before anyone
 * designs for one (MASTER §15.7).
 *
 * A Tauri WKWebView on macOS is reported to be capped at 60fps while the Chrome
 * extension gets the display's real rate. That is a report, not a measurement of
 * this build, and §15.7 says to measure before acting on it.
 *
 * Dev only. Not imported by the app. Open devtools on the surface in question and:
 *
 *   const { measureFrameRate } = await import("/src/dev/frameRate.ts");
 *   console.table(await measureFrameRate());
 *
 * Run it on an idle screen first, then again during the live build or with the
 * voice ink ring open, and compare `p95` and `long`. A solid 60 is a pass; a
 * ragged 60 is the thing worth fixing, and it is fixed by making frames cheaper,
 * never by chasing 120.
 */

export type FrameRateReport = {
  /** Display rate macOS reports for the window, when the browser exposes it. */
  screenHz: number | null;
  frames: number;
  seconds: number;
  /** Mean frames per second over the window. */
  fps: number;
  /** Frame interval percentiles in ms. p50 near 16.7 means 60Hz; near 8.3 means 120Hz. */
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /** Intervals over 1.5x the median: dropped frames, the number that actually matters. */
  long: number;
  /** What p50 implies, for reading at a glance. */
  reads_as: string;
};

const pct = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100;

/** Samples requestAnimationFrame intervals for `ms` and reports the distribution. */
export function measureFrameRate(ms = 3000): Promise<FrameRateReport> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = performance.now();
    const started = last;

    const tick = (now: number) => {
      intervals.push(now - last);
      last = now;
      if (now - started < ms) {
        requestAnimationFrame(tick);
        return;
      }

      const sorted = [...intervals].sort((a, b) => a - b);
      const p50 = pct(sorted, 0.5);
      const seconds = (now - started) / 1000;
      // 8.3ms is 120Hz and 16.7ms is 60Hz; split the difference to label it.
      const reads_as = p50 < 12 ? "120Hz or better" : p50 < 22 ? "60Hz" : "below 60Hz";

      resolve({
        screenHz: typeof window !== "undefined" && "screen" in window ? ((window.screen as unknown as { refreshRate?: number }).refreshRate ?? null) : null,
        frames: intervals.length,
        seconds: Math.round(seconds * 100) / 100,
        fps: Math.round((intervals.length / seconds) * 10) / 10,
        p50,
        p95: pct(sorted, 0.95),
        p99: pct(sorted, 0.99),
        worst: Math.round(sorted[sorted.length - 1] * 100) / 100,
        long: intervals.filter((i) => i > p50 * 1.5).length,
        reads_as,
      });
    };

    requestAnimationFrame(tick);
  });
}
