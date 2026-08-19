/**
 * sky10385-new-vault-from-settings.spec.ts — SKY-10385
 *
 * Real E2E for the Settings → Vault & Files "New vault" button: launches the
 * actual Electron app and drives the real `vault:createDefaultMythos` +
 * `project:switch` IPC handlers (no stubbed vault logic) to create a second
 * Mythos vault from Settings, switch to it, and confirm both the on-disk
 * bundle and the running renderer actually reflect the switch.
 *
 * The only mock is `dialog.showOpenDialog` — Playwright cannot drive the
 * native OS folder picker, so we fake that single call to return a real,
 * pre-existing empty directory (same pattern as move-vault-real.spec.ts).
 *
 * Acceptance criteria (SKY-10385):
 *   - a clearly labelled "New vault" control exists in Settings → Vault & Files
 *   - it creates a real Story Vault + Notes Vault pair at a chosen location
 *   - it switches to the new vault, and the switch actually loads it
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const NEW_VAULT_NAME = 'Second Vault';

interface Dirs {
  homeRoot: string;
  userData: string;
  storyVault: string;
  notesVault: string;
  newVaultParent: string;
}

function makeDirs(): Dirs {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-new-vault-home-'));
  const userData = path.join(homeRoot, 'user-data');
  const storyVault = path.join(homeRoot, 'Story Vault');
  const notesVault = path.join(homeRoot, 'Notes Vault');
  const newVaultParent = path.join(homeRoot, 'Elsewhere');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(newVaultParent, { recursive: true }); // pre-existing empty destination folder
  return { homeRoot, userData, storyVault, notesVault, newVaultParent };
}

function seedUserData(dirs: Dirs): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    theme: 'dark',
  };
  const vaultSettings = {
    vaultRoot: dirs.storyVault,
    notesVaultRoot: dirs.notesVault,
  };
  fs.writeFileSync(path.join(dirs.userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(dirs.userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

function cleanup(dirs: Dirs): void {
  fs.rmSync(dirs.homeRoot, { recursive: true, force: true });
}

async function launchApp(dirs: Dirs): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${dirs.userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: dirs.homeRoot },
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));

  // The ONLY fake in this spec: the native OS folder-picker dialog behind
  // `vault:chooseFolder`. Everything downstream (vaultCreateDefaultMythos's
  // real createMythosVault scaffold, project:switch's real gate + watcher
  // restart) is untouched.
  await app.evaluate(({ dialog }, newVaultParent: string) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [newVaultParent] })) as typeof dialog.showOpenDialog;
  }, dirs.newVaultParent);

  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openSettingsOnVaultsTab(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('tab', { name: 'Vault & Files' }).click();
}

test('New vault button in Settings creates a second Mythos vault and switches to it', async () => {
  const dirs = makeDirs();
  seedUserData(dirs);
  let app = await launchApp(dirs);
  try {
    let page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await openSettingsOnVaultsTab(page);

    // The bug: no create affordance existed anywhere in this section.
    await expect(page.locator('[data-testid="mvs-new-vault-open"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="mvs-new-vault-open"]').click();

    await page.locator('[data-testid="mvs-new-vault-name"]').fill(NEW_VAULT_NAME);

    // Browse triggers the real vault:chooseFolder handler (dialog mocked above).
    await page.locator('[data-testid="mvs-new-vault-location-browse"]').click();
    await expect(page.locator('[data-testid="mvs-new-vault-location-path"]')).toHaveText(dirs.newVaultParent);

    await page.locator('[data-testid="mvs-new-vault-create"]').click();

    // Form closes on success; the project:switch that follows creation
    // reloads DesktopShell state, which remounts Settings back onto its
    // default category tab — re-select Vault & Files before looking for
    // the new card.
    await expect(page.locator('[data-testid="mvs-new-vault-form"]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('tab', { name: 'Vault & Files' }).click();

    const expectedMythosRoot = path.join(dirs.newVaultParent, NEW_VAULT_NAME);
    const expectedStoryVault = path.join(expectedMythosRoot, 'Story Vault');
    const expectedNotesVault = path.join(expectedMythosRoot, 'Notes Vault');

    const newCard = page.locator(`[data-testid="mvs-card-${expectedStoryVault}"]`);
    await expect(newCard).toBeVisible({ timeout: 8_000 });
    await expect(newCard).toContainText('Current');

    // ── Disk assertions: real vault bundle, not a stub ────────────────────
    expect(fs.existsSync(path.join(expectedMythosRoot, 'mythos.json')), 'mythos.json missing').toBe(true);
    expect(fs.existsSync(expectedStoryVault), 'new Story Vault dir missing').toBe(true);
    expect(fs.existsSync(expectedNotesVault), 'new Notes Vault dir missing').toBe(true);

    const vaultSettingsOnDisk = JSON.parse(fs.readFileSync(path.join(dirs.userData, 'vault-settings.json'), 'utf-8'));
    expect(vaultSettingsOnDisk.vaultRoot).toBe(expectedStoryVault);
    expect(vaultSettingsOnDisk.notesVaultRoot).toBe(expectedNotesVault);

    // The original vault must still exist untouched — this creates a second
    // vault, it doesn't move or replace the first.
    expect(fs.existsSync(dirs.storyVault)).toBe(true);
    expect(fs.existsSync(dirs.notesVault)).toBe(true);

    // ── Switch actually loaded, not just settings.json flipped ────────────
    // The title-bar project switcher reflects the live renderer state pushed
    // by project:switch, independent of the Settings panel's own local state.
    await page.locator('[role="dialog"][aria-label="Settings"] .settings-close').click();
    await expect(page.locator('.project-switcher-btn')).toHaveAttribute(
      'aria-label',
      new RegExp(`^Active project: ${NEW_VAULT_NAME}\\.`),
      { timeout: 8_000 },
    );

    await app.close().catch(() => undefined);

    // ── Restart: app must boot straight into the new vault ────────────────
    app = await launchApp(dirs);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.vault-not-found, [data-testid="vault-not-found"]')).toHaveCount(0);
    await expect(page.locator('.project-switcher-btn')).toHaveAttribute(
      'aria-label',
      new RegExp(`^Active project: ${NEW_VAULT_NAME}\\.`),
      { timeout: 8_000 },
    );
  } finally {
    await app.close().catch(() => undefined);
    cleanup(dirs);
  }
});
