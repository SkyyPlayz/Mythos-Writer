/**
 * Capture Settings denser --pop overlay glass for PR screenshot-check.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/overlay-pop-1600');
const ARTIFACTS = '/opt/cursor/artifacts';

test('capture Settings denser --pop glass', async () => {
  test.setTimeout(90_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pop-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story');
  const notesDir = path.join(tempRoot, 'notes');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      liquidNeonV2: { glassA: 20, blur: 1 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Open settings' }).first().click();
    await expect(page.locator('.settings-panel')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, 'settings-pop-denser-glass.png'),
      fullPage: false,
    });
    fs.copyFileSync(
      path.join(OUT_DIR, 'settings-pop-denser-glass.png'),
      path.join(ARTIFACTS, 'settings-pop-denser-glass.png'),
    );
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
