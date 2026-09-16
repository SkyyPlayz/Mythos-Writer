/**
 * capture-sky-10407-screenshot.spec.ts — SKY-10407 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence for #1530: the Settings
 * -> "Vault & Files" tab no longer has a "Vault format" card
 * (MythosFormatSection deleted, section-vault-format dropped from
 * settingsCategories.ts). This shows VaultPathsSection followed directly by
 * VaultHealthSection with nothing in between.
 *
 * Output: pr-screenshots/sky-10407-vault-format-removed/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-10407-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10407-vault-format-removed');

function seedCompletedOnboarding(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-10407 Vault & Files settings tab with no Vault format card', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10407-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Story Vault');
  const notesVault = path.join(tempRoot, 'Notes Vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();

    // section-vault-paths used to be immediately followed by
    // section-vault-format; assert it's gone while its neighbors are intact.
    const vaultPaths = page.getByTestId('vaults-folder-path');
    await expect(vaultPaths).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Vault format')).toHaveCount(0);
    await expect(page.getByText(/upgrade.*mythosvault/i)).toHaveCount(0);

    // The settings body scrolls internally — scroll the vault-paths section
    // into view so the capture shows it directly followed by Vault Health,
    // with no format card between them.
    await vaultPaths.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'vault-files-no-format-card.png') });
    console.log('  wrote vault-files-no-format-card.png');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
