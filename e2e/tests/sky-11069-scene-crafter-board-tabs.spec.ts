/**
 * sky-11069-scene-crafter-board-tabs.spec.ts — SKY-11069 (owner ruling,
 * SKY-11049 addendum item 6): Scene Crafter BOARDS gallery + boards open
 * full-screen in their own Scene Crafter tabs ('board' workspace-tab kind).
 *
 * Reachability proof (§4c) — NOTHING is pre-seeded except the standard
 * onboarding-complete profile; the board under test is created through the
 * UI ("+ New board" gallery card):
 *
 *   fresh profile → create story → Scene Crafter shows the empty BOARDS
 *   gallery (§1.3 hint) → + New board → the board opens full-screen in a new
 *   tab beside the pinned Setup tab → Setup tab shows the gallery card
 *   (name + card count) → clicking the card AGAIN focuses the existing tab,
 *   never a duplicate → genuine Electron relaunch → the board tab is still
 *   open AND active (canvas visible) → Ctrl+W closes it and lands on the
 *   Setup tab (which itself is immune to Ctrl+W).
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
import { clickStoryNav } from '../helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function waitForBoot(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

async function createAndSelectStory(page: Page): Promise<void> {
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  const row = page.locator('.nav-story-row').first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await page.locator('.nav-story-title').first().click();
}

async function openSceneCrafter(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
}

/** The Scene Crafter strip's tabs (pinned Setup + one per open board). */
function stripTabs(page: Page) {
  return page.locator('[role="tablist"][aria-label="Workspace tabs"] [role="tab"]');
}

test('SKY-11069: BOARDS gallery → board tabs → focus-existing → restart persistence → Ctrl+W', async () => {
  test.setTimeout(180_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11069-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'story-vault');
  const notesVaultDir = path.join(tempRoot, 'notes-vault');
  seedUserData(userData, vaultDir, notesVaultDir);

  // ── Session 1: reach the gallery, create a board, open it in a tab ──
  let app = await launchApp(userData);
  try {
    const page = await waitForBoot(app);
    await createAndSelectStory(page);
    await openSceneCrafter(page);

    // Empty gallery: no board cards (never pre-seeded), §1.3 hint, + New board.
    const gallery = page.getByTestId('crafter-board-list');
    await expect(gallery).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.sc-board-row:not(.sc-board-row--new)')).toHaveCount(0);
    await expect(page.getByText('Draft board builds a canvas here', { exact: false })).toBeVisible();

    // The strip shows only the pinned Setup tab, with no close button.
    await expect(stripTabs(page)).toHaveCount(1);
    await expect(stripTabs(page).first()).toHaveText(/Scene Crafter/);
    await expect(page.locator('button[aria-label="Close Scene Crafter"]')).toHaveCount(0);

    // + New board → canvas full-screen in its own, now-active tab.
    await page.getByTestId('crafter-new-board').click();
    await expect(page.getByTestId('canvas-board')).toBeVisible({ timeout: 8_000 });
    await expect(stripTabs(page)).toHaveCount(2);
    const boardTab = stripTabs(page).nth(1);
    await expect(boardTab).toHaveText(/Board 1/);
    await expect(boardTab).toHaveAttribute('aria-selected', 'true');

    // Setup tab → gallery card with name + card count (no in-place back button).
    await expect(page.locator('.sc-canvas-back')).toHaveCount(0);
    await stripTabs(page).first().click();
    await expect(gallery).toBeVisible({ timeout: 8_000 });
    const card = page.locator('.sc-board-row:not(.sc-board-row--new)');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Board 1');
    await expect(card).toContainText('0 cards');

    // Clicking the card focuses the EXISTING tab — never a duplicate.
    await card.click();
    await expect(page.getByTestId('canvas-board')).toBeVisible({ timeout: 8_000 });
    await expect(stripTabs(page)).toHaveCount(2);
    await expect(stripTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');

    // The open tab reached disk (activeLayout) before we relaunch.
    await expect
      .poll(() => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8'));
          return Array.isArray(s.activeLayout?.boardDocTabs) ? s.activeLayout.boardDocTabs.length : 0;
        } catch {
          return -1;
        }
      }, { timeout: 10_000 })
      .toBe(1);
  } finally {
    await app.close().catch(() => undefined);
  }

  // ── Session 2: genuine relaunch — the board tab is still open and active ──
  app = await launchApp(userData);
  try {
    const page = await waitForBoot(app);
    // Re-reach Scene Crafter deterministically: story selection doesn't
    // survive a relaunch without a saved scene cursor (SKY-130's concern,
    // not this test's) — select the story from the Story Writer tree first.
    await clickStoryNav(page);
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();
    await openSceneCrafter(page);

    // Persisted: Board 1 tab restored AND active → canvas shows immediately.
    await expect(stripTabs(page)).toHaveCount(2, { timeout: 8_000 });
    const boardTab = stripTabs(page).nth(1);
    await expect(boardTab).toHaveText(/Board 1/);
    await expect(boardTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('canvas-board')).toBeVisible({ timeout: 8_000 });

    // Ctrl+W closes the board tab and lands on the pinned Setup tab (which
    // Ctrl+W can never close) — the strip is never empty.
    await page.keyboard.press('Control+w');
    await expect(stripTabs(page)).toHaveCount(1);
    await expect(page.getByTestId('crafter-board-list')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Control+w');
    await expect(stripTabs(page)).toHaveCount(1);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
