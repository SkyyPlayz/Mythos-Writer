/**
 * Standalone Brainstorm chrome helpers (Ivy ruling 4, amended).
 *
 * At @container pc-chrome ≤999, Agent Chat | Idea Board (and the chat-page
 * Board toggle, plus board + Idea / search) live in the ⋯ overflow menu.
 * Inline controls stay in the DOM with display:none — Playwright
 * toBeVisible() fails unless tests open ⋯. These helpers keep the same
 * mode-control contract without undoing the overflow packing.
 *
 * Scope to `.brainstorm-page:visible` so B7/B9 keep-alive clones
 * (display:none) cannot steal clicks or false-positive visibility.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type BrainstormMode = 'chat' | 'board';

function brainstormRoot(page: Page): Locator {
  return page.locator('.brainstorm-page:visible').first();
}

/** True when the element's center is hit-testable (not covered by start-group). */
async function isCenterClickable(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!mid && (mid === el || el.contains(mid));
  }).catch(() => false);
}

/** Open ⋯ when the inline mode seg is hidden. Returns placement. */
export async function revealBrainstormModeControls(
  page: Page,
): Promise<'inline' | 'overflow'> {
  const root = brainstormRoot(page);
  await expect(root, 'visible brainstorm page').toBeVisible({ timeout: 8_000 });

  const inlineSeg = root.locator('[data-testid="bsc-mode-seg-inline"]');
  if (await inlineSeg.isVisible().catch(() => false)) {
    // Ruling-4 overlap fallout: min-content start-group can cover the seg
    // while Playwright still reports visible — prefer overflow then.
    if (await isCenterClickable(inlineSeg)) return 'inline';
  }

  const overflow = root.locator('[data-testid="brainstorm-header-overflow-standalone"]');
  await expect(
    overflow,
    'standalone ⋯ must expose mode controls when inline seg is hidden (≤999)',
  ).toBeVisible({ timeout: 8_000 });

  // Menu portals to document body — do not scope under .brainstorm-page.
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
  const root = brainstormRoot(page);
  const placement = await revealBrainstormModeControls(page);
  if (placement === 'inline') {
    await root.locator(`[data-testid="bsc-mode-seg-inline"] [data-testid="bsc-mode-${mode}"]`).click();
    return;
  }
  await page.locator(`[data-testid="bsc-mode-${mode}"]:visible`).click();
}

/** Chat-page "Idea Board under chat" toggle — inline or ⋯ menu item. */
export async function clickChatBoardToggle(page: Page): Promise<void> {
  const root = brainstormRoot(page);
  const inline = root.locator('[data-testid="bs-chat-board-toggle"]');
  if (await inline.isVisible().catch(() => false) && await isCenterClickable(inline)) {
    await inline.click();
    return;
  }
  await revealBrainstormModeControls(page);
  const menuToggle = page.locator('[data-testid="menu-item-board-toggle"]:visible');
  await expect(menuToggle, 'board toggle must be in standalone ⋯ when inline is hidden')
    .toBeVisible({ timeout: 5_000 });
  await menuToggle.click();
}
