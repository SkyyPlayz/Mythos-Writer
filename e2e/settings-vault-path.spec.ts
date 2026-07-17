import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

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

test('Settings Account vault path uses runtime CSS truncation in Electron', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-settings-vault-path-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(
    tempRoot,
    'Story Vault',
    'with',
    'a',
    'very',
    'deep',
    'folder',
    'name',
    'that',
    'should',
    'truncate',
    'inside',
    'settings',
  );
  const notesVault = path.join(tempRoot, 'Notes Vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    // SKY-3177: AppNavRail adds a second "Open settings" button; target the menu bar one.
    await page.locator('.app-menu-gear-btn').click();
    // SKY-2973: vault path is in the Vaults tab; navigate there first
    // M28: the settings workspace rail labels this page 'Vault & Files' (§13).
    await page.getByRole('tab', { name: 'Vault & Files' }).click();
    const pathDisplay = page.locator('.settings-vault-path-display');
    await expect(pathDisplay).toHaveAttribute('title', storyVault);

    await expect(pathDisplay).toHaveCSS('overflow', 'hidden');
    await expect(pathDisplay).toHaveCSS('text-overflow', 'ellipsis');
    await expect(pathDisplay).toHaveCSS('white-space', 'nowrap');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
