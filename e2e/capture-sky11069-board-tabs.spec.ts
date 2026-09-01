// SKY-11069 — PR evidence screenshots for the Scene Crafter board-tab model:
// the BOARDS gallery on the pinned Setup tab, and the tab strip with two
// boards open (canvas full-screen in the active tab).
// Not part of CI: run manually to refresh the images.
//   xvfb-run --auto-servernum npx playwright test e2e/capture-sky11069-board-tabs.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11069-board-tabs');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-11069 gallery + two-board tab strip screenshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-capture-sky11069-'));
  const userData = path.join(tempRoot, 'userData');
  seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator('.wc-menu', { hasText: 'File' }).click();
    await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();
    await clickStoryNav(page);
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.getByTestId('crafter-board-list')).toBeVisible({ timeout: 8_000 });

    // Two boards via the gallery's + New board card.
    const stripTab = page.locator('[role="tablist"][aria-label="Workspace tabs"] [role="tab"]');
    await page.getByTestId('crafter-new-board').click();
    await expect(page.locator('.sc-canvas-view [data-testid="canvas-board"]')).toBeVisible({ timeout: 8_000 });
    await stripTab.first().click();
    await expect(page.getByTestId('crafter-board-list')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('crafter-new-board').click();
    await expect(stripTab).toHaveCount(3);

    // Tab strip with two boards open, Board 2 active, canvas full-screen.
    await page.screenshot({ path: path.join(OUT_DIR, 'after-two-board-tabs-canvas.png') });

    // The pinned Setup tab's BOARDS gallery (both cards + "+ New board").
    await stripTab.first().click();
    await expect(page.getByTestId('crafter-board-list')).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: path.join(OUT_DIR, 'after-setup-tab-gallery.png') });
    await page.getByTestId('crafter-board-list').screenshot({
      path: path.join(OUT_DIR, 'after-gallery-closeup.png'),
    });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
