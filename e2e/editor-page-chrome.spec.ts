// SKY-3204 / SKY-3209 (B6): Story page chrome — presets + drag (owner-locked decision).
// Page chrome is a Story-only wrapper concern (wired in DesktopShell, NOT in the
// shared <RichTextEditor> core): size presets, margin/font sliders, reset. This
// net pins that the chrome survives the B1 extraction and stays Story-scoped.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story"]').click();
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
  const notePath = path.join(notesDir, 'chromeless.md');
  fs.writeFileSync(notePath, '# Minimal\n\nNotes keep minimal page chrome.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();

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
