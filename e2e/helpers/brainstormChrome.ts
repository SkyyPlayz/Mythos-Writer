/**
 * Standalone Brainstorm chrome helpers (Ivy ruling 4, amended).
 *
 * At @container pc-chrome ≤999, Agent Chat | Idea Board (and the chat-page
 * Board toggle, plus board + Idea / search) live in the ⋯ overflow menu.
 * Inline controls stay in the DOM with display:none — Playwright
 * toBeVisible() fails unless tests open ⋯. These helpers keep the same
 * mode-control contract without undoing the overflow packing.
 *
 * Keep-alive: GlobalRightSidebar / workspace-split also mount compact
 * `.brainstorm-page` instances. Always scope to `#app-tabpanel-brainstorm`
 * (standalone tab only) — never `.brainstorm-page:visible` + `.first()`.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type BrainstormMode = 'chat' | 'board';

/** Standalone Brainstorm tab panel (not compact Notes Agent / split clones). */
export function brainstormPanel(page: Page): Locator {
  return page.locator('#app-tabpanel-brainstorm');
}

/** Open ⋯ when the inline mode seg is hidden. Returns placement. */
export async function revealBrainstormModeControls(
  page: Page,
): Promise<'inline' | 'overflow'> {
  const panel = brainstormPanel(page);
  await expect(panel, 'standalone brainstorm tab panel').toBeVisible({ timeout: 8_000 });

  const inlineSeg = panel.locator('[data-testid="bsc-mode-seg-inline"]');
  if (await inlineSeg.isVisible().catch(() => false)) return 'inline';

  const overflow = panel.locator('[data-testid="brainstorm-header-overflow-standalone"]');
  await expect(
    overflow,
    'standalone ⋯ must expose mode controls when inline seg is hidden (≤999)',
  ).toBeVisible({ timeout: 8_000 });

  // Menu portals to document body — do not scope under the panel.
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
  const placement = await revealBrainstormModeControls(page);
  if (placement === 'inline') {
    await expect(
      brainstormPanel(page).locator(`[data-testid="bsc-mode-seg-inline"] [data-testid="bsc-mode-${mode}"]`),
      `bsc-mode-${mode} must be visible inline`,
    ).toBeVisible({ timeout: 5_000 });
    return;
  }
  await expect(
    page.locator(`[data-testid="brainstorm-header-overflow-standalone-menu"] [data-testid="bsc-mode-${mode}"]`),
    `bsc-mode-${mode} must be visible in standalone ⋯ menu`,
  ).toBeVisible({ timeout: 5_000 });
}

/** Click Agent Chat / Idea Board — opens ⋯ first when needed. */
export async function clickBrainstormMode(
  page: Page,
  mode: BrainstormMode,
): Promise<void> {
  const panel = brainstormPanel(page);
  const placement = await revealBrainstormModeControls(page);
  if (placement === 'inline') {
    await panel.locator(`[data-testid="bsc-mode-seg-inline"] [data-testid="bsc-mode-${mode}"]`).click();
    return;
  }
  await page
    .locator(`[data-testid="brainstorm-header-overflow-standalone-menu"] [data-testid="bsc-mode-${mode}"]`)
    .click();
}

/** Chat-page "Idea Board under chat" toggle — inline or ⋯ menu item. */
export async function clickChatBoardToggle(page: Page): Promise<void> {
  const panel = brainstormPanel(page);
  const inline = panel.locator('[data-testid="bs-chat-board-toggle"]');
  if (await inline.isVisible().catch(() => false)) {
    await inline.click();
    return;
  }
  await revealBrainstormModeControls(page);
  const menuToggle = page.locator(
    '[data-testid="brainstorm-header-overflow-standalone-menu"] [data-testid="menu-item-board-toggle"]',
  );
  await expect(menuToggle, 'board toggle must be in standalone ⋯ when inline is hidden')
    .toBeVisible({ timeout: 5_000 });
  await menuToggle.click();
}
