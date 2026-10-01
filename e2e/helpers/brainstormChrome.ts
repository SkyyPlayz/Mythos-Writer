/**
 * Standalone Brainstorm chrome helpers (Ivy ruling 4, amended).
 *
 * At @container pc-chrome ≤999, Agent Chat | Idea Board (and the chat-page
 * Board toggle, plus board + Idea / search) live in the ⋯ overflow menu.
 * Inline controls stay in the DOM with display:none — Playwright
 * toBeVisible() fails unless tests open ⋯. These helpers keep the same
 * mode-control contract without undoing the overflow packing.
 */
import { expect, type Page } from '@playwright/test';

export type BrainstormMode = 'chat' | 'board';

/** Open ⋯ when the inline mode seg is hidden. Returns placement. */
export async function revealBrainstormModeControls(
  page: Page,
): Promise<'inline' | 'overflow'> {
  const inlineSeg = page.locator('[data-testid="bsc-mode-seg-inline"]');
  if (await inlineSeg.isVisible().catch(() => false)) return 'inline';

  const overflow = page.locator('[data-testid="brainstorm-header-overflow-standalone"]');
  await expect(
    overflow,
    'standalone ⋯ must expose mode controls when inline seg is hidden (≤999)',
  ).toBeVisible({ timeout: 8_000 });

  const menu = page.locator('[data-testid="brainstorm-header-overflow-standalone-menu"]');
  if (!(await menu.isVisible().catch(() => false))) {
    await overflow.click();
  }
  await expect(menu).toBeVisible({ timeout: 5_000 });
  return 'overflow';
}

/** Assert Agent Chat / Idea Board mode control is reachable (inline or ⋯). */
export async function expectBrainstormModeVisible(
  page: Page,
  mode: BrainstormMode,
): Promise<void> {
  await revealBrainstormModeControls(page);
  await expect(
    page.locator(`[data-testid="bsc-mode-${mode}"]:visible`),
    `bsc-mode-${mode} must be visible inline or in standalone ⋯ menu`,
  ).toBeVisible({ timeout: 5_000 });
}

/** Click Agent Chat / Idea Board — opens ⋯ first when needed. */
export async function clickBrainstormMode(
  page: Page,
  mode: BrainstormMode,
): Promise<void> {
  const placement = await revealBrainstormModeControls(page);
  if (placement === 'inline') {
    await page.locator(`[data-testid="bsc-mode-seg-inline"] [data-testid="bsc-mode-${mode}"]`).click();
    return;
  }
  await page.locator(`[data-testid="bsc-mode-${mode}"]:visible`).click();
}

/** Chat-page "Idea Board under chat" toggle — inline or ⋯ menu item. */
export async function clickChatBoardToggle(page: Page): Promise<void> {
  const inline = page.locator('[data-testid="bs-chat-board-toggle"]');
  if (await inline.isVisible().catch(() => false)) {
    await inline.click();
    return;
  }
  await revealBrainstormModeControls(page);
  const menuToggle = page.locator('[data-testid="menu-item-board-toggle"]');
  await expect(menuToggle, 'board toggle must be in standalone ⋯ when inline is hidden')
    .toBeVisible({ timeout: 5_000 });
  await menuToggle.click();
}
