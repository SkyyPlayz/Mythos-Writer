/**
 * keystrokePaint.ts — SKY-8217 metric 1: keystroke-to-paint main-thread time.
 *
 * Opens a CDP `Tracing` session on the real renderer page (the same
 * per-target session Puppeteer's own `page.tracing` API uses under the
 * hood), types real characters into the real ProseMirror editor via
 * `page.keyboard.type` (never `window.api` — this measures actual input
 * handling, not IPC), and sums the `RunTask` scheduler-task durations that
 * fall inside each keystroke's [performance.mark start, performance.mark
 * end-after-2-rAFs] window. That sum is the renderer main-thread time spent
 * between the keystroke and the next composited frame — the same "main
 * thread time per keystroke" DevTools' Performance panel reports, per
 * PERFORMANCE.md §0.
 */
import type { CDPSession, Page } from '@playwright/test';

const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
];

interface TraceEvent {
  cat?: string;
  name?: string;
  ts?: number;
  dur?: number;
}

export interface KeystrokeToPaintResult {
  /** Main-thread-busy ms per rep, in rep order. */
  samples: number[];
  p50: number;
  p95: number;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Caller must have already navigated to the editor and focused `.ProseMirror`
 * (see `openSeededScene` in launch.ts) — this only drives the keystrokes.
 */
export async function measureKeystrokeToPaint(page: Page, reps = 20): Promise<KeystrokeToPaintResult> {
  const client: CDPSession = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  client.on('Tracing.dataCollected', (params) => {
    events.push(...(params as { value: TraceEvent[] }).value);
  });
  const tracingComplete = new Promise<void>((resolve) => {
    client.once('Tracing.tracingComplete', () => resolve());
  });

  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: TRACE_CATEGORIES,
    },
  } as never);
  // Let the ring buffer settle before the first keystroke.
  await page.waitForTimeout(50);

  for (let i = 0; i < reps; i++) {
    await page.evaluate((n) => performance.mark(`sky8217-key-${n}-start`), i);
    await page.keyboard.type('x', { delay: 0 });
    // Two rAFs guarantee a compositor frame was actually produced for this
    // character before we mark "end" — one rAF only proves the callback for
    // *this* frame ran, not that the resulting paint was submitted.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await page.evaluate((n) => performance.mark(`sky8217-key-${n}-end`), i);
  }

  await client.send('Tracing.end');
  await tracingComplete;
  await client.detach().catch(() => undefined);

  const markTs = new Map<string, number>();
  for (const e of events) {
    if (e.name?.startsWith('sky8217-key-') && typeof e.ts === 'number') {
      markTs.set(e.name, e.ts);
    }
  }
  const tasks = events.filter(
    (e): e is Required<Pick<TraceEvent, 'ts' | 'dur'>> & TraceEvent =>
      e.name === 'RunTask' && typeof e.ts === 'number' && typeof e.dur === 'number',
  );
  if (tasks.length === 0) {
    throw new Error(
      'SKY-8217: CDP trace captured zero RunTask events — the trace pipeline is broken ' +
        '(wrong categories, detached session, or Electron/Chromium renamed the scheduler task ' +
        "event), not that the main thread did no work. Don't trust a silent 0ms result.",
    );
  }

  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    const start = markTs.get(`sky8217-key-${i}-start`);
    const end = markTs.get(`sky8217-key-${i}-end`);
    if (start === undefined || end === undefined) continue;
    let busyUs = 0;
    for (const t of tasks) {
      const tStart = t.ts;
      const tEnd = tStart + t.dur;
      const overlapStart = Math.max(tStart, start);
      const overlapEnd = Math.min(tEnd, end);
      if (overlapEnd > overlapStart) busyUs += overlapEnd - overlapStart;
    }
    samples.push(busyUs / 1000); // trace ts/dur are microseconds
  }
  if (samples.length < reps * 0.5) {
    throw new Error(
      `SKY-8217: only correlated ${samples.length}/${reps} keystroke marks from the trace — ` +
        'performance.mark events are missing from the capture.',
    );
  }

  return { samples, p50: percentile(samples, 50), p95: percentile(samples, 95) };
}
