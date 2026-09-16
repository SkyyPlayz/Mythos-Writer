/**
 * capture-sky11358-drag-preview-screenshots.spec.ts — SKY-11358
 *
 * One-off Playwright script to capture PR evidence for the paragraph-drag
 * legibility fix: a floating preview of the dragged block following the
 * cursor, and a full-height gap placeholder previewing the destination
 * (replacing the old bare 2px dropline). Not registered in package.json/CI —
 * run manually:
 *   npx playwright test e2e/capture-sky11358-drag-preview-screenshots.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky11358-drag-preview');
const NOW = '2026-09-02T00:00:00.000Z';
const STORY_TITLE = 'Drag Preview Story';

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

function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify(
      {
        formatVersion: 2,
        id: 'vault-dp-1',
        name: 'Drag Preview Vault',
        createdAt: NOW,
        stories: [{ id: 'story-dp-1', title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW }],
        seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
      },
      null,
      2
    )
  );

  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-dp-1', title: 'Chapter One' }] }];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: story-dp-1`,
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

  const scenePath = path.join(chapterDir, 'Scene 01.md');
  fs.writeFileSync(scenePath, `---\nid: scene-dp-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\nSeed paragraph.`);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
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
  await expect(pg.getByTestId('msv-root')).toBeVisible({ timeout: 10_000 });
}

test('capture SKY-11358 drag ghost + gap placeholder', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-drag-preview-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Drag Preview Vault');
  seedV2Vault(bundle);
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openManuscript(page);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Build four real paragraphs by chaining Enter-splits (same approach as
    // e2e/paragraph-editing.spec.ts TC-PE-03 — a typed-then-Tab or seeded
    // multi-paragraph .md body doesn't reliably split into separate blocks).
    const first = page.locator('[data-testid^="msv-para-"]').first();
    await first.click();
    await page.keyboard.press('End');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type(
      'The lighthouse keeper climbed the spiral stair before dawn, counting each worn stone step out of habit rather than need.'
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'Below, the tide pulled at the rocks with a patience that felt almost deliberate, as if the sea itself were rehearsing a line it had said a thousand times before.'
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'She lit the lamp and watched the beam sweep the dark water, thinking of the ships that would never know her name.'
    );
    await page.keyboard.press('Enter');
    await page.keyboard.type('A gull cried somewhere above the gallery, and for a moment the whole tower seemed to hold its breath.');
    await page.keyboard.press('Enter');

    const rows = page.locator('[data-testid^="msv-para-"]');
    await expect(rows).toHaveCount(5, { timeout: 10_000 }); // + trailing empty split

    // Typing the last split left the view auto-scrolled to follow the
    // caret — bring paragraph 1 back into view before dragging it.
    await first.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // 1. Before drag — baseline.
    await page.screenshot({ path: path.join(OUT_DIR, '1-before-drag.png') });

    const grip0 = page.locator('[data-testid^="msv-grip-"]').nth(0);
    const gripBox = await grip0.boundingBox();
    expect(gripBox).not.toBeNull();
    if (!gripBox) return;

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);

    // 2. Mid-drag, hovering the row directly below — ghost follows the
    //    cursor, gap opens where the block will land.
    const row1Box = await rows.nth(1).boundingBox();
    expect(row1Box).not.toBeNull();
    if (row1Box) {
      await page.mouse.move(row1Box.x + row1Box.width / 2, row1Box.y + 8, { steps: 10 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, '2-mid-drag-near-boundary.png') });
    }

    // 3. Mid-drag, hovering further down (row 3) — target should track
    //    cleanly with the gap, no lingering artifacts at the old position.
    const row3Box = await rows.nth(3).boundingBox();
    expect(row3Box).not.toBeNull();
    if (row3Box) {
      await page.mouse.move(row3Box.x + row3Box.width / 2, row3Box.y + row3Box.height / 2, { steps: 10 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, '3-mid-drag-further-target.png') });
    }

    await page.mouse.up();
    await page.waitForTimeout(200);

    // 4. After drop — paragraph landed where the preview indicated, ghost
    //    and gap are both gone.
    await page.screenshot({ path: path.join(OUT_DIR, '4-after-drop.png') });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
