/**
 * accent-breathe.spec.ts — #1774 Accent breathe
 *
 * Real e2e for the slow ambient drift of the Liquid Neon glow/border tokens
 * (driver: frontend/src/theme/accentBreathe.ts, wired through
 * applyLiquidNeonV2Tokens; toggle: Settings → Appearance → Motion →
 * "Accent breathe", LiquidNeonAppearanceSection.tsx). The profile is a fresh
 * temp user-data dir with onboarding marked complete and an empty temp vault
 * configured; nothing about the appearance is pre-seeded (no liquidNeonV2), so
 * "on by default" is the real fresh-profile state. The toggle is reached by
 * clicks only, and the app is launched WITHOUT --force-prefers-reduced-motion
 * (the driver reads the real matchMedia).
 *
 *   1. Fresh profile: Motion card visible, switch on, html[data-ln-breathe]
 *      running, --b1 drifts while --n1 stays the static slot color.
 *   2. Hidden window (BackgroundStack's ln-anim-paused path): paused, --b1
 *      frozen; visible again → running and drifting.
 *   3. prefers-reduced-motion (emulated, live): off, static --b1; back → running.
 *   4. Toggle off persists globally and per vault and survives a relaunch.
 *   5. The preset export file has no accentBreathe key.
 *   6. Ticks start no transitions of their own and never cut or skip a user
 *      transition (one running across a tick, one still pending at a tick).
 *   7. Perf: ON vs OFF in the same run against a populated DOM (a documented
 *      N-element proxy) — rAF frame deltas (animationFps.ts) plus CDP
 *      RecalcStyleDuration / LayoutCount, each mode judged by the better of two
 *      sequential 4 s windows; a tick's style work must stay within 2× (a
 *      coarse guard) of one plain root-token change measured in the same run.
 *
 * The app's 5 s idle pause would also freeze breathe, so each window gets a
 * synthetic pointermove keep-alive every second.
 *
 * No IPC mocks. Run (after `npm run build:electron`):
 *   npx playwright test e2e/accent-breathe.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { sampleFrameDeltas, summarizeFrames, type FrameStats } from './perf/ui-runtime/animationFps';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
/** Static classic slot-1 border at default intensity: hexA('#00f0ff', 1.1). */
const STATIC_B1 = 'rgba(0,240,255,1.000)';
/** ACCENT_BREATHE_TICK_MS (frontend/src/theme/accentBreathe.ts). */
const TICK_MS = 250;
/**
 * Coarse guard: max ratio of a tick's extra style work to one plain (unconsumed)
 * root custom-property change on the same populated DOM, measured in the same
 * run, so it holds on slower CI runners where an absolute ms budget would not.
 * A tick measured 1.03–1.57× under xvfb over a single window (it also
 * recomputes the consumers' colors), with one 1.96× GC-spike outlier in ~14
 * runs — hence the best-of-two windows; the retired global transition override
 * measured ~2.7× (23 ms/tick vs ~8.5 ms). Smaller costs are logged for review,
 * not asserted — the metric is too noisy for a tighter bound; test 6 pins the
 * transition side exactly.
 */
const PER_TICK_RECALC_RATIO_MAX = 2;

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  // Keep-alive: the 5 s idle pause (BackgroundStack) would otherwise freeze breathe.
  await pg.evaluate(() => {
    (window as unknown as { __ka: number }).__ka = window.setInterval(
      () => window.dispatchEvent(new PointerEvent('pointermove')), 1000,
    );
  });
  return pg;
}

async function openAppearance(page: Page) {
  await page.locator('button[aria-label*="ettings"], button:has-text("Settings")').first().click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const appearanceTab = dialog.locator('.settings-cat-nav [role="tab"]', { hasText: 'Appearance' });
  await expect(appearanceTab).toBeVisible({ timeout: 3_000 });
  await appearanceTab.click();
  await expect(dialog.locator('[data-testid="lnas-accentbreathe"]')).toBeVisible({ timeout: 5_000 });
  return dialog;
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toHaveCount(0, { timeout: 5_000 });
}

const readB1 = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--b1'));
const readN1 = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--n1'));
const readState = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-ln-breathe'));

/** Reads --b1 every `everyMs` for `ms` and returns the distinct values seen. */
async function distinctB1Over(page: Page, ms: number, everyMs = 250): Promise<string[]> {
  return page.evaluate(([duration, every]) => new Promise<string[]>((resolve) => {
    const seen = new Set<string>([document.documentElement.style.getPropertyValue('--b1')]);
    const id = window.setInterval(() => seen.add(document.documentElement.style.getPropertyValue('--b1')), every);
    window.setTimeout(() => { window.clearInterval(id); resolve([...seen]); }, duration);
  }), [ms, everyMs] as const);
}

async function setVisibility(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    if (h) Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    else delete (document as unknown as Record<string, unknown>).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

interface StoredLn { accentBreathe?: boolean }
interface StoredSettings {
  liquidNeonV2?: StoredLn;
  vaultAppearance?: Record<string, { liquidNeonV2?: StoredLn }>;
}

function readStored(userData: string): StoredSettings {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as StoredSettings;
}

let app: ElectronApplication;
let page: Page;
let userData: string;
let vaultDir: string;
let notesVaultDir: string;

test.describe.serial('#1774 Accent breathe', () => {
  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-breathe-user-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-breathe-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-breathe-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    for (const dir of [userData, vaultDir, notesVaultDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fresh profile: Appearance > Motion > Accent breathe is on and drifts the border tokens', async () => {
    const dialog = await openAppearance(page);
    await expect(dialog.locator('.lnas-card', { hasText: 'Accent breathe' }).locator('> div').first()).toHaveText('Motion');
    const toggle = dialog.locator('[data-testid="lnas-accentbreathe"]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html[data-ln-breathe="running"]')).toHaveCount(1, { timeout: 5_000 });
    const first = await readB1(page);
    await expect.poll(() => readB1(page), { timeout: 3_000 }).not.toBe(first);
    expect(await readN1(page)).toBe('#00f0ff');
  });

  test('hidden window freezes the blend', async () => {
    await setVisibility(page, true);
    await expect(page.locator('html.ln-anim-paused')).toHaveCount(1, { timeout: 3_000 });
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('paused');
    expect(await distinctB1Over(page, 2000)).toHaveLength(1);

    await setVisibility(page, false);
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('running');
    const resumed = await readB1(page);
    await expect.poll(() => readB1(page), { timeout: 3_000 }).not.toBe(resumed);
  });

  test('prefers-reduced-motion turns it off live', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('off');
    expect(await readB1(page)).toBe(STATIC_B1);
    expect(await distinctB1Over(page, 2000)).toEqual([STATIC_B1]);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('running');
    await expect.poll(() => readB1(page), { timeout: 3_000 }).not.toBe(STATIC_B1);
  });

  test('turning it off persists globally and per vault and survives relaunch', async () => {
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    const toggle = dialog.locator('[data-testid="lnas-accentbreathe"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('off');
    expect(await readB1(page)).toBe(STATIC_B1);
    await expect.poll(() => {
      const s = readStored(userData);
      return s.liquidNeonV2?.accentBreathe === false && s.vaultAppearance?.[vaultDir]?.liquidNeonV2?.accentBreathe === false;
    }, { timeout: 10_000 }).toBe(true);

    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect.poll(() => readState(page), { timeout: 10_000 }).toBe('off');
    const dialog2 = await openAppearance(page);
    const toggle2 = dialog2.locator('[data-testid="lnas-accentbreathe"]');
    await expect(toggle2).toHaveAttribute('aria-checked', 'false');
    expect(await distinctB1Over(page, 1000)).toEqual([STATIC_B1]);

    await toggle2.click();
    await expect(toggle2).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('running');
    await expect.poll(() => {
      const s = readStored(userData);
      return s.liquidNeonV2?.accentBreathe === true && s.vaultAppearance?.[vaultDir]?.liquidNeonV2?.accentBreathe === true;
    }, { timeout: 10_000 }).toBe(true);
  });

  test('the preset export omits Accent breathe', async () => {
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    // Electron routes anchor-click blob downloads through session.will-download
    // (see theme-export-import.spec.ts for why this is hooked directly).
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-breathe-download-'));
    await app.evaluate(({ session }, dir) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(`${dir}/${item.getFilename()}`);
      });
    }, downloadDir);
    await dialog.locator('[data-testid="lnas-export"]').click();
    const exportedPath = path.join(downloadDir, 'mythos-theme-preset.json');
    await expect.poll(() => fs.existsSync(exportedPath) && fs.readFileSync(exportedPath, 'utf-8').length > 0, { timeout: 10_000 }).toBe(true);
    const json = JSON.parse(fs.readFileSync(exportedPath, 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['ambMode', 'frameAnim', 'setKey', 'slots', 'wp']);
    expect(json).not.toHaveProperty('accentBreathe');
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  test('ticks start no transitions and never cut or skip a user transition', async () => {
    // Settings is still open: its NeonToggles (`transition: all .2s`) and cards
    // read the breathing tokens, so a tick that let its own color step
    // transition would fire transitionrun here every 250 ms.
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('running');
    const runs = await page.evaluate(() => new Promise<number>((resolve) => {
      let n = 0;
      const on = () => { n++; };
      document.addEventListener('transitionrun', on, true);
      window.setTimeout(() => { document.removeEventListener('transitionrun', on, true); resolve(n); }, 2000);
    }));
    expect(runs).toBe(0);

    // Hold the driver (hidden window → paused), then resume it in the same task
    // that schedules B: B's timer is registered first with the same delay as
    // the restarted tick interval, so B's style change is still pending (no
    // frame in between) when the first tick runs.
    // A: a 1 s user transition already running when the tick lands keeps running.
    // B: a change made just before the tick still starts its transition.
    // The wait ends only when --b1 itself changes (resume re-writes the paused
    // phase, which changes nothing), and a page-side sequence number orders B's
    // change before that write. Every adjacent classic slot pair differs by
    // ≥ 32 in some channel (≥ 1 per tick of a 32-tick hop), so the first tick
    // after resume always changes --b1.
    await setVisibility(page, true);
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('paused');
    const after = await page.evaluate((tickMs) => new Promise<{ a: string[]; b: string[]; bSeq: number; tickSeq: number }>((resolve) => {
      const root = document.documentElement;
      let seq = 0;
      let bSeq = 0;
      let settled = false;
      const mk = () => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;border:2px solid var(--b1);' +
          'transition:opacity 1s linear,border-color 1s linear;';
        document.body.appendChild(d);
        void getComputedStyle(d).opacity;
        return d;
      };
      const change = (d: HTMLElement) => { d.style.opacity = '0'; d.style.borderColor = 'var(--b4)'; };
      const running = (d: HTMLElement) => d.getAnimations()
        .filter((x) => 'transitionProperty' in x && x.playState === 'running')
        .map((x) => (x as CSSTransition).transitionProperty).sort();
      const a = mk(), b = mk();
      const done = (tickSeq: number) => {
        if (settled) return;
        settled = true;
        mo.disconnect();
        window.clearTimeout(giveUp);
        const out = { a: running(a), b: running(b), bSeq, tickSeq };
        a.remove(); b.remove();
        resolve(out);
      };
      const b1Paused = root.style.getPropertyValue('--b1');
      const mo = new MutationObserver(() => {
        if (root.style.getPropertyValue('--b1') !== b1Paused) done(++seq);
      });
      change(a);
      void a.getAnimations();
      window.setTimeout(() => { change(b); bSeq = ++seq; }, tickMs);
      mo.observe(root, { attributes: true, attributeFilter: ['style'] });
      delete (document as unknown as Record<string, unknown>).visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
      const giveUp = window.setTimeout(() => done(0), 3000);
    }), TICK_MS);
    // A tick really wrote --b1, and B's change ran before it.
    expect(after.tickSeq).toBeGreaterThan(0);
    expect(after.bSeq).toBeGreaterThan(0);
    expect(after.bSeq).toBeLessThan(after.tickSeq);
    expect(after.a).toEqual(expect.arrayContaining(['border-top-color', 'opacity']));
    expect(after.b).toEqual(expect.arrayContaining(['border-top-color', 'opacity']));
    expect(await readState(page)).toBe('running');
  });

  test('perf: Accent breathe holds frame rate (ON vs OFF, same run)', async () => {
    test.setTimeout(90_000);
    type Metrics = Record<string, number>;
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metrics = async (): Promise<Metrics> => {
      const { metrics: list } = await client.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
      return Object.fromEntries(list.map((m) => [m.name, m.value]));
    };
    const measure = async () => {
      const before = await metrics();
      const sampler = distinctB1Over(page, 4000, 100);
      const stats = summarizeFrames(await sampleFrameDeltas(page, 4000));
      const distinct = await sampler;
      const after = await metrics();
      return {
        stats,
        distinct: distinct.length,
        recalcStyleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        recalcStyleCount: after.RecalcStyleCount - before.RecalcStyleCount,
        layoutCount: after.LayoutCount - before.LayoutCount,
      };
    };
    // A second sample in the same mode: each mode is judged by its better
    // window (frames and style work alike), so a one-off stall (GC,
    // compositor) in a single 4 s window can't decide the result; a per-tick
    // cost shows up in both.
    const best = (a: FrameStats, b: FrameStats) => ({
      droppedFramePct: Math.min(a.droppedFramePct, b.droppedFramePct),
      p95Fps: Math.max(a.p95Fps, b.p95Fps),
    });
    const fmt = (s: FrameStats) =>
      `avg=${s.avgFps.toFixed(1)} p50=${s.p50Fps.toFixed(1)} floor(p5)=${s.p95Fps.toFixed(1)} ` +
      `dropped=${s.droppedFramePct.toFixed(1)}% n=${s.sampleCount}`;

    // Populated-DOM proxy for a real project (a long outline, a vault browser
    // plus the editor, a busy board): PROXY_N extra class-styled elements, one
    // in a hundred a glow/border token consumer with the `transition: all` the
    // app's own consumers use. Present for both ON and OFF.
    const PROXY_N = 3000;
    const addProxy = () => page.evaluate((n) => {
      const css = document.createElement('style');
      css.id = 'breathe-perf-proxy-css';
      css.textContent =
        '#breathe-perf-proxy{position:fixed;left:0;top:0;width:320px;height:240px;overflow:hidden;pointer-events:none}' +
        '#breathe-perf-proxy i{display:inline-block;width:2px;height:6px}' +
        '#breathe-perf-proxy b{display:inline-block;width:12px;height:6px;border:1px solid var(--b1);' +
        'box-shadow:0 0 6px var(--g2);transition:all .2s}';
      document.head.appendChild(css);
      const root = document.createElement('div');
      root.id = 'breathe-perf-proxy';
      for (let i = 0; i < n; i++) root.appendChild(document.createElement(i % 100 === 0 ? 'b' : 'i'));
      document.body.appendChild(root);
    }, PROXY_N);
    const removeProxy = () => page.evaluate(() => {
      document.getElementById('breathe-perf-proxy')?.remove();
      document.getElementById('breathe-perf-proxy-css')?.remove();
    });

    // ON (the state test 4 left it in).
    await closeSettings(page);
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('running');
    await addProxy();
    const on = await measure();
    const on2 = await measure();
    await removeProxy();

    // OFF, through the UI.
    const dialog = await openAppearance(page);
    await dialog.locator('[data-testid="lnas-accentbreathe"]').click();
    await expect(dialog.locator('[data-testid="lnas-accentbreathe"]')).toHaveAttribute('aria-checked', 'false');
    await closeSettings(page);
    await expect.poll(() => readState(page), { timeout: 3_000 }).toBe('off');
    await addProxy();
    const off = await measure();
    const off2 = await measure();
    // Baseline, still OFF with the proxy: the cost of one root custom-property
    // change at the tick rate, flushed the way the driver flushes its write.
    await page.evaluate((tickMs) => {
      const w = window as unknown as { __probe?: ReturnType<typeof setInterval> };
      let n = 0;
      w.__probe = setInterval(() => {
        document.getAnimations();
        document.documentElement.style.setProperty('--breathe-perf-probe', String(++n));
        document.getAnimations();
      }, tickMs);
    }, TICK_MS);
    const probe = await measure();
    await page.evaluate(() => {
      const w = window as unknown as { __probe?: ReturnType<typeof setInterval> };
      clearInterval(w.__probe);
      document.documentElement.style.removeProperty('--breathe-perf-probe');
    });
    await removeProxy();
    await client.detach().catch(() => {});
    const ticks = 4000 / TICK_MS;
    const onRecalcMs = Math.min(on.recalcStyleMs, on2.recalcStyleMs);
    const offRecalcMs = Math.min(off.recalcStyleMs, off2.recalcStyleMs);
    const perTickRecalcMs = (onRecalcMs - offRecalcMs) / ticks;
    const perChangeRecalcMs = (probe.recalcStyleMs - offRecalcMs) / ticks;

    // eslint-disable-next-line no-console
    console.log(
      `[#1774 perf] ON  ${fmt(on.stats)} | 2nd ${fmt(on2.stats)} distinct--b1=${on.distinct}/${on2.distinct} ` +
        `RecalcStyle=${on.recalcStyleMs.toFixed(1)}/${on2.recalcStyleMs.toFixed(1)}ms Layout=${on.layoutCount}\n` +
        `[#1774 perf] OFF ${fmt(off.stats)} | 2nd ${fmt(off2.stats)} distinct--b1=${off.distinct}/${off2.distinct} ` +
        `RecalcStyle=${off.recalcStyleMs.toFixed(1)}/${off2.recalcStyleMs.toFixed(1)}ms Layout=${off.layoutCount}\n` +
        `[#1774 perf] delta RecalcStyle=${(onRecalcMs - offRecalcMs).toFixed(1)}ms (best windows) ` +
        `(${perTickRecalcMs.toFixed(2)}ms/tick over ${ticks} ticks, +${PROXY_N} proxy elements) ` +
        `Layout=${on.layoutCount - off.layoutCount}\n` +
        `[#1774 perf] baseline one root-token change=${perChangeRecalcMs.toFixed(2)}ms ` +
        `ratio=${(perTickRecalcMs / perChangeRecalcMs).toFixed(2)} (max ${PER_TICK_RECALC_RATIO_MAX})`,
    );

    // The ON sample really breathed; the OFF sample really didn't.
    expect(on.distinct).toBeGreaterThanOrEqual(10);
    expect(on2.distinct).toBeGreaterThanOrEqual(10);
    expect(off.distinct).toBe(1);
    expect(off2.distinct).toBe(1);
    // Best ON window within 2 points of the best OFF window. One point is ~2.4
    // of the ~240 frames in 4 s, so +2 is ~4.8 frames over OFF: about one frame
    // of headroom over the worst single ON window measured (local 1.7% = 4
    // frames). ON and OFF are separate, sequential windows (a Settings round
    // trip between them), so runner jank in only one of them does NOT cancel
    // out; the best-of-2 per mode above is what absorbs a one-off stall, and
    // being relative to OFF is what absorbs a uniformly slow runner. Measured:
    // CI shard-1 ON 0.8% / OFF 0.0%; local ON 0.0–1.7% / OFF 0.0–0.8%. The
    // pre-fix per-tick transition restarts measured 5–9% ON vs 0% OFF in every
    // window, which this fails.
    const onBest = best(on.stats, on2.stats);
    const offBest = best(off.stats, off2.stats);
    expect(onBest.droppedFramePct).toBeLessThanOrEqual(offBest.droppedFramePct + 2);
    expect(onBest.p95Fps).toBeGreaterThanOrEqual(offBest.p95Fps - 3);
    // A tick costs about one root-token change: no extra whole-tree recalc.
    expect(perChangeRecalcMs).toBeGreaterThan(0);
    expect(perTickRecalcMs).toBeLessThanOrEqual(perChangeRecalcMs * PER_TICK_RECALC_RATIO_MAX);
  });
});
