/**
 * capture-sky-11239-screenshot.spec.ts — SKY-11239 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence for the new "Drop cap"
 * on/off setting in the Page Setup popover (frontend/src/PageSetupPopover.tsx):
 *
 *   1. page-setup-drop-cap-control — the popover open, showing the new
 *      "Drop cap" checkbox alongside the font family/size controls.
 *   2. manuscript-drop-cap-off — the manuscript's first paragraph rendered
 *      with the setting OFF (default), no `msv-para-text--dropcap` class.
 *   3. manuscript-drop-cap-on — the same paragraph after toggling the
 *      setting ON, now carrying `msv-para-text--dropcap`.
 *
 * Modeled on e2e/capture-sky11132-open-folder-guard-screenshots.spec.ts and
 * reuses the same seed/launch shape as e2e/paragraph-editing.spec.ts (TC-PE-04).
 *
 * NOTE: the Page Setup popover's drop-down box has been visually clipped by
 * `.msv-toolbar`'s `overflow: hidden` since commit 4ec97aca6 (2026-07-07) —
 * pre-existing, unrelated to this PR. TC-PE-04's own DOM assertions don't
 * notice (Playwright's visibility checks don't account for paint-time
 * clipping), but a real screenshot needs the clip lifted, so this script
 * injects a capture-only style override before shooting the popover. That
 * override is not part of the shipped diff.
 *
 * Output: pr-screenshots/sky-11239-drop-cap-setting/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11239-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11239-drop-cap-setting');
const NOW = '2026-07-01T00:00:00.000Z';
const STORY_TITLE = 'Drop Cap Story';
const SEED_PROSE = 'The lantern flickered once, casting long shadows across the stone floor.';

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedV2Vault(bundle: string, seedProse: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-dc-1',
      name: 'Drop Cap Vault',
      createdAt: NOW,
      stories: [
        { id: 'story-dc-1', title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-dc-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: story-dc-1`,
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
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-dc-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${seedProse}`,
  );
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

test('capture SKY-11239 drop cap setting screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-dropcap-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Drop Cap Vault');
  seedV2Vault(bundle, SEED_PROSE);
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(page);

    await openManuscript(page);

    // Collapse the right Assistant sidebar so it doesn't visually overlap the
    // Page Setup popover, which is anchored close to the right edge of the
    // toolbar. Pre-existing UI, unrelated to this PR.
    const hideSidebar = page.getByRole('button', { name: /hide right sidebar/i });
    if (await hideSidebar.isVisible().catch(() => false)) {
      await hideSidebar.click();
    }

    // NOTE: `.msv-toolbar` has had `overflow: hidden` since well before this
    // PR (commit 4ec97aca6, 2026-07-07) — a pre-existing quirk that clips the
    // popover's drop-down box (position: absolute, anchored under the toolbar)
    // since it renders taller than the toolbar strip itself. Playwright's
    // `toBeVisible` doesn't check paint-time clipping, so the popover's own
    // functional assertions (TC-PE-04) pass regardless, but a real screenshot
    // needs the clip lifted to actually show the popover on screen. This is a
    // capture-only CSS override (not shipped, not part of the PR's diff) —
    // purely so the evidence screenshot below isn't blank.
    await page.addStyleTag({ content: '.msv-toolbar { overflow: visible !important; }' });

    const row = page.locator('[data-testid^="msv-para-"]').first();
    await expect(row).toHaveText(SEED_PROSE);

    // 1. Drop cap OFF (default) — the manuscript first paragraph, plain.
    await expect(row).not.toHaveClass(/msv-para-text--dropcap/);
    await shot(page, '1-manuscript-drop-cap-off');

    // 2. Open Page Setup popover — show the new "Drop cap" checkbox next to
    // the font family/size controls.
    await page.getByTestId('msv-page-setup-btn').click();
    const dropCapToggle = page.getByRole('checkbox', { name: 'Drop cap' });
    await expect(dropCapToggle).toBeVisible();
    await expect(page.locator('.page-setup-popover')).toBeVisible();
    await expect(dropCapToggle).not.toBeChecked();
    await shot(page, '2-page-setup-drop-cap-control');

    // 3. Toggle it on — applies live, popover still open.
    await dropCapToggle.click();
    await expect(dropCapToggle).toBeChecked();
    await expect(row).toHaveClass(/msv-para-text--dropcap/);
    await shot(page, '3-page-setup-drop-cap-checked');

    // Close the popover and capture the manuscript with the drop cap live.
    await page.getByRole('button', { name: /close page setup/i }).click();
    await expect(page.locator('.page-setup-popover')).toHaveCount(0);
    await expect(row).toHaveClass(/msv-para-text--dropcap/);
    await shot(page, '4-manuscript-drop-cap-on');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
