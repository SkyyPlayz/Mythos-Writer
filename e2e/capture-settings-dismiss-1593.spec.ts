/**
 * Minimal Settings dismiss evidence for PR #1593 screenshot-check.
 * Run: xvfb-run -a npx playwright test e2e/capture-settings-dismiss-1593.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/settings-1593');

test('capture Settings open (dismiss X visible)', async () => {
  test.setTimeout(90_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-settings-1593-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story');
  const notesDir = path.join(tempRoot, 'notes');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({ onboardingComplete: true, theme: 'dark' }));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Close settings')).toBeVisible();
    const openPath = path.join(OUT_DIR, 'settings-open-with-x.png');
    await page.screenshot({ path: openPath, fullPage: false });
    fs.copyFileSync(openPath, '/opt/cursor/artifacts/settings-1593-open-with-x.png');

    await page.getByLabel('Close settings').click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0, { timeout: 5_000 });
    const closedPath = path.join(OUT_DIR, 'settings-dismissed.png');
    await page.screenshot({ path: closedPath, fullPage: false });
    fs.copyFileSync(closedPath, '/opt/cursor/artifacts/settings-1593-dismissed.png');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
