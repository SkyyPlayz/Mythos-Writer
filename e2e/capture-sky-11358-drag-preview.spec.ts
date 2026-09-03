/**
 * capture-sky-11358-drag-preview.spec.ts — one-off PR evidence capture, not
 * part of CI. Screenshots the paragraph grip-drag preview (SKY-11358):
 * the floating drag ghost following the cursor, and the drop-gap
 * placeholder previewing the destination.
 *
 * Run: npx playwright test e2e/capture-sky-11358-drag-preview.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-07-01T00:00:00.000Z';
const STORY_TITLE = 'Drag Preview Story';
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11358-drag-preview');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2)
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2)
  );
}

function seedV2Vault(bundle: string, seedProse: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify(
      {
        formatVersion: 2,
        id: 'vault-sky11358-1',
        name: 'Drag Preview Vault',
        createdAt: NOW,
        stories: [{ id: 'story-sky11358-1', title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW }],
        seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
      },
      null,
      2
    )
  );
  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-sky11358-1', title: 'Chapter One' }] }];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: story-sky11358-1`,
      `title: ${STORY_TITLE}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${STORY_TITLE}`,
      '',
      '## Part 1',
      '',
      '- [[Part 1/Chapter 01|Chapter One]]',
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-sky11358-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${seedProse}`
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function clickStorySection(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  await expect(storyBtn).toBeVisible({ timeout: 10_000 });
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

async function openManuscript(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const storyRow = pg.getByRole('button', { name: new RegExp(STORY_TITLE) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = pg.getByRole('button', { name: /Chapter One/ }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  const sceneRow = pg.getByRole('button', { name: /The Gate/ }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await chapterRow.click();
    try {
      await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch {
      /* collapsed again — retry */
    }
  }
  await sceneRow.click();
  await expect(pg.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  const chapterBtn = pg.getByTestId('msv-zoom-chapter');
  await chapterBtn.click();
  await expect(pg.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
}

test('SKY-11358: capture the floating drag preview and drop-gap placeholder', async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11358-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Vault');
  seedV2Vault(bundle, 'Seed paragraph.');
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openManuscript(page);

    const first = page.locator('[data-testid^="msv-para-"]').first();
    await first.click();
    await page.keyboard.press('End');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type('Alpha paragraph, the one being dragged — long enough that the floating preview has real text to show.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Beta paragraph in the middle.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Gamma paragraph at the end.');
    await page.keyboard.press('Enter');

    const rows = page.locator('[data-testid^="msv-para-"]');
    await expect(rows).toHaveCount(4, { timeout: 10_000 });

    const grip0 = page.locator('[data-testid^="msv-grip-"]').nth(0);
    const target = rows.nth(2); // Gamma
    const gripBox = await grip0.boundingBox();
    const targetBox = await target.boundingBox();
    expect(gripBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (gripBox && targetBox) {
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(80);

      // 1. Mid-flight — the floating preview follows the cursor.
      await page.mouse.move(gripBox.x + 40, gripBox.y + 60, { steps: 4 });
      await page.waitForTimeout(80);
      await expect(page.locator('.msv-drag-ghost')).toBeVisible({ timeout: 2_000 });
      await page.screenshot({ path: path.join(OUT_DIR, '1-floating-ghost-follows-cursor.png') });

      // 2. Hovering the destination — a gap the size of the dragged block
      // opens, previewing where it will land (not just a hairline).
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 6 });
      await page.waitForTimeout(120);
      await expect(page.locator('[data-testid="msv-drop-gap"]')).toBeVisible({ timeout: 2_000 });
      await page.screenshot({ path: path.join(OUT_DIR, '2-drop-gap-previews-destination.png') });

      await page.mouse.up();
    }
    await page.waitForTimeout(200);
    await expect(page.locator('.msv-drag-ghost')).toHaveCount(0);
    await page.screenshot({ path: path.join(OUT_DIR, '3-after-drop-clean.png') });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
