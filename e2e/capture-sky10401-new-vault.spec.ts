// SKY-10401 — PR screenshots for the Settings → MYTHOS VAULTS "New vault"
// flow. Not part of CI: run manually to refresh the images.
//   npx playwright test e2e/capture-sky10401-new-vault.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10401-new-vault-settings');

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
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-10401 new-vault flow screenshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-capture-new-vault-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
  const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();
    const section = page.locator('[aria-labelledby="section-mythos-vaults"]');
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('mvs-new-vault')).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, '1-mythos-vaults-new-vault-button.png') });

    await page.getByTestId('mvs-new-vault').click();
    await expect(page.getByTestId('mvs-create-form')).toBeVisible();
    await expect(page.getByTestId('mvs-create-dest-path')).toHaveText(path.join(userData, 'vaults'));
    await page.getByTestId('mvs-create-name').fill('Second Vault');
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT_DIR, '2-create-form-prefilled.png') });

    await page.getByTestId('mvs-create-confirm').click();
    await expect(page.getByTestId('mvs-create-done')).toBeVisible({ timeout: 15_000 });
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT_DIR, '3-created-switch-offer.png') });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
