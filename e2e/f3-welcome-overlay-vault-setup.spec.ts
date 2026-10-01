/**
 * F3#9 / Probe #33 — Fresh-profile WelcomeOverlay vault setup
 * (OnboardingWizard deleted). Skip is always visible (main parity); first-run
 * still marks data-require-vault.
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

async function launchWithUserData(userData: string) {
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

async function launchFreshProfile() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f3-welcome-'));
  return launchWithUserData(userData);
}

async function launchFreshProfileReuse(userData: string) {
  return launchWithUserData(userData);
}

test.describe('F3#9 WelcomeOverlay-only onboarding', () => {
  test('fresh profile opens WelcomeOverlay with Skip always visible', async () => {
    const { app, page, userData } = await launchFreshProfile();
    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('data-require-vault', 'true');
      // Probe #33 — Skip — continue to the app is visible on first-run.
      await expect(page.getByTestId('welcome-skip')).toBeVisible();
      await expect(page.getByTestId('welcome-skip')).toHaveText(/Skip — continue to the app/);
      for (const id of ['template', 'blank', 'import', 'restore', 'openin'] as const) {
        await expect(page.getByTestId(`welcome-path-${id}`)).toBeVisible();
      }
      // OnboardingWizard must not mount.
      await expect(page.locator('[data-testid="onboarding-wizard"], [data-testid="screen-welcome"]')).toHaveCount(0);

      // Probe #33 — Skip continues to a working app with no vault; relaunch stays past Welcome.
      await page.getByTestId('welcome-skip').click();
      await expect(page.getByTestId('welcome-overlay')).toHaveCount(0, { timeout: 30_000 });
      await expect(
        page.locator('.app-menu-bar, .desktop-shell, .shell-root').first(),
      ).toBeVisible({ timeout: 45_000 });
      await expect.poll(() => {
        const p = path.join(userData, 'app-settings.json');
        if (!fs.existsSync(p)) return null;
        const s = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
          onboardingComplete?: boolean;
          onboardingStartMode?: string | null;
        };
        return s.onboardingComplete === true && s.onboardingStartMode === 'skip'
          ? 'ok'
          : null;
      }, { timeout: 15_000 }).toBe('ok');
    } finally {
      await app.close();
    }
    // Real relaunch — Welcome must not bounce back.
    const again = await launchFreshProfileReuse(userData);
    try {
      await expect(again.page.getByTestId('welcome-overlay')).toHaveCount(0);
      await expect(
        again.page.locator('.app-menu-bar, .desktop-shell, .shell-root').first(),
      ).toBeVisible({ timeout: 45_000 });
    } finally {
      await again.app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
