import { expect, type Page } from '@playwright/test';

/**
 * Click the Story item in the main nav WITHOUT tripping the nav rail v2
 * Stories popover: re-clicking the ACTIVE Story item toggles the popover
 * open, and its backdrop then intercepts every subsequent pointer event
 * (its in-app outside-click dismissal is broken — tracked separately).
 * No-ops when Story is already the active section; defensively dismisses
 * a stray popover either way.
 */
export async function clickStoryNav(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyBtn = nav.locator('button[aria-label="Story Writer"]');
  if (await storyBtn.getAttribute('aria-current') !== 'page') {
    await storyBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}
