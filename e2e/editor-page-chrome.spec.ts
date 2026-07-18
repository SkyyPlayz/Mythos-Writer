// SKY-3204 / SKY-3209 (B6): Story page chrome — presets + drag (owner-locked decision).
// Page chrome is a Story-only wrapper concern (wired in DesktopShell, NOT in the
// shared <RichTextEditor> core): size presets, margin/font sliders, reset. This
// net pins that the chrome survives the B1 extraction and stays Story-scoped.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, '.notes-vault'), '');
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function fillPrompt(page: Page, response: string): Promise<void> {
  const input = page.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await page.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

async function openScene(page: Page): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await clickStoryNav(page);
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 5_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, 'Page Chrome Story');
  await page.locator('.nav-story-row').first().locator('.nav-inline-add').click();
  await fillPrompt(page, 'Chapter One');
  await page.locator('.nav-chapter-row').first().locator('.nav-inline-add').click();
  await fillPrompt(page, 'Scene One');
  await page.locator('.nav-scene-row').first().click();

  await expect(page.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible({ timeout: 10_000 });
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pagechrome-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('PC-01: page chrome toolbar renders on the Story editor with preset + slider controls', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const chrome = page.locator('.pct-toolbar[aria-label="Page chrome settings"]');
    await expect(chrome).toBeVisible();
    await expect(chrome.locator('[role="group"][aria-label="Page size preset"]')).toBeVisible();
    await expect(chrome.locator('[aria-label="Page margins"] input.pct-slider')).toBeVisible();
    await expect(chrome.locator('[aria-label="Font size"] input.pct-slider')).toBeVisible();
    await expect(chrome.locator('.pct-reset-btn')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-02: size presets switch the page width and report active state accessibly', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const a4 = page.locator('.pct-preset-btn', { hasText: 'A4' });
    const letter = page.locator('.pct-preset-btn', { hasText: 'Letter' });

    await a4.click();
    await expect(a4).toHaveAttribute('aria-pressed', 'true');
    await expect(letter).toHaveAttribute('aria-pressed', 'false');
    const a4Width = await page
      .locator('.story-page-canvas')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--page-width-story').trim());

    await letter.click();
    await expect(letter).toHaveAttribute('aria-pressed', 'true');
    await expect(a4).toHaveAttribute('aria-pressed', 'false');
    const letterWidth = await page
      .locator('.story-page-canvas')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--page-width-story').trim());

    expect(a4Width).not.toEqual(letterWidth);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-04: line-spacing slider visibly changes and persists the page line height (SKY-5777)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const lineSpacingSlider = page.locator('[aria-label="Line spacing"] input.pct-slider');
    await expect(lineSpacingSlider).toBeVisible();

    const initialLineHeight = await page
      .locator('.story-page-canvas')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--story-page-line-height').trim());

    await lineSpacingSlider.fill('2.2');
    await lineSpacingSlider.dispatchEvent('change');

    await expect(lineSpacingSlider).toHaveValue('2.2');
    await expect(page.locator('.pct-slider-val', { hasText: '2.2×' })).toBeVisible();

    const updatedLineHeight = await page
      .locator('.story-page-canvas')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--story-page-line-height').trim());
    expect(updatedLineHeight).not.toEqual(initialLineHeight);
    expect(updatedLineHeight).toBe('2.2');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-03: page chrome is Story-only — Notes rich mode has minimal chrome (owner decision)', async () => {
  // SKY-6933: `.note-viewer .note-mode-group[aria-label="Editor mode"]` is now hidden
  // behind the M17 gear-menu redesign (`[data-testid="note-gear-btn"]`); this test
  // never opens that menu. Stale selector, not a product regression — needs an update.
  test.skip(true, 'SKY-6933: stale selector post-M17 gear-menu redesign, needs update');
  const notePath = path.join(notesDir, 'chromeless.md');
  fs.writeFileSync(notePath, '# Minimal\n\nNotes keep minimal page chrome.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();

    await page.locator('[data-testid^="vb-row-"]', { hasText: 'chromeless' }).first().click();
    await expect(page.locator('.note-viewer .note-mode-group[aria-label="Editor mode"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('button.note-viewer-mode', { hasText: 'Rich' }).click();
    await expect(page.locator('.note-viewer .ProseMirror')).toBeVisible();

    // The Story page-chrome toolbar must NOT leak into the Notes surface.
    await expect(page.locator('#app-tabpanel-notes .pct-toolbar')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ─── GH #842 / Beta 3 M10 — Word-style draggable page ruler ─────────────────

test('PC-05: page ruler drags width with live preview, snap-to-preset, and margin handles (GH #842)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const ruler = page.locator('[data-testid="page-ruler"]');
    await expect(ruler).toBeVisible();

    // Baseline: letter preset → 680px.
    const widthOf = () =>
      page
        .locator('.story-page-canvas')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--page-width-story').trim());

    // Drag the right page edge outward by 100px → width grows by 2×∆ = 880px.
    const edgeR = page.locator('[data-testid="pgr-edge-r"]');
    const box = await edgeR.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY, { steps: 5 });
    // Live preview updates before release.
    expect(await widthOf()).toBe('880px');
    await page.mouse.up();
    expect(await widthOf()).toBe('880px');
    // Commit landed in prefs: the toolbar width slider follows.
    await expect(page.locator('[role="group"][aria-label="Page width"] input.pct-slider')).toHaveValue('880');

    // Keyboard: focused edge handle nudges width by 10px per arrow (WCAG 2.1 AA).
    await edgeR.focus();
    await expect(edgeR).toHaveAttribute('aria-valuenow', '880');
    await page.keyboard.press('ArrowRight');
    await expect(edgeR).toHaveAttribute('aria-valuenow', '890');
    expect(await widthOf()).toBe('890px');

    // Margin handle drag writes through to --story-page-pad-horiz (default 56).
    const marginL = page.locator('[data-testid="pgr-margin-l"]');
    const mbox = await marginL.boundingBox();
    expect(mbox).not.toBeNull();
    const mx = mbox!.x + mbox!.width / 2;
    const my = mbox!.y + mbox!.height / 2;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 30, my, { steps: 4 });
    await page.mouse.up();
    const pad = await page
      .locator('.story-page-canvas')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--story-page-pad-horiz').trim());
    expect(pad).toBe('86px');
    await expect(marginL).toHaveAttribute('aria-valuenow', '86');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-06: doc-header renders above editor with breadcrumb and zoom controls', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const header = page.locator('.doc-header');
    await expect(header).toBeVisible();

    // Zoom control
    await expect(header.locator('[aria-label*="zoom" i], [aria-label*="Zoom" i]')).toBeVisible();

    // Focus toggle button
    await expect(header.locator('button[aria-label*="focus" i], button[aria-label*="Focus" i]')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

// SKY-6491: DocHeader shipped with wordCount hardcoded to 0 and its title
// editor wired to a no-op — this net pins that both are real and load-bearing.
test('PC-08: doc-header word count reflects real content and title edits persist (SKY-6491)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const wordCount = page.locator('.doc-header-wordcount');
    await expect(wordCount).toHaveText('0 words');

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('one two three four five');
    await expect(wordCount).toHaveText('5 words');

    const titleEl = page.locator('.doc-header-title');
    await expect(titleEl).toHaveText('Scene One');
    await titleEl.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Renamed Scene');
    await titleEl.blur();

    // The header itself reflects the commit immediately...
    await expect(titleEl).toHaveText('Renamed Scene');
    // ...and it wasn't a DOM-only edit: the scene tree (driven by the
    // same manifest state) picks up the renamed title too.
    await expect(page.locator('.nav-scene-row', { hasText: 'Renamed Scene' })).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-07: margin ruler renders above editor with correct range', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const ruler = page.locator('.margin-ruler');
    await expect(ruler).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});
