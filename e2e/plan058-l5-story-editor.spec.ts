/**
 * PLAN-058 L5 — Story editor lane (toolbar removal, new story modal, structure strip).
 *
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l5-story-editor.spec.ts --reporter=list --workers=1
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
import { createStoryFromNavAdd, confirmNewStoryModalIfOpen } from './helpers/newStoryModal';
import { toggleStoryEditorSplit } from './helpers/storyEditorSplit';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seed(userData: string, vaultDir: string, notesDir: string): void {
  for (const d of [userData, vaultDir, notesDir]) fs.mkdirSync(d, { recursive: true });
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

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootStoryEditor(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

test.describe('PLAN-058 L5 — Story editor', () => {
  test('37:22 — NFE / Story Assist / split toolbar controls removed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l5-'));
    const userData = path.join(root, 'ud');
    const vaultDir = path.join(root, 'story');
    const notesDir = path.join(root, 'notes');
    seed(userData, vaultDir, notesDir);
    const app = await launch(userData);
    try {
      const page = await bootStoryEditor(app);
      await expect(page.locator('[data-testid="nfe-mode-group"]')).toHaveCount(1);
      await expect(page.locator('.shell-editor-toolbar [data-testid="nfe-mode-group"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="story-assist-btn"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="split-toggle-btn"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('42:10 — New story opens modal with title field', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l5-modal-'));
    const userData = path.join(root, 'ud');
    const vaultDir = path.join(root, 'story');
    const notesDir = path.join(root, 'notes');
    seed(userData, vaultDir, notesDir);
    const app = await launch(userData);
    try {
      const page = await bootStoryEditor(app);
      await page.locator('[data-testid="nav-empty-cta"]').click({ timeout: 15_000 });
  await confirmNewStoryModalIfOpen(page);
      await expect(page.locator('[data-testid="new-story-modal"]')).toBeVisible();
      await expect(page.locator('[data-testid="new-story-modal-title-input"]')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('84:29 — split editor still opens via Ctrl+Shift+2 with pane close buttons', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l5-split-'));
    const userData = path.join(root, 'ud');
    const vaultDir = path.join(root, 'story');
    const notesDir = path.join(root, 'notes');
    seed(userData, vaultDir, notesDir);
    const app = await launch(userData);
    try {
      const page = await bootStoryEditor(app);
      await page.locator('[data-testid="nav-empty-cta"]').click({ timeout: 15_000 });
  await confirmNewStoryModalIfOpen(page);
      await page.locator('[data-testid="new-story-modal-title-input"]').fill('Split Test');
      await page.locator('[data-testid="new-story-modal-submit"]').click();
      await expect(page.locator('[data-testid="msv-root"]')).toBeVisible({ timeout: 15_000 });
      await toggleStoryEditorSplit(page);
      await expect(page.locator('[data-testid="split-pane-1"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="split-pane-2-close-btn"]')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
