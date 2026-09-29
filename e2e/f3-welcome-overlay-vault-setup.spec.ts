/**
 * F3#9 — Fresh-profile WelcomeOverlay vault setup (OnboardingWizard deleted).
 * Vault setup is not skippable when onboardingComplete is false.
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
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
