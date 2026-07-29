/**
 * capture-idle-cpu-fix-sky8566.spec.ts — SKY-8629 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the
 * SKY-8566 idle-CPU fix (PR #1133): WorkspaceTabBar's agents dot and the
 * BackgroundStack ambient layers before and after the 5s idle-pause engages
 * (`html.ln-anim-paused`). Not registered in package.json/CI — run manually:
 *   npm run build:electron
 *   npx playwright test e2e/capture-idle-cpu-fix-sky8566.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/idle-cpu-fix-sky8566');

test('capture workspace tab bar + background stack active/idle-paused states', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('[data-testid="wtb-agents-chip"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="ln-bg-stack"]')).toBeVisible({ timeout: 8_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Active state — freshly loaded, well within the 5s idle window.
  //    html.ln-anim-paused must NOT be set yet.
  const pausedBeforeIdle = await page.evaluate(() => document.documentElement.classList.contains('ln-anim-paused'));
  expect(pausedBeforeIdle).toBe(false);
  await page.screenshot({ path: path.join(OUT_DIR, '1-active-workspace-tab-bar-and-background-stack.png') });

  // 2. Idle-paused state — SKY-8566 fix: after IDLE_PAUSE_MS (5s) of no
  //    pointer/keyboard/wheel activity, BackgroundStack.tsx adds
  //    html.ln-anim-paused, which pauses .ln-bg-wallpaper / .ln-bg-ambience /
  //    .ln-border-overlay and (WorkspaceTabBar.css) .wtb-agents-dot via
  //    `animation-play-state: paused`. The frame looks visually near-identical
  //    to (1) — this is a compositor tick fix, not a layout change — so the
  //    DOM assertion below is the real evidence; the screenshot documents the
  //    paused-state UI for the record.
  await page.waitForTimeout(6_000);
  const pausedAfterIdle = await page.evaluate(() => document.documentElement.classList.contains('ln-anim-paused'));
  expect(pausedAfterIdle).toBe(true);
  const dotAnimationPlayState = await page.evaluate(() => {
    const dot = document.querySelector('.wtb-agents-dot');
    return dot ? getComputedStyle(dot).animationPlayState : null;
  });
  expect(dotAnimationPlayState).toBe('paused');
  await page.screenshot({ path: path.join(OUT_DIR, '2-idle-paused-workspace-tab-bar-and-background-stack.png') });

  // 3. Resumes on activity — sanity check the pause is not a one-way trap.
  await page.mouse.move(100, 100);
  await page.mouse.move(200, 200);
  const pausedAfterActivity = await page.evaluate(() => document.documentElement.classList.contains('ln-anim-paused'));
  expect(pausedAfterActivity).toBe(false);
  await page.screenshot({ path: path.join(OUT_DIR, '3-resumed-after-activity.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
