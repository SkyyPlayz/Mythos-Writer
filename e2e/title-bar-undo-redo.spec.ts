// SKY-6011/SKY-6059: title bar Edit → Undo/Redo previously called
// document.execCommand, which never reaches TipTap/ProseMirror's own
// transaction-based undo stack — the menu item was a guaranteed no-op.
// This verifies Undo/Redo now dispatch through the focused editor's chain
// API via the active-editor registry (frontend/src/lib/activeEditorRegistry.ts).
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

/** Create story → chapter → scene through the navigator and open the scene editor. */
async function openScene(page: Page): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await clickStoryNav(page);
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 5_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, 'Undo Redo Story');
  await page.locator('.nav-story-row').first().locator('.nav-inline-add').click();
  await fillPrompt(page, 'Chapter One');
  await page.locator('.nav-chapter-row').first().locator('.nav-inline-add').click();
  await fillPrompt(page, 'Scene One');
  await page.locator('.nav-scene-row').first().click();

  await expect(page.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible({ timeout: 10_000 });
}

async function clickEditMenuItem(page: Page, label: string): Promise<void> {
  await page.locator('.wc-menu', { hasText: 'Edit' }).click();
  await page.locator('.wc-menu-item', { hasText: label }).click();
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-undoredo-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('UR-01: title bar Edit -> Undo reverts the last edit in the focused Story editor, Redo re-applies it', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const editor = page.locator('.tiptap-editor-wrap .ProseMirror');
    await editor.click();
    await page.keyboard.type('first sentence. ');
    await expect(editor).toContainText('first sentence.');
    // ProseMirror's history extension groups same-typing transactions within
    // its default 500ms newGroupDelay into a single undo step — wait past it
    // so "second sentence." is its own step and Undo only reverts that one.
    await page.waitForTimeout(700);
    await page.keyboard.type('second sentence.');
    await expect(editor).toContainText('first sentence. second sentence.');

    await clickEditMenuItem(page, 'Undo');
    await expect(editor).not.toContainText('second sentence.');
    await expect(editor).toContainText('first sentence.');

    await clickEditMenuItem(page, 'Redo');
    await expect(editor).toContainText('first sentence. second sentence.');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('UR-02: Undo no-ops gracefully when no editor is focused (no throw, app stays responsive)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    // Blur the editor so no TipTap instance is focused.
    await page.locator('.wc-project').click();
    await page.keyboard.press('Escape');

    await clickEditMenuItem(page, 'Undo');
    // App did not crash — the nav rail (unrelated chrome) is still there.
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});
