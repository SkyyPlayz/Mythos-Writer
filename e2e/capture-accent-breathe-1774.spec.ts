/**
 * capture-accent-breathe-1774.spec.ts — #1774 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of Accent
 * breathe: the new Settings → Appearance → Motion card, and the app chrome at
 * phase 0 (the static theme colors) vs 8 s later (one full hop: every glow and
 * border slot has drifted to the next theme color). Not registered in
 * package.json/CI — run manually:
 *   npm run build:electron
 *   npx playwright test e2e/capture-accent-breathe-1774.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/accent-breathe-1774');

test('capture Motion card + accent breathe phase 0 vs 8 s', async () => {
  test.setTimeout(90_000);
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
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  // Keep-alive so the 5 s idle pause doesn't freeze the drift mid-capture.
  await page.evaluate(() => {
    window.setInterval(() => window.dispatchEvent(new PointerEvent('pointermove')), 1000);
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.locator('button[aria-label*="ettings"], button:has-text("Settings")').first().click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('.settings-cat-nav [role="tab"]', { hasText: 'Appearance' }).click();
  const toggle = dialog.locator('[data-testid="lnas-accentbreathe"]');
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  const card = dialog.locator('.lnas-card', { hasText: 'Accent breathe' });
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(OUT_DIR, 'motion-card.png') });

  // Off → on restarts the loop at phase 0 (the static theme), so the two
  // full-window shots are exactly 0 s and 8 s (one hop) into the loop.
  await toggle.click();
  await expect(page.locator('html[data-ln-breathe="off"]')).toHaveCount(1, { timeout: 3_000 });
  await toggle.click();
  await expect(page.locator('html[data-ln-breathe="running"]')).toHaveCount(1, { timeout: 3_000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'glow-phase-0.png') });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: path.join(OUT_DIR, 'glow-phase-8s.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
