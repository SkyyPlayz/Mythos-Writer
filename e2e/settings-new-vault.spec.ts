// SKY-10401 / SKY-10385 — Settings → Vault & Files → MYTHOS VAULTS "New vault":
// the full real path (UI → IPC → main → disk, no window.api mocks). Creates a
// second vault from Settings, proves the active vault is untouched until the
// offered switch is accepted, then switches and proves the app loaded it.
// SKY-11452 (spec SKY-11141 §3/§3a): the form offers the SAME three choices
// as first run / Add vault (template / blank / import) and creates through
// the SKY-11151 primitive — never the Veynn demo seed. Template = the empty
// Notes-folder shape and nothing else; blank = nothing user-visible, and it
// stays that way across a relaunch.
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

function listVisibleEntries(dir: string): string[] {
  return fs.readdirSync(dir).filter((e) => !e.startsWith('.')).sort();
}

/** Every user-visible file path below `dir`, relative — the demo seed would
 *  show up here as Characters/Mira Veynn.md, The Last City of Veynn/… etc. */
function listVisibleFilesDeep(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

const TEMPLATE_NOTES_FOLDERS = ['Characters', 'Locations', 'Plot', 'Research', 'Stories', 'Worldbuilding'];

async function openMythosVaultsSection(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await page.getByRole('tab', { name: 'Vault & Files' }).click();
}

test('SKY-10401 / SKY-11452: create a second vault from Settings (template = shape, no demo content), then switch to it', async () => {
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

    await openMythosVaultsSection(page);

    // The clearly labelled create control the owner asked for (SKY-10385).
    const newVaultBtn = page.getByTestId('mvs-new-vault');
    await expect(newVaultBtn).toBeVisible();
    await newVaultBtn.click();

    // Destination prefilled with defaultMythosVaultsParent() = <userData>/vaults.
    const defaultParent = path.join(userData, 'vaults');
    await expect(page.getByTestId('mvs-create-dest-path')).toHaveText(defaultParent);

    // SKY-11141 §3: the SAME three choices as first run / Add vault, template
    // recommended and preselected.
    await expect(page.getByTestId('mvs-create-mode-template')).toBeVisible();
    await expect(page.getByTestId('mvs-create-mode-blank')).toBeVisible();
    await expect(page.getByTestId('mvs-create-mode-import')).toBeVisible();
    await expect(page.getByTestId('mvs-create-mode-template')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mvs-create-mode-template')).toContainText('RECOMMENDED');

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

    // SKY-11452: template = the ready SHAPE only. Exactly the six empty Notes
    // folders, zero files anywhere in either vault — no Veynn sample story,
    // no Characters/Mira Veynn.md, no Project Bible.
    expect(listVisibleEntries(newNotesRoot)).toEqual(TEMPLATE_NOTES_FOLDERS);
    expect(listVisibleFilesDeep(newNotesRoot)).toEqual([]);
    expect(listVisibleFilesDeep(newStoryRoot)).toEqual([]);
    expect(listVisibleFilesDeep(newRoot).join('\n')).not.toMatch(/Veynn|Kael Thorne|Project Bible|idea-library/);

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

test('SKY-11452 / SKY-11141 §3a: "Start blank" from Settings creates nothing user-visible, and it stays empty after a relaunch', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-settings-new-vault-blank-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
  const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);
  const newRoot = path.join(userData, 'vaults', 'QA Vault 2');
  const newStoryRoot = path.join(newRoot, 'Story Vault');
  const newNotesRoot = path.join(newRoot, 'Notes Vault');

  const assertBlankOnDisk = (when: string) => {
    expect(fs.existsSync(path.join(newRoot, 'mythos.json')), `${when}: mythos.json`).toBe(true);
    expect(listVisibleEntries(newNotesRoot), `${when}: Notes Vault must be empty`).toEqual([]);
    expect(listVisibleEntries(newStoryRoot), `${when}: Story Vault must be empty`).toEqual([]);
    // Root-level JSON (mythos.json, settings.json, …) is vault machinery; the
    // demo seed shows up as files INSIDE folders (Notes Vault/Characters/…,
    // Story Vault/The Last City of Veynn/…, Brainstorm/idea-library.json).
    expect(
      listVisibleFilesDeep(newRoot).filter((f) => f.includes('/')),
      `${when}: no user-visible files inside any folder`,
    ).toEqual([]);
  };

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await openMythosVaultsSection(page);
    await page.getByTestId('mvs-new-vault').click();
    await expect(page.getByTestId('mvs-create-dest-path')).toHaveText(path.join(userData, 'vaults'));

    await page.getByTestId('mvs-create-name').fill('QA Vault 2');
    await page.getByTestId('mvs-create-mode-blank').click();
    await expect(page.getByTestId('mvs-create-mode-blank')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('mvs-create-confirm').click();
    await expect(page.getByTestId('mvs-create-done')).toBeVisible({ timeout: 15_000 });
    // The QA repro's exact path: decline the switch.
    await page.getByTestId('mvs-create-stay').click();
    await expect(page.getByTestId('mvs-create-done')).not.toBeVisible();

    assertBlankOnDisk('right after create');
    // Registered (listed + switchable) without being activated.
    await expect(page.getByTestId(`mvs-card-${newStoryRoot}`)).toBeVisible();
    expect(readVaultSettings(userData).vaultRoot).toBe(storyVault);
  } finally {
    await app.close().catch(() => undefined);
  }

  // The failure mode §3a names: a later boot re-seeding the vault. Relaunch on
  // the same profile and check the blank vault is still blank; then switch to
  // it so its own open/index/health paths run, and check again.
  const app2 = await launchApp(userData);
  try {
    const page = await app2.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    assertBlankOnDisk('after relaunch');

    await openMythosVaultsSection(page);
    await page.getByTestId(`mvs-card-${newStoryRoot}`).click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 15_000 }).toBe(newStoryRoot);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    assertBlankOnDisk('after switching into it');
  } finally {
    await app2.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
