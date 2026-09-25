/**
 * capture-sky-11791-screenshot.spec.ts — SKY-11791 PR evidence (not part of CI)
 *
 * Reproduces the SKY-11682 GAP-1 repro click-for-click: create a Boards
 * column-ref item pointing at Target.md, rename Target.md -> Destination.md
 * through the real Notes tree inline-rename UI (no inbound [[wikilinks]], so
 * the only refresh signal is the fix's own vault:file-changed/note-renamed
 * patch), go back to Boards, and click the still-rendered ref link.
 *
 * Run twice for a before/after pair — the "before" build is main without the
 * fix, so the click is expected to silently no-op (screenshot just proves
 * we're still stuck on the Boards tab):
 *   SKY11791_SHOT_SUFFIX=before xvfb-run -a npx playwright test e2e/capture-sky-11791-screenshot.spec.ts
 *   SKY11791_SHOT_SUFFIX=after SKY11791_EXPECT_FIX=1 xvfb-run -a npx playwright test e2e/capture-sky-11791-screenshot.spec.ts
 *
 * Output: pr-screenshots/sky11791/*-<suffix>.png
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky11791');
const SUFFIX = process.env.SKY11791_SHOT_SUFFIX || 'after';
const EXPECT_FIX = process.env.SKY11791_EXPECT_FIX === '1';

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${SUFFIX}.png`) });
  console.log(`  wrote ${name}-${SUFFIX}.png`);
}

test('capture SKY-11791 column-ref click-to-open survives a target rename', async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11791-user-'));
  const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11791-story-'));
  const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11791-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    gettingStartedDismissed: true, notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVault, notesVaultRoot: notesVault,
  }, null, 2));
  fs.writeFileSync(path.join(notesVault, 'Target.md'), '# Target\n\nThe target note.\n');

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    // Boards tab: create a column furniture item whose ref points at Target.md,
    // through the app's own furniture-creation IPC (SKY-11188 §4 pattern) — the
    // thing under test here is the rename/refresh path, not furniture creation.
    const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
    await boardsBtn.click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
    await page.evaluate(async () => {
      await (window as unknown as { api: { notesBoardFurnitureCreate: (f: string, i: unknown) => Promise<unknown> } }).api.notesBoardFurnitureCreate('', {
        k: 'column', x: 400, y: 44, title: 'Quick links',
        items: [{ t: 'Target', ref: 'Target.md' }],
      });
    });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await boardsBtn.click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });

    const refLink = page.locator('.board-canvas__furniture-ref', { hasText: 'Target' });
    await expect(refLink).toBeVisible();
    await shot(page, '1-column-ref-before-rename');

    // Rename Target.md -> Destination.md through the real Notes tree inline
    // rename UI. Target.md has no inbound [[wikilinks]] — only the board's
    // column ref points at it — so the rename cascade rewrites the sidecar's
    // ref field but the old fix bug meant allNotePaths never refreshed.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
    await page.locator('[data-testid="vb-row-Target.md"]').dblclick();
    await expect(page.locator('.vb-rename-input')).toBeVisible({ timeout: 5_000 });
    await page.locator('.vb-rename-input').fill('Destination');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="vb-row-Destination.md"]')).toBeVisible({ timeout: 6_000 });

    // Back to Boards — the ref link still renders (label unchanged, it's the
    // item's display title) — click it.
    await boardsBtn.click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
    const refLinkAfterRename = page.locator('.board-canvas__furniture-ref', { hasText: 'Target' });
    await expect(refLinkAfterRename).toBeVisible();
    await refLinkAfterRename.click();

    if (EXPECT_FIX) {
      await expect(page.locator('[role="tabpanel"][aria-labelledby="app-tab-notes"]')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('[data-testid="notes-tab-center"]').getByText('The target note.')).toBeVisible({ timeout: 8_000 });
    } else {
      // Unfixed build: the click silently no-ops. Give it the same window to
      // (fail to) resolve, then capture whatever state we're actually in.
      await page.waitForTimeout(3_000);
    }
    await shot(page, '2-after-click-post-rename');

    await app.close();
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(storyVault, { recursive: true, force: true });
    fs.rmSync(notesVault, { recursive: true, force: true });
  }
});
