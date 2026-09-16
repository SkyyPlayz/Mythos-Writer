/**
 * Capture Boards 0.5.2 residual fidelity evidence for screenshot-check:
 * empty board overlay, empty-thumb note chrome, folder icon badges, BD-7 pane.
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-boards-leftovers-052.spec.ts --reporter=list
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
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/boards-052-leftovers');
const ARTIFACTS = '/opt/cursor/artifacts';

function seed(userData: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(path.join(notesDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesDir, 'EmptyBoard'), { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'World.md'), '---\ntitle: World\n---\n\n');
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

test('capture Boards leftovers empty states + empty-thumb + folder badges', async () => {
  test.setTimeout(120_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-boards-052-'));
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
    await expect(page.locator('.boards-tab-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 10_000 });

    // Home: folder badges + empty-thumb note chrome over BD-7 pane / dot grid.
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, 'boards-home-empty-thumb-folder.png'),
      fullPage: false,
    });
    fs.copyFileSync(
      path.join(OUT_DIR, 'boards-home-empty-thumb-folder.png'),
      path.join(ARTIFACTS, 'boards-052-home-empty-thumb-folder.png'),
    );

    // Enter an empty folder board for the empty-state card.
    const emptyBoard = page.getByRole('button', { name: /Board: EmptyBoard/ });
    if (await emptyBoard.count()) {
      await emptyBoard.dblclick();
      await expect(page.locator('.boards-tab-panel__empty-card')).toBeVisible({ timeout: 8_000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(OUT_DIR, 'boards-empty-board-state.png'),
        fullPage: false,
      });
      fs.copyFileSync(
        path.join(OUT_DIR, 'boards-empty-board-state.png'),
        path.join(ARTIFACTS, 'boards-052-empty-board-state.png'),
      );
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
