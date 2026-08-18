// SKY-10401 / SKY-10385 — Settings → Vault & Files → MYTHOS VAULTS "New vault":
// the full real path (UI → IPC → main → disk, no window.api mocks). Creates a
// second vault from Settings, proves the active vault is untouched until the
// offered switch is accepted, then switches and proves the app loaded it.
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

function readVaultSettings(userData: string): { vaultRoot?: string; notesVaultRoot?: string } {
  return JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf8'));
}

test('SKY-10401: create a second vault from Settings, then switch to it', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-settings-new-vault-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
  const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();

    // The clearly labelled create control the owner asked for (SKY-10385).
    const newVaultBtn = page.getByTestId('mvs-new-vault');
    await expect(newVaultBtn).toBeVisible();
    await newVaultBtn.click();

    // Destination prefilled with defaultMythosVaultsParent() = <userData>/vaults.
    const defaultParent = path.join(userData, 'vaults');
    await expect(page.getByTestId('mvs-create-dest-path')).toHaveText(defaultParent);

    await page.getByTestId('mvs-create-name').fill('Second Vault');
    await page.getByTestId('mvs-create-confirm').click();
    await expect(page.getByTestId('mvs-create-done')).toBeVisible({ timeout: 15_000 });

    // A full MythosVault v2 bundle exists on disk at the chosen destination.
    const newRoot = path.join(defaultParent, 'Second Vault');
    const newStoryRoot = path.join(newRoot, 'Story Vault');
    const newNotesRoot = path.join(newRoot, 'Notes Vault');
    expect(fs.existsSync(path.join(newRoot, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(newRoot, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(newRoot, 'timelines.json'))).toBe(true);
    expect(fs.statSync(newStoryRoot).isDirectory()).toBe(true);
    expect(fs.statSync(newNotesRoot).isDirectory()).toBe(true);

    // activate:false — the active vault must be untouched until the user accepts.
    expect(readVaultSettings(userData).vaultRoot).toBe(storyVault);

    // The new vault is registered and listed as a switchable card.
    await expect(page.getByTestId(`mvs-card-${newStoryRoot}`)).toBeVisible();

    // Accept the offered switch — the normal project:switch path.
    await page.getByTestId('mvs-create-switch').click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 15_000 }).toBe(newStoryRoot);

    // The switch reloads the shell behind the loading splash, which unmounts
    // Settings and remounts it on the default tab (same as the M1 card-click
    // switch). Reopen Settings fresh and confirm the new vault is Current.
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    const closeBtn = page.locator('.settings-close');
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();
    await expect(page.getByTestId(`mvs-card-${newStoryRoot}`)).toContainText('Current', { timeout: 10_000 });

    // Both vaults still exist on disk — the original is untouched.
    expect(fs.statSync(storyVault).isDirectory()).toBe(true);
    expect(fs.statSync(notesVault).isDirectory()).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
