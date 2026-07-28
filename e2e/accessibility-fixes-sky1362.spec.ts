/**
 * accessibility-fixes-sky1362.spec.ts — SKY-1362
 *
 * E2E verification for accessibility fixes:
 * - F-12: Back button arrow wrapped in aria-hidden span (screen reader shouldn't read arrow)
 * - F-14: Focus restored when returning from template-picker
 *
 * Acceptance criteria:
 * - [ ] Screen reader on Back button announces "Back, button" (no arrow character read)
 * - [ ] Returning from template-picker focuses the "Start from template" card on the welcome screen
 * - [ ] All other Back buttons in the wizard also use `<span aria-hidden="true">` for their arrow glyphs
 *
 * Run:
 *   npm run build:electron
 *   npx playwright test e2e/accessibility-fixes-sky1362.spec.ts --reporter=list
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
    env: { ...process.env, HOME: userData },
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe('SKY-1362: Accessibility Fixes', () => {
  test('F-12: Back button arrows are wrapped in aria-hidden spans', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-f12-'));
    const app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    // Set up mocks for template list
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('template:list');
      ipcMain.handle('template:list', () => ({
        templates: [
          {
            id: 'test-template',
            name: 'Test Template',
            description: 'Template for a11y testing.',
            story: [],
            notes: [],
          },
        ],
      }));
    });

    try {
    // Wait for step 1 (welcome screen)
    await expect(page.locator('[data-testid="screen-step1"]')).toBeVisible({ timeout: 12_000 });

    // SKY-7593 wizard redesign: "Use a template" is no longer a step1 card —
    // it's a secondary link on the custom-location screen, reached via
    // "Start blank" (screen-custom-location's data-testid="custom-location-use-template-link").
    await page.locator('[data-testid="card-start-blank"]').click();
    await expect(page.locator('[data-testid="screen-custom-location"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="custom-location-use-template-link"]').click();
    await expect(page.locator('[data-testid="screen-step1b"]')).toBeVisible({ timeout: 8_000 });

    // F-12 Check: Back button in step1b should have aria-hidden span
    const backButtonAriaHiddenCount = await page.locator(
      '[data-testid="gs-back-step1b"] span[aria-hidden="true"]'
    ).count();
    expect(backButtonAriaHiddenCount).toBeGreaterThan(0);

    // Verify the accessible name is "Back" (not "← Back") — this is what a
    // screen reader announces. Plain textContent() would include the arrow
    // glyph even though it's aria-hidden, since aria-hidden only affects the
    // accessibility tree, not the DOM text — so this must use the computed
    // accessible name, not raw textContent().
    await expect(page.locator('[data-testid="gs-back-step1b"]')).toHaveAccessibleName('Back');

    // Navigate to step 2 — already on the template picker (screen-step1b) from
    // the click above; select the template directly.
    await page.locator('[data-testid="template-card-test-template"]').click();
    await page.locator('[data-testid="template-use-btn"]').click();
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });

    // F-12 Check: Back button in step2 should also have aria-hidden span
    const step2BackAriaHiddenCount = await page.locator(
      '[data-testid="gs-back-step2"] span[aria-hidden="true"]'
    ).count();
    expect(step2BackAriaHiddenCount).toBeGreaterThan(0);

    // Verify step2 button's accessible name is also "Back" (see note above).
    await expect(page.locator('[data-testid="gs-back-step2"]')).toHaveAccessibleName('Back');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('F-14: Focus restored to "Start from template" card after returning from template-picker', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-f14-'));
    const app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    // Set up mocks for template list
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('template:list');
      ipcMain.handle('template:list', () => ({
        templates: [
          {
            id: 'test-template',
            name: 'Test Template',
            description: 'Template for a11y testing.',
            story: [],
            notes: [],
          },
        ],
      }));
    });

    try {
    // Reset to step 1
    await expect(page.locator('[data-testid="screen-step1"]')).toBeVisible({ timeout: 12_000 });

    // SKY-7593 wizard redesign: reach the template picker via "Start blank" →
    // custom-location's "Use a template instead" link (no more step1 card-template).
    await page.locator('[data-testid="card-start-blank"]').click();
    await expect(page.locator('[data-testid="screen-custom-location"]')).toBeVisible({ timeout: 8_000 });

    // Focus the "Use a template instead" link
    await page.locator('[data-testid="custom-location-use-template-link"]').focus();

    // Verify focus is on the template link
    let focusedTestId = await page.evaluate(() => {
      return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
    });
    expect(focusedTestId).toBe('custom-location-use-template-link');

    // Click to navigate to template picker
    await page.locator('[data-testid="custom-location-use-template-link"]').click();
    await expect(page.locator('[data-testid="screen-step1b"]')).toBeVisible({ timeout: 8_000 });

    // Click Back — this returns to custom-location (not all the way to step1),
    // per OnboardingWizard.tsx's gs-back-step1b handler.
    await page.locator('[data-testid="gs-back-step1b"]').click();
    await expect(page.locator('[data-testid="screen-custom-location"]')).toBeVisible({ timeout: 8_000 });

    // F-14 Check: Focus should be restored to the "Use a template instead" link
    focusedTestId = await page.evaluate(() => {
      return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
    });

    // The focus restoration happens via requestAnimationFrame, so we may need to wait a tick
    if (focusedTestId !== 'custom-location-use-template-link') {
      // Give it another tick if not focused yet
      await page.waitForTimeout(100);
      focusedTestId = await page.evaluate(() => {
        return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
      });
    }

    expect(focusedTestId).toBe('custom-location-use-template-link');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
