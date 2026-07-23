/**
 * ui-runtime.spec.ts — SKY-8217
 *
 * Headless, CI-runnable harness for the 4 UI-runtime targets in
 * PERFORMANCE.md §0 ("Acceptance targets"), measured against the REAL
 * packaged Electron build (`out/main/main.js`) — never `electron-vite dev`.
 * Launch/seed plumbing, per-metric measurement, and mock-stream install are
 * all reused from `./ui-runtime/*` (see those files' doc comments) rather
 * than rebuilt here; this file only sequences them and records results.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/perf/ui-runtime.spec.ts --reporter=list
 * Or, to build + run + emit the report in one step:
 *   npm run perf:ui-runtime
 * On headless Linux (no real display), wrap with xvfb-run per PERFORMANCE.md §1:
 *   xvfb-run -a npm run perf:ui-runtime
 *
 * IMPORTANT — this is a MEASUREMENT harness, not a regression gate. Per
 * SKY-8217's scope, a metric missing its PERFORMANCE.md target gets a
 * separate scoped follow-up issue, not a red build here (real UI-runtime
 * numbers depend on host GPU/CPU and are far noisier under headless
 * Xvfb/CI than the repo's existing byte-count-based perf guards, e.g.
 * scene-save-perf.spec.ts). Every `expect()` below is a SANITY check that
 * the measurement pipeline produced a real signal (non-empty samples, a
 * finite number, etc.) — never a check against the target itself. Pass/fail
 * against target is recorded in `plans/PERF_UI_RUNTIME_BASELINE.json` and the
 * printed table for a human (or a follow-up issue) to act on.
 */
import fs from 'fs';
import path from 'path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchApp,
  firstWindow,
  openSeededScene,
  seedUserData,
  seedVault,
  makeScratch,
  rmScratch,
  type Scratch,
} from './ui-runtime/launch';
import { measureKeystrokeToPaint } from './ui-runtime/keystrokePaint';
import { measureIdleCpu } from './ui-runtime/idleCpu';
import { sampleFrameDeltas, summarizeFrames } from './ui-runtime/animationFps';
import {
  installMockChatStream,
  openWritingCoachChat,
  sendPromptAndWaitForStreamStart,
} from './ui-runtime/streamingFrames';
import { writeMetricResult, printReportTable } from './ui-runtime/report';

// PERFORMANCE.md §0 acceptance targets, transcribed verbatim in each
// constant's comment so a reviewer can diff this file against that doc.

/** "Keystroke → paint under 16 ms with all panels open." — checked at p95 across N reps. */
const KEYSTROKE_P95_TARGET_MS = 16;

/**
 * "Idle CPU ~0%, GPU steady, no repaints while nothing moves." "~0%" isn't a
 * literal 0 — a genuinely idle Electron/Chromium process still burns a
 * fraction of a percent on compositor/GC housekeeping even with nothing
 * moving. 1% is the threshold this harness treats as "effectively idle";
 * anything higher means something is polling/repainting that shouldn't be.
 */
const IDLE_CPU_TARGET_PCT = 1;

/**
 * "All ambient animation at 60fps." Sampled fps on a real compositor jitters
 * a little frame-to-frame even when nothing is wrong, so the pass bar is the
 * p5-floor (see FrameStats.p95Fps doc in animationFps.ts) at 95% of 60fps —
 * i.e. at least 95% of sampled frames ran at 57fps or better.
 */
const AMBIENT_FPS_FLOOR_TARGET = 57;

/**
 * "Typing with Writing Assistant + watcher live: no dropped frames." Read
 * literally this is 0% — but some ambient jitter is unavoidable even at
 * idle (see AMBIENT_FPS_FLOOR_TARGET's note), so the bar this harness holds
 * the streaming window to is: dropped-frame rate must not exceed the same
 * run's own idle baseline by more than this many percentage points. That
 * isolates "does live streaming specifically cause drops" from "does this
 * host ever drop an ambient frame," which the streaming number alone can't
 * distinguish.
 */
const STREAMING_DROP_TOLERANCE_PCT = 5;

test.afterAll(() => {
  printReportTable();
});

test.describe('SKY-8217 metric 1 — keystroke-to-paint main-thread time', () => {
  let scratch: Scratch;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    scratch = makeScratch('ui-perf-keystroke');
    seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
    seedVault(scratch.vaultDir);
    app = await launchApp(scratch.userData, { reducedMotion: true });
    page = await firstWindow(app);
    await openSeededScene(page);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmScratch(scratch);
  });

  test('p95 main-thread time per keystroke', async () => {
    const result = await measureKeystrokeToPaint(page, 20);
    const pass = result.p95 < KEYSTROKE_P95_TARGET_MS;
    // eslint-disable-next-line no-console
    console.log(
      `[SKY-8217 perf] keystroke-to-paint: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms ` +
        `(target p95 < ${KEYSTROKE_P95_TARGET_MS}ms) — ${pass ? 'PASS' : 'FAIL'}`,
    );
    writeMetricResult('keystroke_to_paint_p95_ms', {
      value: result.p95,
      unit: 'ms',
      target: KEYSTROKE_P95_TARGET_MS,
      targetDescription: `PERFORMANCE.md §0: keystroke -> paint under ${KEYSTROKE_P95_TARGET_MS}ms (p95, n=${result.samples.length})`,
      pass,
      detail: { p50: result.p50, samples: result.samples },
    });

    expect(result.samples.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.p95)).toBe(true);
  });
});

test.describe('SKY-8217 metric 2 — idle CPU', () => {
  let scratch: Scratch;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    scratch = makeScratch('ui-perf-idle-cpu');
    seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
    seedVault(scratch.vaultDir);
    app = await launchApp(scratch.userData, { reducedMotion: true });
    page = await firstWindow(app);
    await openSeededScene(page);
    // Let post-navigation layout/paint work settle before sampling idle CPU —
    // otherwise the window is measuring scene-open cost, not idle cost.
    await page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmScratch(scratch);
  });

  test('main + renderer CPU over a 5s idle window', async () => {
    if (process.platform !== 'linux') {
      test.skip(true, 'idleCpu.ts only supports Linux /proc sampling');
      return;
    }
    const result = await measureIdleCpu(app!, 5000);
    const pass = result.totalCpuPct <= IDLE_CPU_TARGET_PCT;
    // eslint-disable-next-line no-console
    console.log(
      `[SKY-8217 perf] idle CPU: main=${result.mainCpuPct.toFixed(2)}% renderer=${result.rendererCpuPct.toFixed(2)}% ` +
        `total=${result.totalCpuPct.toFixed(2)}% (target <= ${IDLE_CPU_TARGET_PCT}%) — ${pass ? 'PASS' : 'FAIL'}`,
    );
    writeMetricResult('idle_cpu_pct', {
      value: result.totalCpuPct,
      unit: '% CPU',
      target: IDLE_CPU_TARGET_PCT,
      targetDescription: `PERFORMANCE.md §0: idle CPU ~0% (harness pass bar: total <= ${IDLE_CPU_TARGET_PCT}% over a ${result.windowMs}ms window)`,
      pass,
      detail: { mainCpuPct: result.mainCpuPct, rendererCpuPct: result.rendererCpuPct, windowMs: result.windowMs },
    });

    expect(Number.isFinite(result.totalCpuPct)).toBe(true);
    expect(result.totalCpuPct).toBeGreaterThanOrEqual(0);
  });
});

test.describe('SKY-8217 metric 3 — ambient animation fps', () => {
  let scratch: Scratch;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    scratch = makeScratch('ui-perf-ambient-fps');
    seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
    seedVault(scratch.vaultDir);
    // Metric 3 is the one launch that must NOT force reduced motion — see
    // animationFps.ts's doc comment for why reduced motion would make this
    // measure "nothing is animating" instead of the real ambient layer.
    app = await launchApp(scratch.userData, { reducedMotion: false });
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmScratch(scratch);
  });

  test('ambient wallpaper animation frame rate', async () => {
    const deltas = await sampleFrameDeltas(page, 3000);
    const stats = summarizeFrames(deltas);
    const pass = stats.p95Fps >= AMBIENT_FPS_FLOOR_TARGET;
    // eslint-disable-next-line no-console
    console.log(
      `[SKY-8217 perf] ambient fps: avg=${stats.avgFps.toFixed(1)} p50=${stats.p50Fps.toFixed(1)} ` +
        `floor(p5)=${stats.p95Fps.toFixed(1)} dropped=${stats.droppedFramePct.toFixed(1)}% ` +
        `(target floor >= ${AMBIENT_FPS_FLOOR_TARGET}fps) — ${pass ? 'PASS' : 'FAIL'}`,
    );
    writeMetricResult('ambient_animation_fps_floor', {
      value: stats.p95Fps,
      unit: 'fps',
      target: AMBIENT_FPS_FLOOR_TARGET,
      targetDescription: `PERFORMANCE.md §0: ambient animation at 60fps (harness pass bar: 95%-of-frames floor >= ${AMBIENT_FPS_FLOOR_TARGET}fps, n=${stats.sampleCount})`,
      pass,
      detail: { avgFps: stats.avgFps, p50Fps: stats.p50Fps, droppedFramePct: stats.droppedFramePct },
    });

    expect(stats.sampleCount).toBeGreaterThan(0);
    expect(Number.isFinite(stats.avgFps)).toBe(true);
  });
});

test.describe('SKY-8217 metric 4 — dropped frames with agents live', () => {
  let scratch: Scratch;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    scratch = makeScratch('ui-perf-streaming-fps');
    // agentsEnabled: true — the Writing Coach chat surface this metric
    // exercises is gated behind the writingAssistant agent being enabled.
    seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir, { agentsEnabled: true });
    seedVault(scratch.vaultDir);
    app = await launchApp(scratch.userData, { reducedMotion: false });
    page = await firstWindow(app);
    await openSeededScene(page);
    await openWritingCoachChat(page);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmScratch(scratch);
  });

  test('frame rate during a live streaming chat response vs. idle baseline', async () => {
    const idleDeltas = await sampleFrameDeltas(page, 2000);
    const idleStats = summarizeFrames(idleDeltas);

    await installMockChatStream(app!, { tokenCount: 30, chatDelayMs: 100 });
    await sendPromptAndWaitForStreamStart(page, 'Give me feedback on this scene.');

    const streamingDeltas = await sampleFrameDeltas(page, 2500);
    const streamingStats = summarizeFrames(streamingDeltas);

    const dropDelta = streamingStats.droppedFramePct - idleStats.droppedFramePct;
    const pass = dropDelta <= STREAMING_DROP_TOLERANCE_PCT;
    // eslint-disable-next-line no-console
    console.log(
      `[SKY-8217 perf] streaming fps: idle dropped=${idleStats.droppedFramePct.toFixed(1)}% ` +
        `streaming dropped=${streamingStats.droppedFramePct.toFixed(1)}% delta=${dropDelta.toFixed(1)}pp ` +
        `(target delta <= ${STREAMING_DROP_TOLERANCE_PCT}pp) — ${pass ? 'PASS' : 'FAIL'}`,
    );
    writeMetricResult('streaming_dropped_frame_delta_pp', {
      value: dropDelta,
      unit: 'percentage points',
      target: STREAMING_DROP_TOLERANCE_PCT,
      targetDescription: `PERFORMANCE.md §0: no dropped frames with agents live (harness pass bar: streaming dropped-frame rate no more than ${STREAMING_DROP_TOLERANCE_PCT}pp above this run's own idle baseline)`,
      pass,
      detail: {
        idleDroppedFramePct: idleStats.droppedFramePct,
        streamingDroppedFramePct: streamingStats.droppedFramePct,
        idleAvgFps: idleStats.avgFps,
        streamingAvgFps: streamingStats.avgFps,
      },
    });

    expect(streamingStats.sampleCount).toBeGreaterThan(0);
    expect(Number.isFinite(dropDelta)).toBe(true);
  });
});

test('report file was written', () => {
  const reportPath = path.resolve(__dirname, '../../plans/PERF_UI_RUNTIME_BASELINE.json');
  expect(fs.existsSync(reportPath)).toBe(true);
});
