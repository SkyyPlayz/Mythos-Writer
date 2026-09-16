/**
 * Capture Boards owner-punch evidence for PR #1592 screenshot-check:
 * top furniture chrome, TreeIcons folder glyphs, note card with thumbnail.
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-boards-owner-punches-1592.spec.ts --reporter=list
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
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/boards-1592');
const ARTIFACTS = '/opt/cursor/artifacts';

function seed(userData: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(path.join(notesDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesDir, 'attachments'), { recursive: true });

  // Tiny 64×64 PNG (solid teal) for note thumbnail evidence.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAhUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAA'
      + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4G0B0QABXrF8XQAAAABJRU5ErkJggg==',
    'base64',
  );
  // Use a known-good minimal 1×1 PNG if decode fails size — write a real small PNG via raw.
  const onePx = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(path.join(notesDir, 'attachments', 'hero.png'), onePx);
  fs.writeFileSync(
    path.join(notesDir, 'Characters', 'Aria.md'),
    '---\ntitle: Aria\nthumb: attachments/hero.png\n---\n\n# Aria\n',
  );
  fs.writeFileSync(path.join(notesDir, 'World.md'), '---\ntitle: World\n---\n\n# World\n');

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

test('capture Boards top chrome + folder glyph + note thumb', async () => {
  test.setTimeout(120_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-boards-1592-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story');
  const notesDir = path.join(tempRoot, 'notes');
  seed(userData, storyDir, notesDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
    await boardsBtn.click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.boards-tab-panel__furniture-toolbar')).toBeVisible({ timeout: 10_000 });

    // Wait for folder cards (TreeIcons SVG glyphs) + furniture toolbar.
    await expect(page.getByRole('button', { name: /Board: Characters/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.boards-tab-panel__furniture-toolbar')).toBeVisible();

    const chromePath = path.join(OUT_DIR, 'boards-top-chrome.png');
    await page.screenshot({ path: chromePath, fullPage: false });
    fs.copyFileSync(chromePath, path.join(ARTIFACTS, 'boards-1592-top-chrome.png'));

    const toolbar = page.locator('.boards-tab-panel__furniture-toolbar');
    await toolbar.screenshot({ path: path.join(ARTIFACTS, 'boards-1592-furniture-toolbar.png') });
    await toolbar.screenshot({ path: path.join(OUT_DIR, 'boards-furniture-toolbar.png') });

    // Enter Characters so Aria note with thumb is visible.
    await page.getByRole('button', { name: /Board: Characters/ }).dblclick();
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toContainText('Characters', {
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /Note card:/ })).toBeVisible({ timeout: 10_000 });

    const thumbPath = path.join(OUT_DIR, 'boards-note-thumb.png');
    await page.screenshot({ path: thumbPath, fullPage: false });
    fs.copyFileSync(thumbPath, path.join(ARTIFACTS, 'boards-1592-note-thumb.png'));
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
