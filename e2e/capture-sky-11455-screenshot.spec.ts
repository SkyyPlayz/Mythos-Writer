/**
 * capture-sky-11455-screenshot.spec.ts — SKY-11455 PR evidence (not part of CI)
 *
 * Reproduces the QA repro from SKY-11455 click-for-click on a FRESH profile
 * and an EMPTY notes vault, then screenshots the Scene Crafter vault-reference
 * columns:
 *   1. Notes Editor → `+` New note → template "Default Character" → name
 *      "Kael Thorne" → Create. The dialog writes to the vault ROOT (its
 *      default target) — no Characters/ folder exists.
 *   2. File → New story → select it → Scene Crafter.
 *   3. CHARACTERS column must list Kael Thorne (base stock). Then remove it
 *      from this scene and press `+` → search "Kael" — the picker must offer
 *      it back (the QA's exact step 3, which used to read "No matching vault
 *      notes to add.").
 *
 * Run twice for a before/after pair — the "before" build is main without the
 * template `type:` stamp, so its assertions are skipped and only the shots
 * are taken (SKY11455_EXPECT_FIX unset):
 *   SKY11455_SHOT_SUFFIX=before xvfb-run -a npx playwright test e2e/capture-sky-11455-screenshot.spec.ts
 *   SKY11455_SHOT_SUFFIX=after SKY11455_EXPECT_FIX=1 xvfb-run -a npx playwright test e2e/capture-sky-11455-screenshot.spec.ts
 *
 * Output: pr-screenshots/sky11455/*-<suffix>.png
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky11455');
const SUFFIX = process.env.SKY11455_SHOT_SUFFIX || 'after';
const EXPECT_FIX = process.env.SKY11455_EXPECT_FIX === '1';

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${SUFFIX}.png`), clip });
  console.log(`  wrote ${name}-${SUFFIX}.png`);
}

async function columnsClip(page: Page) {
  const characters = await page.getByTestId('sc-ref-col-characters').boundingBox();
  const items = await page.getByTestId('sc-ref-col-items').boundingBox();
  if (!characters || !items) return undefined;
  return {
    x: Math.max(0, characters.x - 12),
    y: Math.max(0, characters.y - 12),
    width: items.x + items.width - characters.x + 24,
    height: 420,
  };
}

test('capture SKY-11455 template note reaches Scene Crafter CHARACTERS', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11455-user-'));
  const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11455-story-'));
  const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11455-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    gettingStartedDismissed: true, notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVault, notesVaultRoot: notesVault,
  }, null, 2));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  const page: Page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Step 1 — Notes Editor → + New note → Default Character → Kael Thorne.
  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="vb-btn-new-note"]').first().click();
  const templateSelect = page.locator('[data-testid="ntd-template-select"]');
  await expect(templateSelect).toBeVisible({ timeout: 6_000 });
  await templateSelect.selectOption({ label: 'Default Character' });
  const nameField = page.locator('[data-testid="ntd-field-name"]');
  await expect(nameField).toBeVisible({ timeout: 4_000 });
  await nameField.fill('Kael Thorne');
  await page.waitForTimeout(200);
  await shot(page, '1-character-template-dialog');
  await page.locator('[data-testid="ntd-submit"]').click();
  await expect(templateSelect).not.toBeVisible({ timeout: 6_000 });

  const noteFile = path.join(notesVault, 'Kael Thorne.md');
  expect(fs.existsSync(noteFile)).toBe(true);
  console.log('  note frontmatter:\n' + fs.readFileSync(noteFile, 'utf-8').split('\n').slice(0, 9).join('\n'));

  // Step 2 — Story Writer → File → New story → select → Scene Crafter.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
  const storyCount = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(storyCount).waitFor({ state: 'visible', timeout: 8_000 });
  await page.locator('.nav-story-title').nth(storyCount).click();
  await page.waitForTimeout(400);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(700);

  const characters = page.getByTestId('sc-ref-col-characters');
  await expect(characters).toBeVisible({ timeout: 8_000 });
  if (EXPECT_FIX) {
    await expect(characters.getByText('Kael Thorne')).toBeVisible({ timeout: 8_000 });
  }
  await shot(page, '2-characters-column', await columnsClip(page));

  // Step 3 — the QA's exact step: `+` → search "Kael". With the fix the note
  // is already in the column, so remove it from this scene first to give the
  // picker something to offer back (un-remove path).
  if (EXPECT_FIX) {
    await characters.getByRole('button', { name: 'Remove Kael Thorne from this scene' }).click();
    await expect(characters.getByText('Kael Thorne')).toHaveCount(0);
  }
  await characters.getByRole('button', { name: 'Add a note to CHARACTERS' }).click();
  const search = page.getByRole('textbox', { name: 'Search notes to add to CHARACTERS' });
  await search.waitFor({ state: 'visible', timeout: 5_000 });
  await search.fill('Kael');
  await page.waitForTimeout(300);
  if (EXPECT_FIX) {
    await expect(characters.getByRole('button', { name: /kael thorne/i })).toBeVisible();
  }
  await shot(page, '3-characters-picker-search-kael', await columnsClip(page));

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(storyVault, { recursive: true, force: true });
  fs.rmSync(notesVault, { recursive: true, force: true });
});
