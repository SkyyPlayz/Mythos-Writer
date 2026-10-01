/**
 * onboarding-four-paths.spec.ts — F3#9 rewrite
 *
 * OnboardingWizard.tsx was DELETED (Ivy confirmed with Skyy). WelcomeOverlay
 * is the only first-run surface; path cards hand off to useCreateMythosVaultFlow
 * (Create a Mythos vault modal → createVaultFromOptions).
 *
 * Legacy AC-OB-* cases that depended on screen-welcome / screen-name /
 * step2-* wizard testids are retired here. Fresh-profile coverage lives in
 * this file + e2e/f3-welcome-overlay-vault-setup.spec.ts.
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

/** WelcomeOverlay path → Create Mythos vault modal → submit (default name). */
async function createVaultViaWelcomePath(
  page: Page,
  pathId: 'template' | 'blank',
  vaultName?: string,
): Promise<void> {
  await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
  await page.getByTestId(`welcome-path-${pathId}`).click();
  const nameInput = page.locator('#create-vault-name');
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  if (vaultName !== undefined) {
    await nameInput.fill(vaultName);
  }
  await page.getByTestId('create-vault-submit').click();
  await Promise.race([
    page.locator('.app-menu-bar').waitFor({ state: 'visible', timeout: 45_000 }),
    page.locator('.desktop-shell, .shell-root').waitFor({ state: 'visible', timeout: 45_000 }),
  ]);
}

test.describe('F3#9 WelcomeOverlay first-run (replaces OnboardingWizard ACs)', () => {
  test('AC-OB-01′: WelcomeOverlay shows five path cards; Skip always visible (#33)', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-01-'));
    const app = await launchFreshApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
      await expect(page.getByTestId('welcome-skip')).toBeVisible();
      await expect(page.getByTestId('welcome-skip')).toHaveText(/Skip — continue to the app/);
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
      await createVaultViaWelcomePath(page, 'template', 'AC-OB-03 Vault');

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
      // C7 — disk (not mocked): template start mode survives shell onCreated.
      await expect.poll(() => {
        const p = path.join(userData, 'app-settings.json');
        if (!fs.existsSync(p)) return null;
        return (JSON.parse(fs.readFileSync(p, 'utf-8')) as {
          onboardingStartMode?: string | null;
        }).onboardingStartMode;
      }, { timeout: 15_000 }).toBe('template');
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
      await createVaultViaWelcomePath(page, 'blank', 'Blank Vault');

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
      ) as { onboardingComplete?: boolean; onboardingStartMode?: string | null };
      expect(appSettings.onboardingComplete).toBe(true);
      // C7 — Blank must write 'blank' (RED if mutant writes 'template').
      expect(appSettings.onboardingStartMode).toBe('blank');
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
      // Required vault setup overlay must not block the shell.
      await expect(page.locator('[data-testid="welcome-overlay"][data-require-vault="true"]')).toHaveCount(0);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});

// Retired wizard-only ACs (OnboardingWizard deleted F3#9). Kept as explicit skips
// so CI history / ticket IDs remain searchable.
const RETIRED = 'F3#9: OnboardingWizard deleted; WelcomeOverlay + create-vault modal replaces this AC.';

test.describe('Retired OnboardingWizard ACs (F3#9)', () => {
  for (const id of [
    'AC-OB-02', 'AC-OB-04', 'AC-OB-06', 'AC-OB-07', 'AC-OB-08', 'AC-OB-09', 'AC-OB-10',
    'AC-OB-11', 'AC-OB-12', 'AC-OB-13', 'AC-OB-15', 'AC-OB-16', 'AC-OB-17', 'AC-OB-18',
    'AC-OB-19', 'AC-OB-20',
  ] as const) {
    test(`${id}: retired with OnboardingWizard`, () => {
      test.skip(true, RETIRED);
    });
  }
});
