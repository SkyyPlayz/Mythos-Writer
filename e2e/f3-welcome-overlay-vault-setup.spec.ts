/**
 * F3#9 — Fresh-profile WelcomeOverlay vault setup (OnboardingWizard deleted).
 * Vault setup is not skippable when onboardingComplete is false.
 * Security residual: overlay stays open until create succeeds; cancel → no shell.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

async function launchFreshProfile() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f3-welcome-'));
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    env: {
      ...process.env,
      HOME: userData,
      MYTHOS_E2E: '1',
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

test.describe('F3#9 WelcomeOverlay-only onboarding', () => {
  test('fresh profile opens WelcomeOverlay and cannot skip vault setup', async () => {
    const { app, page, userData } = await launchFreshProfile();
    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
      await expect(page.getByTestId('welcome-skip')).toHaveCount(0);
      for (const id of ['template', 'blank', 'import', 'restore', 'openin'] as const) {
        await expect(page.getByTestId(`welcome-path-${id}`)).toBeVisible();
      }
      // OnboardingWizard must not mount.
      await expect(page.locator('[data-testid="onboarding-wizard"], [data-testid="screen-welcome"]')).toHaveCount(0);
      // F3#9 residual — shell is not mounted during first-run.
      await expect(page.getByTestId('desktop-shell')).toHaveCount(0);
      await expect(page.getByTestId('welcome-first-run')).toHaveAttribute('data-shell-mounted', 'false');
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('pick path → cancel → overlay still shown and shell NOT mounted', async () => {
    const { app, page, userData } = await launchFreshProfile();
    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('desktop-shell')).toHaveCount(0);

      await page.getByTestId('welcome-path-template').click();
      await expect(page.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId('create-vault-cancel').click();

      await expect(page.getByRole('dialog', { name: 'Create a Mythos vault' })).toHaveCount(0);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible();
      await expect(page.getByTestId('desktop-shell')).toHaveCount(0);
      await expect(page.getByTestId('app-shell-root')).toHaveCount(0);
      await expect(page.getByTestId('welcome-first-run')).toHaveAttribute('data-shell-mounted', 'false');
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('success path → shell is mounted', async () => {
    const { app, page, userData } = await launchFreshProfile();
    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-blank').click();
      await expect(page.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeVisible({
        timeout: 15_000,
      });

      // Prefer default vaults folder; name the vault.
      const defaultBtn = page.getByTestId('create-vault-default-folder');
      if (await defaultBtn.isEnabled()) {
        await defaultBtn.click();
      }
      await page.getByLabel(/name for the new mythos vault/i).fill(`F3b Fresh ${Date.now()}`);
      await page.getByTestId('create-vault-submit').click();

      await expect(page.getByTestId('welcome-overlay')).toHaveCount(0, { timeout: 90_000 });
      await expect(page.getByTestId('desktop-shell')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('app-shell-root')).toHaveAttribute('data-shell-mounted', 'true');
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
