// SKY-3180 (Part A · A5): Shell relayout E2E + regression sweep.
//
// Covers the acceptance criteria that PR #809's selector-migration pass did not:
//   - Single GlobalRightSidebar instance across every AppNavRail/tab mode (Story, Notes, Brainstorm).
//   - Story sub-view render sweep (editor/kanban/structure/timeline) under the new shell.
//   - Beta 4 M4: workspace tab strip visibility — tabs are documents now, so
//     the strip starts empty on a fresh vault, shows a static pseudo-tab on
//     Scene Crafter, and is hidden on Timeline/Brainstorm (FULL-SPEC §4).
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const RIGHT_SIDEBAR_SEL = '[data-testid="global-right-sidebar"], .grs-collapsed-edge';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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

const CTRL3 = process.platform === 'darwin' ? 'Meta+3' : 'Control+3';

// ─── Single right sidebar across every mode ──────────────────────────────────

test.describe('Shell relayout — single GlobalRightSidebar across modes', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shell-sidebar-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('exactly one right sidebar element renders in Story mode', async () => {
    await expect(page.locator(RIGHT_SIDEBAR_SEL)).toHaveCount(1, { timeout: 10_000 });
  });

  test('exactly one right sidebar element renders in Notes mode', async () => {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' }))
      .toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
    await expect(page.locator(RIGHT_SIDEBAR_SEL)).toHaveCount(1, { timeout: 10_000 });
  });

  test('exactly one right sidebar element renders in Brainstorm mode', async () => {
    await page.keyboard.press(CTRL3);
    await expect(page.locator('[aria-labelledby="app-tab-brainstorm"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(RIGHT_SIDEBAR_SEL)).toHaveCount(1, { timeout: 10_000 });

    // Restore Story mode for any later test ordering assumptions.
    await clickStoryNav(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Story' }))
      .toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
  });
});

// ─── Story sub-view render sweep ──────────────────────────────────────────────

test.describe('Shell relayout — Story sub-view render sweep', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shell-subview-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('[data-testid="story-subview-bar"]')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('Editor sub-view is the default and renders unchanged', async () => {
    await expect(page.locator('[data-testid="story-subview-editor"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.shell-panels')).toBeVisible({ timeout: 5_000 });
  });

  test('Scene Board (kanban) sub-view renders unchanged', async () => {
    await page.locator('[data-testid="story-subview-kanban"]').click();
    await expect(page.locator('[data-testid="story-subview-kanban"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.shell-panels')).not.toBeVisible();
  });

  test('Structure sub-view renders unchanged', async () => {
    await page.locator('[data-testid="story-subview-structure"]').click();
    await expect(page.locator('[data-testid="story-subview-structure"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.shell-structure')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.shell-kanban')).not.toBeVisible();
  });

  test('Timeline sub-view renders unchanged', async () => {
    await page.locator('[data-testid="story-subview-timeline"]').click();
    await expect(page.locator('[data-testid="story-subview-timeline"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.shell-timeline')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.shell-structure')).not.toBeVisible();
  });

  test('returning to Editor sub-view renders unchanged', async () => {
    await page.locator('[data-testid="story-subview-editor"]').click();
    await expect(page.locator('[data-testid="story-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.shell-panels')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.shell-timeline')).not.toBeVisible();
  });
});

// ─── Beta 4 M4: workspace tab strip = documents (FULL-SPEC §4) ────────────────

test.describe('Shell relayout — M4 workspace tab strip visibility', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shell-wtb-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('the strip starts with no document tabs on a fresh vault, + button present', async () => {
    // M4: tabs are documents — module mirrors no longer seed the strip.
    const tabs = page.getByRole('tablist', { name: 'Workspace tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(0);
    await expect(page.locator('[data-testid="wtb-new-tab-btn"]')).toBeVisible();
  });

  test('Scene Crafter (kanban) shows the static view pseudo-tab', async () => {
    await page.locator('[data-testid="story-subview-kanban"]').click();
    await expect(page.locator('[data-testid="wtb-static-tab"]')).toHaveText(/Scene Crafter/, { timeout: 5_000 });
    // The + (provisional scene) stays available (prototype 512).
    await expect(page.locator('[data-testid="wtb-new-tab-btn"]')).toBeVisible();
  });

  test('the strip is hidden on the Timeline sub-view', async () => {
    await page.locator('[data-testid="story-subview-timeline"]').click();
    await expect(page.locator('.shell-timeline')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toHaveCount(0);
  });

  test('the strip is hidden on Brainstorm and returns on the Story editor', async () => {
    await page.keyboard.press(CTRL3);
    await expect(page.locator('[aria-labelledby="app-tab-brainstorm"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toHaveCount(0);

    await clickStoryNav(page);
    await page.locator('[data-testid="story-subview-editor"]').click();
    await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toBeVisible({ timeout: 5_000 });
  });
});
