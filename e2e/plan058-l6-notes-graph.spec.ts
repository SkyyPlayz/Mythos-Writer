/**
 * PLAN-058 L6 — Notes + Graph lane (toolbar flush, tags, inline images, graph deep-link).
 *
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l6-notes-graph.spec.ts --reporter=list --workers=1
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seed(userData: string, vaultDir: string, notesDir: string, notes?: Record<string, string>): void {
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
  for (const [rel, body] of Object.entries(notes ?? {})) {
    const full = path.join(notesDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootNotes(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 8_000 });
}

test.describe('PLAN-058 L6 — Notes + Graph', () => {
  test('83:08 / 83:18 — Notes toolbar without editor/graph/entities sub-header', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l6-toolbar-'));
    const userData = path.join(root, 'ud');
    seed(userData, path.join(root, 'story'), path.join(root, 'notes'));
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootNotes(page);
      await expect(page.locator('.notes-tab-toolbar')).toBeVisible();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="notes-subview-entities"]')).toHaveCount(0);
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('33:20 — adding a tag mirrors a body #tag line on save', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l6-tags-'));
    const userData = path.join(root, 'ud');
    const notesDir = path.join(root, 'notes');
    seed(userData, path.join(root, 'story'), notesDir, {
      'Tagged.md': '---\ntitle: Tagged\ntags: []\n---\n\nBody line.\n',
    });
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootNotes(page);
      await page.locator('[data-testid="vb-row-Tagged.md"]').click();
      await expect(page.locator('[data-testid="note-add-tag-input"]')).toBeVisible({ timeout: 8_000 });
      await page.locator('[data-testid="note-add-tag-input"]').fill('lore');
      await page.locator('[data-testid="note-add-tag-input"]').press('Enter');
      await expect(page.locator('[data-testid="note-header-tag-lore"]')).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);
      const disk = fs.readFileSync(path.join(notesDir, 'Tagged.md'), 'utf-8');
      expect(disk).toMatch(/tags:\s*\[lore\]/i);
      expect(disk).toContain('#lore');
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('30:00 — preview mode renders markdown image lines (not raw ![] syntax)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l6-img-'));
    const userData = path.join(root, 'ud');
    seed(userData, path.join(root, 'story'), path.join(root, 'notes'), {
      'Pic.md': '---\ntitle: Pic\n---\n\n![diagram](assets/diagram.png)\n',
    });
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootNotes(page);
      await page.locator('[data-testid="vb-row-Pic.md"]').click();
      await expect(page.locator('.note-viewer')).toBeVisible({ timeout: 8_000 });
      // Rich mode paints inline images as <img> nodes (broken vault path → broken class).
      await expect(page.locator('.note-rich-editor img.rte-inline-image')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.note-rich-editor .ProseMirror')).not.toContainText('![diagram]');
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
