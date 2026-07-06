// SKY-3180 (Part A · A5): Shell relayout E2E + regression sweep.
//
// Covers the acceptance criteria that PR #809's selector-migration pass did not:
//   - Single GlobalRightSidebar instance across every AppNavRail/tab mode (Story, Notes, Brainstorm).
//   - Story sub-view render sweep (editor/kanban/structure/timeline) under the new shell.
//   - WorkspaceTabBar select/close/reorder driven end-to-end against a real (persisted) layout.
//
// Note: WorkspaceTabBar's "+" (open new tab) affordance is currently a no-op stub
// (`onNewTab={() => {}}` in DesktopShell.tsx) — there is no in-app action yet that creates a
// new workspace tab, so "open" is exercised here via a persisted 3-tab layout rather than a
// live open action. See SKY-5579 for wiring up real tab-open behavior.
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

/** Seed a layout with 3 persisted workspace tabs (story, notes, kanban) so
 * select/close/reorder can be exercised without a live "open tab" action. */
function seedUserDataWithWorkspaceTabs(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      activeLayout: {
        workspaceTabs: [
          { id: 'tab-story', kind: 'story-editor', title: 'Story', icon: '📖' },
          { id: 'tab-notes', kind: 'notes-editor', title: 'Notes', icon: '📁' },
          { id: 'tab-kanban', kind: 'kanban', title: 'Scene Board', icon: '🗂️' },
        ],
        activeWorkspaceTabId: 'tab-story',
      },
    }, null, 2),
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

// ─── WorkspaceTabBar select / close / reorder ─────────────────────────────────

test.describe('Shell relayout — WorkspaceTabBar select/close/reorder', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shell-wtb-'));
    userData = path.join(tempRoot, 'userData');
    seedUserDataWithWorkspaceTabs(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('all 3 persisted workspace tabs render with Story active by default', async () => {
    const tabs = page.getByRole('tablist', { name: 'Workspace tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('#workspace-tab-tab-story')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#workspace-tab-tab-notes')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#workspace-tab-tab-kanban')).toHaveAttribute('aria-selected', 'false');
  });

  test('selecting the Scene Board tab activates it and switches to kanban view', async () => {
    await page.locator('#workspace-tab-tab-kanban').click();
    await expect(page.locator('#workspace-tab-tab-kanban')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('#workspace-tab-tab-story')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-testid="story-subview-kanban"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 5_000 });
  });

  test('closing a non-active tab removes only that tab', async () => {
    // Active tab is Scene Board (kanban) from the previous test; close the inactive Notes tab.
    await page.locator('button[aria-label="Close Notes"]').click();
    const tabs = page.getByRole('tablist', { name: 'Workspace tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(2, { timeout: 3_000 });
    await expect(page.locator('#workspace-tab-tab-notes')).toHaveCount(0);
    // Active selection (Scene Board) is unaffected by closing an inactive tab.
    await expect(page.locator('#workspace-tab-tab-kanban')).toHaveAttribute('aria-selected', 'true');
  });

  test('drag-reordering moves a tab to a new position', async () => {
    // Remaining tabs: Story, Scene Board (in that order). Drag Scene Board before Story.
    const storyTab = page.locator('#workspace-tab-tab-story');
    const kanbanTab = page.locator('#workspace-tab-tab-kanban');
    await kanbanTab.dragTo(storyTab);

    const tabs = page.getByRole('tablist', { name: 'Workspace tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('id', 'workspace-tab-tab-kanban', { timeout: 3_000 });
    await expect(tabs.nth(1)).toHaveAttribute('id', 'workspace-tab-tab-story');
  });
});
