/**
 * accessibility-fixes-sky1362.spec.ts — SKY-1362
 *
 * E2E verification for accessibility fixes:
 * - F-12: Back button arrow wrapped in aria-hidden span (screen reader shouldn't read arrow)
 * - F-14: Focus restored when returning to the welcome screen
 *
 * Acceptance criteria:
 * - [ ] Screen reader on Back button announces "Back, button" (no arrow character read)
 * - [ ] Returning to welcome focuses the "Start from a template" card
 * - [ ] All Back buttons in the wizard use `<span aria-hidden="true">` for their arrow glyphs
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

    try {
    // Wait for the welcome screen (SKY-11152: 3-card wizard, welcome → import|name).
    await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });

    // Template mode skips the import screen and lands straight on the name
    // screen, whose Back button is step3-back.
    await page.locator('[data-testid="card-template"]').click();
    await expect(page.locator('[data-testid="screen-name"]')).toBeVisible({ timeout: 8_000 });

    // F-12 Check: Back button on the name screen should have an aria-hidden span
    const step3BackAriaHiddenCount = await page.locator(
      '[data-testid="step3-back"] span[aria-hidden="true"]'
    ).count();
    expect(step3BackAriaHiddenCount).toBeGreaterThan(0);

    // Verify the accessible name is "Back" (not "‹ Back") — this is what a
    // screen reader announces. Plain textContent() would include the arrow
    // glyph even though it's aria-hidden, since aria-hidden only affects the
    // accessibility tree, not the DOM text — so this must use the computed
    // accessible name, not raw textContent().
    await expect(page.locator('[data-testid="step3-back"]')).toHaveAccessibleName('Back');

    // Import mode's Back button (step2-back, on the import screen) uses the
    // same pattern — verify it too.
    await page.locator('[data-testid="step3-back"]').click();
    await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="card-import-obsidian"]').click();
    await expect(page.locator('[data-testid="screen-import"]')).toBeVisible({ timeout: 8_000 });

    const step2BackAriaHiddenCount = await page.locator(
      '[data-testid="step2-back"] span[aria-hidden="true"]'
    ).count();
    expect(step2BackAriaHiddenCount).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="step2-back"]')).toHaveAccessibleName('Back');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('F-14: Focus restored to "Start from a template" card after returning from the name screen', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-f14-'));
    const app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    try {
    // Wait for the welcome screen.
    await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });

    // Pick the template card, which lands directly on the name screen
    // (SKY-11152: no intermediate template-picker screen anymore).
    await page.locator('[data-testid="card-template"]').click();
    await expect(page.locator('[data-testid="screen-name"]')).toBeVisible({ timeout: 8_000 });

    // Click Back — returns to the welcome screen.
    await page.locator('[data-testid="step3-back"]').click();
    await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 8_000 });

    // F-14 Check: focus should be restored to the "Start from a template" card
    // (OnboardingWizard.tsx's firstCardRef, focused whenever step === 'welcome').
    let focusedTestId = await page.evaluate(() => {
      return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
    });

    // Focus restoration runs in an effect on the 'welcome' step transition, so
    // allow one tick if it hasn't landed yet.
    if (focusedTestId !== 'card-template') {
      await page.waitForTimeout(100);
      focusedTestId = await page.evaluate(() => {
        return (document.activeElement as HTMLElement)?.getAttribute('data-testid');
      });
    }

    expect(focusedTestId).toBe('card-template');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
