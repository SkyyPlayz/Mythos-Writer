/**
 * accessibility-fixes-sky1362.spec.ts — SKY-1362 / F3#9
 *
 * Original F-12/F-14 covered OnboardingWizard Back-button a11y. That wizard
 * was deleted (F3#9). WelcomeOverlay has no multi-step Back; vault setup is
 * path cards → Create Mythos vault modal.
 *
 * Retained coverage: WelcomeOverlay is keyboard-reachable and names its dialog.
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

async function launchFreshApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    env: { ...process.env, HOME: userData, MYTHOS_E2E: '1', MYTHOS_FORCE_ONBOARDING: '1' },
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe('SKY-1362: Accessibility Fixes (WelcomeOverlay era)', () => {
  test('F-12′: WelcomeOverlay dialog has accessible name; path cards are buttons', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-f12-'));
    const app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('welcome-overlay')).toHaveAttribute('role', 'dialog');
      await expect(page.getByTestId('welcome-overlay')).toHaveAccessibleName(/Welcome to Mythos Writer/i);
      await expect(page.getByTestId('welcome-path-template')).toHaveRole('button');
      await expect(page.getByTestId('welcome-path-blank')).toHaveRole('button');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('F-14′: template path card is focusable on first-run WelcomeOverlay', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-f14-'));
    const app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    try {
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-template').focus();
      const focusedTestId = await page.evaluate(() => {
        return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
      });
      expect(focusedTestId).toBe('welcome-path-template');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('F-12/F-14 wizard Back buttons: retired with OnboardingWizard', () => {
    test.skip(true, 'F3#9: OnboardingWizard deleted; no step2-back/step3-back surfaces.');
  });
});
