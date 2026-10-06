/**
 * PLAN-058 L3 — Boards user path (pan/select rail, colour, connector, to-do, minimap).
 *
 * Proof command:
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l3-boards.spec.ts --reporter=list --workers=1
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

function makeTemp(): { userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l3-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  fs.mkdirSync(path.join(notesDir, 'Deck'), { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'Deck', 'alpha.md'), '# Alpha\n\nLinked body text.\n');
  fs.writeFileSync(path.join(notesDir, 'Deck', 'beta.md'), '# Beta\n\nSecond card.\n');
  return { userData, notesDir };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootToBoards(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 10_000 });
  return page;
}

test.describe('PLAN-058 L3 — Boards canvas', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    const t = makeTemp();
    userData = t.userData;
    app = await launchApp(userData);
    page = await bootToBoards(app);
    await page.locator('[data-testid="boards-nav-folder-Deck"]').click();
    await expect(page.locator('.board-canvas__item')).toHaveCount(2, { timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('tool rail shows pan and select with icons (75:08)', async () => {
    const pan = page.locator('.boards-tab-panel__tool-rail-btn[data-tool="pan"]');
    const select = page.locator('.boards-tab-panel__tool-rail-btn[data-tool="select"]');
    await expect(pan).toBeVisible();
    await expect(select).toBeVisible();
    await expect(pan.locator('svg')).toBeVisible();
    await expect(select.locator('svg')).toBeVisible();
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/plan058-l3-boards.png' });
  });

  test('pan tool sets active tool on canvas (81:01)', async () => {
    await page.locator('.boards-tab-panel__tool-rail-btn[data-tool="pan"]').click();
    await expect(page.locator('.board-canvas__root')).toHaveAttribute('data-active-tool', 'pan');
  });

  test('cross-board search selects and reveals a hit (81:16)', async () => {
    await page.locator('[data-testid="boards-nav-home"]').click();
    await page.locator('.boards-tab-panel__search-input').fill('beta');
    const hit = page.locator('.boards-tab-panel__search-hit').first();
    await expect(hit).toBeVisible({ timeout: 8_000 });
    await hit.click();
    await expect(page.locator('.boards-tab-panel__breadcrumb-current', { hasText: 'Deck' })).toBeVisible();
    await expect(page.locator('.board-canvas__item[data-selected="true"]')).toHaveCount(1);
  });

  test('to-do card starts blank and accepts Add task (78:02)', async () => {
    await page.locator('.boards-tab-panel__furniture-btn', { hasText: 'To-do list' }).click();
    const todo = page.locator('[data-kind="check"]').last();
    await expect(todo).toBeVisible();
    await expect(todo.locator('.board-canvas__furniture-check')).toHaveCount(0);
    await todo.click({ button: 'right' });
    await page.locator('.board-canvas__menu-item', { hasText: 'Add task' }).click();
    await expect(todo.locator('.board-canvas__furniture-check')).toHaveCount(1);
  });
});
