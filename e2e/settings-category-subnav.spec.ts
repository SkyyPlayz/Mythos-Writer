/**
 * SKY-3215 — Settings category sub-nav E2E tests.
 *
 * ACs verified:
 * - Left category sub-nav renders with all categories keyboard-reachable
 * - Selecting a category shows only its sections
 * - Sections not in the active category are hidden
 */
import { test, expect } from '@playwright/test';

test.describe('Settings category sub-nav (SKY-3215)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Open settings via keyboard shortcut or gear button
    // The settings button is accessible via aria-label
    const settingsBtn = page.locator('[aria-label="Open settings"], [data-testid="open-settings"]').first();
    await settingsBtn.click();
    await page.waitForSelector('.settings-cat-nav', { state: 'visible' });
  });

  test('renders all four category buttons', async ({ page }) => {
    for (const [id, label] of [
      ['general', 'General'],
      ['vaults', 'Vaults'],
      ['agents', 'Agents'],
      ['appearance', 'Appearance'],
    ] as const) {
      const btn = page.locator(`[data-testid="settings-cat-${id}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveText(label);
    }
  });

  test('General is active by default and shows its sections', async ({ page }) => {
    const activeBtn = page.locator('.settings-cat-nav-btn--active');
    await expect(activeBtn).toHaveText('General');

    // A General-category section should be visible
    const apiKeySection = page.locator('[aria-labelledby="section-api-key"]');
    await expect(apiKeySection).toBeVisible();
  });

  test('switching to Vaults shows vault sections and hides General sections', async ({ page }) => {
    await page.click('[data-testid="settings-cat-vaults"]');

    // A Vaults section must be visible
    const vaultPathsSection = page.locator('[aria-labelledby="section-vault-paths"]');
    await expect(vaultPathsSection).toBeVisible();

    // A General section must be hidden
    const apiKeySection = page.locator('[aria-labelledby="section-api-key"]');
    await expect(apiKeySection).not.toBeVisible();
  });

  test('switching to Agents shows agent sections', async ({ page }) => {
    await page.click('[data-testid="settings-cat-agents"]');

    const providersSection = page.locator('[aria-labelledby="section-providers"]');
    await expect(providersSection).toBeVisible();
  });

  test('switching to Appearance shows theme section', async ({ page }) => {
    await page.click('[data-testid="settings-cat-appearance"]');

    const themeSection = page.locator('[aria-labelledby="section-theme"]');
    await expect(themeSection).toBeVisible();
  });

  test('category buttons are keyboard reachable and activatable', async ({ page }) => {
    // Find the nav and tab into it
    const nav = page.locator('.settings-cat-nav');
    await nav.locator('button').first().focus();

    // Pressing Enter on Vaults button should activate it
    const vaultsBtn = page.locator('[data-testid="settings-cat-vaults"]');
    await vaultsBtn.focus();
    await page.keyboard.press('Enter');

    await expect(vaultsBtn).toHaveAttribute('aria-current', 'page');
  });

  test('aria-current is set only on the active category', async ({ page }) => {
    await page.click('[data-testid="settings-cat-vaults"]');
    const currentBtns = page.locator('.settings-cat-nav-btn[aria-current="page"]');
    await expect(currentBtns).toHaveCount(1);
    await expect(currentBtns).toHaveText('Vaults');
  });
});
