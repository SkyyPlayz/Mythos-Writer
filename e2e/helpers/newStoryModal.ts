import type { Page } from '@playwright/test';

/** PLAN-058 L5: navigator + / empty CTA open NewStoryModal when creating a story. */
export async function confirmNewStoryModalIfOpen(page: Page, title?: string): Promise<void> {
  const modal = page.locator('[data-testid="new-story-modal"]');
  const visible = await modal.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
  if (!visible) return;
  if (title) {
    await page.locator('[data-testid="new-story-modal-title-input"]').fill(title);
  }
  await page.locator('[data-testid="new-story-modal-submit"]').click();
  await modal.waitFor({ state: 'hidden', timeout: 10_000 });
}

/** File → New story — works even when a story is already selected. */
export async function createStoryFromFileMenu(page: Page, title?: string): Promise<void> {
  await page.locator('[data-testid="wc-menu-file"]').click();
  const item = page.getByRole('menuitem', { name: /^New story/ });
  await item.waitFor({ state: 'visible', timeout: 6_000 });
  await item.click();
  await confirmNewStoryModalIfOpen(page, title);
}

/**
 * Create a story via the left-rail + when the vault is empty; otherwise File → New story
 * (M6: `.lr-nav-add` appends a chapter once a story is selected).
 */
export async function createStoryFromNavAdd(page: Page, title?: string): Promise<void> {
  const storyRows = await page.locator('.nav-story-row').count();
  if (storyRows === 0) {
    await page.locator('.lr-nav-add').first().click();
  } else {
    await createStoryFromFileMenu(page, title);
    return;
  }
  await confirmNewStoryModalIfOpen(page, title);
}
