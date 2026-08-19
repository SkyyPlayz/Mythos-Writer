// SKY-10511 — PR #1260 evidence screenshots for the Scene Crafter Setup rail:
// suggested cards showing the note hook-line excerpt (not the folder path),
// and drag-to-select with the updated "Click or drag a card onto the board"
// hint. Not part of CI: run manually to refresh the images.
//   xvfb-run --auto-servernum npx playwright test e2e/capture-sky10511-scene-crafter.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10511-scene-crafter');

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

/** Notes whose first body line becomes the card excerpt (SKY-10511 defect 1). */
function seedNotes(notesVaultDir: string): void {
  const notes: Array<[string, string]> = [
    ['Characters/Mara Vex.md', '# Mara Vex\n\nA smuggler who owes a debt in three ports and remembers all of them.\n'],
    ['Locations/Ward Violet.md', "# Ward Violet\n\nThe district that doesn't exist on any map the council prints.\n"],
    ['Ideas/Storm Cellar.md', '---\ntags: [idea]\n---\n# Storm Cellar\n\nEvery family keeps one door they never open — this one hums.\n'],
    // Empty note: excerpt falls back to the folder breadcrumb (pre-fix behavior).
    ['Ideas/Untitled Spark.md', '# Untitled Spark\n'],
  ];
  for (const [rel, body] of notes) {
    const abs = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function createAndSelectStory(page: Page): Promise<void> {
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  const row = page.locator('.nav-story-row').first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await page.locator('.nav-story-title').first().click();
}

async function openBoardView(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
}

test('capture SKY-10511 Setup-rail excerpt + drag-to-select screenshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-capture-sky10511-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'story-vault');
  const notesVaultDir = path.join(tempRoot, 'notes-vault');
  seedUserData(userData, vaultDir, notesVaultDir);
  seedNotes(notesVaultDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    await createAndSelectStory(page);
    await openBoardView(page);

    // Defect 1 evidence — cards show the note's hook line, not the folder path.
    const suggested = page.locator('.sc-suggest');
    const maraCard = suggested.getByRole('button', { name: /Mara Vex/i });
    await maraCard.waitFor({ state: 'visible', timeout: 8_000 });
    await expect(maraCard.locator('.sc-sugg-d')).toContainText('A smuggler who owes a debt');
    await expect(page.locator('.sc-suggest-hint')).toContainText('Click or drag a card onto the board');

    // Let the transient "notes moved" toast dismiss so the shots are clean.
    await page.locator('.toast, [role="status"]', { hasText: 'Notes tab' })
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => undefined);

    await page.screenshot({ path: path.join(OUT_DIR, '1-setup-rail-hook-line-excerpts.png') });

    // Close-up of the rail: excerpts + the "Click or drag" hint at legible size.
    await suggested.screenshot({ path: path.join(OUT_DIR, '2-rail-closeup-excerpts-and-drag-hint.png') });

    // Defect 2 behavior check (not visual — selection styling is aria-only,
    // pre-existing SKY-7601 gap): dragstart toggles selection like click.
    await expect(maraCard).toHaveAttribute('aria-pressed', 'false');
    await maraCard.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await expect(maraCard).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
