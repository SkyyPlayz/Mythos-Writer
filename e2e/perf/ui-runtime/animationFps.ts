/**
 * animationFps.ts — SKY-8217 metric 3: ambient animations at 60fps.
 *
 * Samples real `requestAnimationFrame` deltas on the real renderer `Page` of
 * the packaged Electron build (never a mock/stub of the rAF loop or the
 * animation itself — only the Anthropic network call is mocked anywhere in
 * this suite, per repo convention). The caller is responsible for launching
 * via `launchApp(userData, { reducedMotion: false })` (see launch.ts) —
 * measuring with `--force-prefers-reduced-motion` set would just measure "0
 * dropped frames because nothing is animating" (liquidNeon.css's
 * `@media (prefers-reduced-motion: reduce)` rule collapses the wallpaper
 * drift/ambience animations to a single 0.01ms frame), not the real ambient
 * animation the target is about.
 *
 * The element sampled for presence, `[data-testid="ln-bg-wallpaper"]`
 * (`.ln-bg-wallpaper`, `animation: lnDrift 70s ...` in
 * frontend/src/theme/liquidNeon.css), is rendered by
 * frontend/src/theme/BackgroundStack.tsx, which frontend/src/DesktopShell.tsx
 * mounts once at the top of the app shell (`<BackgroundStack
 * settings={appSettings?.liquidNeonV2} />`, right inside the shell's root
 * div, above `WindowChrome`/`WindowChrome`'s siblings) — i.e. it is part of
 * the always-on background stack behind every glass panel, not gated behind
 * any specific view/tab. That means we only need to wait for the shell to be
 * mounted (any page state after `firstWindow`/navigation), not navigate to a
 * particular screen, before sampling.
 */
import type { Page } from '@playwright/test';

/** Standard 60fps frame budget in ms (1000ms / 60). */
const FRAME_BUDGET_MS_60FPS = 1000 / 60;

/**
 * "Dropped frame" heuristic: a frame that took more than 1.5x the 60fps
 * budget (~25ms) to arrive is considered dropped/janky. This 1.5x multiplier
 * is the standard heuristic used by Chrome's own frame-timing tooling (and
 * matches the `RAIL`/`jank` guidance of "no frame should take >1.5 frame
 * budgets") — it tolerates ordinary rAF scheduling jitter around 16.7ms
 * without over-counting, while still catching real half-frame-or-worse stalls.
 */
const DROPPED_FRAME_THRESHOLD_MS = 1.5 * FRAME_BUDGET_MS_60FPS;

/** Minimum number of sampled deltas required before stats are meaningful. */
const MIN_SAMPLES = 10;

/**
 * Waits for the always-on ambient wallpaper layer to be present, then runs a
 * real `requestAnimationFrame` loop in-page for `durationMs` wall-clock ms,
 * recording each frame's `t - lastT` delta (in ms). The loop and its timing
 * are real browser/compositor signals sampled via `page.evaluate` — nothing
 * here is faked or pre-computed outside the page.
 *
 * Returns the raw list of inter-frame deltas in chronological order. The
 * first frame observed has no prior timestamp to diff against, so the
 * returned array has one fewer entry than the number of rAF callbacks that
 * actually fired during `durationMs`.
 */
export async function sampleFrameDeltas(page: Page, durationMs = 3000): Promise<number[]> {
  await page.locator('[data-testid="ln-bg-wallpaper"]').waitFor({ state: 'visible', timeout: 20_000 });

  const deltasMs = await page.evaluate((duration: number) => {
    return new Promise<number[]>((resolve) => {
      const deltas: number[] = [];
      let lastT: number | null = null;
      let startT: number | null = null;

      function step(t: number): void {
        if (startT === null) startT = t;
        if (lastT !== null) deltas.push(t - lastT);
        lastT = t;
        if (t - startT < duration) {
          requestAnimationFrame(step);
        } else {
          resolve(deltas);
        }
      }

      requestAnimationFrame(step);
    });
  }, durationMs);

  return deltasMs;
}

export interface FrameStats {
  /** Raw inter-frame deltas (ms) as sampled by `sampleFrameDeltas`. */
  deltasMs: number[];
  /** Number of deltas the stats below are computed from. */
  sampleCount: number;
  /** Mean fps across the whole sample window: 1000 / mean(deltasMs). */
  avgFps: number;
  /** Median (50th percentile) of the per-frame instantaneous fps distribution. */
  p50Fps: number;
  /**
   * 5th percentile of the per-frame instantaneous-fps distribution — i.e.
   * the fps floor that 95% of sampled frames met or beat. Deliberately named
   * "p95Fps" to match "p95 latency"-style naming (the 95% band you can rely
   * on), NOT "the 95th percentile of the fps distribution" — for an fps
   * metric the 95th-percentile-of-fps would describe the *fast* tail, which
   * is the wrong direction for a "how bad does it get" floor. Computed as
   * `percentile(fpsSortedAscending, 5)`.
   */
  p95Fps: number;
  /**
   * Percentage of sampled frame deltas that exceeded 1.5x the 60fps frame
   * budget (~25ms) — the standard "frame took >1.5x its budget" dropped-frame
   * heuristic (see `DROPPED_FRAME_THRESHOLD_MS`).
   */
  droppedFramePct: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Percentile of a distribution using the same nearest-rank method as
 * keystrokePaint.ts's local `percentile` helper: sort ascending, then
 * `idx = ceil(p/100 * n) - 1`, clamped to the array bounds.
 */
function percentile(valuesAscending: number[], p: number): number {
  const n = valuesAscending.length;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return valuesAscending[idx];
}

/**
 * Reduces raw rAF-delta samples (from `sampleFrameDeltas`) into fps summary
 * stats. Throws if fewer than `MIN_SAMPLES` deltas are provided — with only
 * a couple of frames sampled the resulting "stats" would be noise dressed up
 * as a measurement, not a real signal about ambient-animation smoothness.
 */
export function summarizeFrames(deltasMs: number[]): FrameStats {
  if (deltasMs.length < MIN_SAMPLES) {
    throw new Error(
      `SKY-8217: only ${deltasMs.length} frame delta(s) sampled — need at least ${MIN_SAMPLES} to ` +
        'compute meaningful fps stats. Refusing to report fabricated-looking numbers off too few frames.',
    );
  }

  const avgFps = 1000 / mean(deltasMs);

  const fpsAscending = deltasMs.map((d) => 1000 / d).sort((a, b) => a - b);
  const p50Fps = percentile(fpsAscending, 50);
  // 5th percentile of the fps distribution — see FrameStats.p95Fps doc comment.
  const p95Fps = percentile(fpsAscending, 5);

  const droppedFrames = deltasMs.filter((d) => d > DROPPED_FRAME_THRESHOLD_MS).length;
  const droppedFramePct = (droppedFrames / deltasMs.length) * 100;

  return {
    deltasMs,
    sampleCount: deltasMs.length,
    avgFps,
    p50Fps,
    p95Fps,
    droppedFramePct,
  };
}
