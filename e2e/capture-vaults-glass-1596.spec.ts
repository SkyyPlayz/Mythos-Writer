/**
 * Vaults & Files glass evidence for PR #1596 screenshot-check.
 * Run: xvfb-run -a npx playwright test e2e/capture-vaults-glass-1596.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/vaults-1596');

test('capture Settings → Vaults & Files glass panels', async () => {
  test.setTimeout(120_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vaults-1596-'));
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
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: /Vault/i }).click();
    await expect(page.locator('[data-settings-cat="vaults"]').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);

    const pagePath = path.join(OUT_DIR, 'vaults-files-glass.png');
    await page.screenshot({ path: pagePath, fullPage: false });
    fs.copyFileSync(pagePath, '/opt/cursor/artifacts/vaults-1596-files-glass.png');

    const section = page.locator('.settings-section[data-settings-cat="vaults"]').first();
    if (await section.count()) {
      const cardPath = path.join(OUT_DIR, 'vaults-section-card.png');
      await section.screenshot({ path: cardPath });
      fs.copyFileSync(cardPath, '/opt/cursor/artifacts/vaults-1596-section-card.png');
    }
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
