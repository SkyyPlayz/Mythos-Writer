/**
 * onboarding-four-paths.spec.ts — F3#9 rewrite + F3b AC port
 *
 * OnboardingWizard.tsx was DELETED (Ivy confirmed with Skyy). WelcomeOverlay
 * is the only first-run surface; path cards hand off to useCreateMythosVaultFlow
 * (Create a Mythos vault modal → createVaultFromOptions).
 *
 * F3b ports AC-OB-04 / AC-OB-06 / AC-OB-20 onto WelcomeOverlay + create-vault modal.
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/onboarding-four-paths.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

/** Product empty-name fallback (createMythosVault DEFAULT_MYTHOS_V2_NAME). */
const EMPTY_NAME_FALLBACK = 'My MythosVault';

async function launchFreshApp(
  userData: string,
  env?: Record<string, string>,
): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: userData, ...env },
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Stub native folder picker used by create-vault Browse. */
async function stubChooseFolder(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ ipcMain }, folder) => {
    ipcMain.removeHandler('vault:chooseFolder');
    ipcMain.handle('vault:chooseFolder', () => ({ path: folder, cancelled: false }));
  }, dir);
}

/** WelcomeOverlay path → Create Mythos vault modal → submit. */
async function createVaultViaWelcomePath(
  page: Page,
  pathId: 'template' | 'blank',
  opts?: { vaultName?: string; leaveNameEmpty?: boolean },
): Promise<void> {
  await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
  await page.getByTestId(`welcome-path-${pathId}`).click();
  const nameInput = page.locator('#create-vault-name');
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  if (opts?.leaveNameEmpty) {
    await nameInput.fill('');
  } else if (opts?.vaultName !== undefined) {
    await nameInput.fill(opts.vaultName);
  }
  await page.getByTestId('create-vault-submit').click();
  await Promise.race([
    page.getByTestId('desktop-shell').waitFor({ state: 'visible', timeout: 45_000 }),
    page.locator('.app-menu-bar').waitFor({ state: 'visible', timeout: 45_000 }),
    page.locator('.desktop-shell, .shell-root').waitFor({ state: 'visible', timeout: 45_000 }),
  ]);
}

test.describe('F3#9 WelcomeOverlay first-run (replaces OnboardingWizard ACs)', () => {
  test('AC-OB-01′: WelcomeOverlay shows five path cards; vault setup not skippable', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-01-'));
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
      await expect(page.getByTestId('welcome-skip')).toHaveCount(0);
      for (const id of ['template', 'blank', 'import', 'restore', 'openin'] as const) {
        await expect(page.getByTestId(`welcome-path-${id}`)).toBeVisible();
      }
      await expect(page.getByTestId('welcome-path-template')).toContainText('RECOMMENDED');
      await expect(page.locator('[data-testid="screen-welcome"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="onboarding-wizard"]')).toHaveCount(0);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-03′: template path creates Notes Vault skeleton via create vault modal', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-03-'));
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await createVaultViaWelcomePath(page, 'template', { vaultName: 'AC-OB-03 Vault' });

      const vaultSettingsPath = path.join(userData, 'vault-settings.json');
      await expect
        .poll(() => fs.existsSync(vaultSettingsPath), { timeout: 30_000 })
        .toBe(true);
      const vaultSettings = JSON.parse(fs.readFileSync(vaultSettingsPath, 'utf-8')) as {
        vaultRoot?: string;
        notesVaultRoot?: string;
      };
      expect(vaultSettings.notesVaultRoot).toBeTruthy();
      const notesVault = vaultSettings.notesVaultRoot!;
      for (const dir of ['Characters', 'Locations', 'Stories', 'Plot', 'Worldbuilding', 'Research']) {
        const full = path.join(notesVault, dir);
        expect(fs.existsSync(full), `Notes Vault/${dir} should exist`).toBe(true);
      }
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-04′: custom vault name is the on-disk Mythos vault folder name', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-04-'));
    const vaultParent = path.join(userData, 'Vaults04');
    fs.mkdirSync(vaultParent, { recursive: true });
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await stubChooseFolder(app, vaultParent);

      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-blank').click();
      await expect(page.locator('#create-vault-name')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('create-vault-browse').click();
      await expect(page.getByTestId('create-vault-dest-path')).toHaveText(vaultParent, {
        timeout: 10_000,
      });
      await page.locator('#create-vault-name').fill("Dragon's Crossing");
      await page.getByTestId('create-vault-submit').click();

      await expect(page.getByTestId('desktop-shell')).toBeVisible({ timeout: 45_000 });
      const storyVault = path.join(vaultParent, "Dragon's Crossing", 'Stories', 'Story Vault');
      expect(
        fs.existsSync(storyVault),
        "vaultParent/Dragon's Crossing/Stories/Story Vault should exist",
      ).toBe(true);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-05′: blank path creates vault pair and lands on shell', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-05-'));
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await createVaultViaWelcomePath(page, 'blank', { vaultName: 'Blank Vault' });

      const vaultSettingsPath = path.join(userData, 'vault-settings.json');
      await expect
        .poll(() => {
          if (!fs.existsSync(vaultSettingsPath)) return false;
          const vs = JSON.parse(fs.readFileSync(vaultSettingsPath, 'utf-8')) as {
            vaultRoot?: string;
            notesVaultRoot?: string;
          };
          return Boolean(vs.vaultRoot && vs.notesVaultRoot);
        }, { timeout: 30_000 })
        .toBe(true);

      const appSettings = JSON.parse(
        fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8'),
      ) as { onboardingComplete?: boolean };
      expect(appSettings.onboardingComplete).toBe(true);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-06′: empty vault name falls back to "My MythosVault" on disk', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-06-'));
    const vaultParent = path.join(userData, 'Vaults06');
    fs.mkdirSync(vaultParent, { recursive: true });
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await stubChooseFolder(app, vaultParent);

      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-blank').click();
      await expect(page.locator('#create-vault-name')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('create-vault-browse').click();
      await expect(page.getByTestId('create-vault-dest-path')).toHaveText(vaultParent, {
        timeout: 10_000,
      });
      await page.locator('#create-vault-name').fill('');
      await page.getByTestId('create-vault-submit').click();

      await expect(page.getByTestId('desktop-shell')).toBeVisible({ timeout: 45_000 });
      expect(
        fs.existsSync(path.join(vaultParent, EMPTY_NAME_FALLBACK, 'Stories', 'Story Vault')),
      ).toBe(true);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-14′: onboardingComplete:true skips WelcomeOverlay vault-require', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-14-'));
    fs.mkdirSync(userData, { recursive: true });
    const vaultDir = path.join(userData, 'vaults', 'Existing');
    fs.mkdirSync(path.join(vaultDir, 'Story Vault'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'Notes Vault'), { recursive: true });
    fs.writeFileSync(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
    );
    fs.writeFileSync(
      path.join(userData, 'vault-settings.json'),
      JSON.stringify({
        vaultRoot: path.join(vaultDir, 'Story Vault'),
        notesVaultRoot: path.join(vaultDir, 'Notes Vault'),
      }, null, 2),
    );

    const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
    const app = await electron.launch({
      args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
      env: { ...process.env, HOME: userData },
      timeout: 60_000,
    });
    try {
      const page = await firstWindow(app);
      await expect(page.locator('.app-menu-bar, .desktop-shell, .shell-root').first()).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.locator('[data-testid="welcome-overlay"][data-require-vault="true"]')).toHaveCount(0);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('AC-OB-20′: blank path + Browse custom parent creates vault on disk at non-default location', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-'));
    const defaultParent = path.join(userData, 'vaults');
    const customParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-custom-'));
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await stubChooseFolder(app, customParent);

      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-blank').click();
      await expect(page.locator('#create-vault-name')).toBeVisible({ timeout: 15_000 });

      const prefilled = (await page.getByTestId('create-vault-dest-path').textContent())?.trim() ?? '';
      expect(prefilled).not.toBe(customParent);

      await page.getByTestId('create-vault-browse').click();
      await expect(page.getByTestId('create-vault-dest-path')).toHaveText(customParent, {
        timeout: 10_000,
      });
      await page.locator('#create-vault-name').fill('§4c Reachability Vault');
      await page.getByTestId('create-vault-submit').click();

      await expect(page.getByTestId('desktop-shell')).toBeVisible({ timeout: 45_000 });

      const mythosRoot = path.join(customParent, '§4c Reachability Vault');
      expect(
        fs.existsSync(path.join(mythosRoot, 'mythos.json')),
        'vault must exist ON DISK at the custom location',
      ).toBe(true);
      expect(fs.existsSync(path.join(mythosRoot, 'Stories', 'Story Vault'))).toBe(true);
      expect(fs.existsSync(path.join(mythosRoot, 'Notes', 'Notes Vault'))).toBe(true);
      expect(fs.existsSync(path.join(defaultParent, '§4c Reachability Vault'))).toBe(false);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(customParent, { recursive: true, force: true });
    }
  });
});

// Retired wizard-only ACs (OnboardingWizard deleted F3#9). Kept as explicit skips
// so CI history / ticket IDs remain searchable. AC-OB-04/06/20 ported above as ′.
const RETIRED = 'F3#9: OnboardingWizard deleted; WelcomeOverlay + create-vault modal replaces this AC.';

test.describe('Retired OnboardingWizard ACs (F3#9)', () => {
  for (const id of [
    'AC-OB-02', 'AC-OB-07', 'AC-OB-08', 'AC-OB-09', 'AC-OB-10',
    'AC-OB-11', 'AC-OB-12', 'AC-OB-13', 'AC-OB-15', 'AC-OB-16', 'AC-OB-17', 'AC-OB-18',
    'AC-OB-19',
  ] as const) {
    test(`${id}: retired with OnboardingWizard`, () => {
      test.skip(true, RETIRED);
    });
  }
});
